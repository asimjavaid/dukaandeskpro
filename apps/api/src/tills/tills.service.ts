import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { DbService } from '../db/db.service';
import { LicenseService } from '../license/license.service';
import { throttleClear, throttleFail, throttleWait } from '../common/throttle';
import { TILL_HEADER, type TillCtx, type TillRef } from './till-context';

const PAIR_MINUTES = 10;
const SEEN_WRITE_MS = 15_000;
const ONLINE_MS = 45_000;

type TillRow = {
  id: string;
  code: number;
  name: string;
  kind: 'main' | 'remote';
  device_key_hash: string | null;
  device_name: string | null;
  pair_code_hash: string | null;
  pair_expires_at: string | null;
  paired_at: string | null;
  last_seen_at: string | null;
  next_bill_no: number;
  active: number;
};

export type InstallMode = 'main_till' | 'server_only';

export type TillView = {
  id: string;
  code: number;
  label: string;
  name: string;
  kind: 'main' | 'remote';
  active: boolean;
  paired: boolean;
  pairing: boolean;
  pair_expires_at: string | null;
  device_name: string | null;
  last_seen_at: string | null;
  online: boolean;
  next_bill_no: number;
  shift: {
    id: string;
    opened_at: string;
    opened_by_name: string | null;
    opening_float_paisa: number;
  } | null;
  today_sales: number;
  today_total_paisa: number;
};

type Fail = { ok: false; error: string; limit?: number };

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function isLoopback(req: Request): boolean {
  const a = (req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

/** Start of today in Asia/Karachi (UTC+5), as an ISO instant. */
function pkDayStartIso(now = new Date()): string {
  const pk = new Date(now.getTime() + 5 * 3600_000);
  const start = Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), pk.getUTCDate()) - 5 * 3600_000;
  return new Date(start).toISOString();
}

/**
 * Till registry. Till 1 is the main PC's own till (off on a server-only install). Other tills are
 * added by the owner, get a 6-digit pairing code (10 minutes) and, once paired, a device key the
 * till sends on every request (header x-dd-till). The licence caps active tills.
 */
@Injectable()
export class TillsService implements OnApplicationBootstrap {
  private seenWritten = new Map<string, number>();

  constructor(
    private readonly db: DbService,
    private readonly licence: LicenseService,
  ) {}

  private envPending = true;

  onApplicationBootstrap() {
    this.applyEnvMode();
  }

  /**
   * Installer choice DD_INSTALL_MODE=server-only | main-till: applied once per new value (also right
   * after first-run setup), so the owner's own switch on the Tills screen is kept across restarts.
   */
  private applyEnvMode() {
    if (!this.envPending) return;
    const env = (process.env.DD_INSTALL_MODE ?? '').toLowerCase().replace(/-/g, '_');
    if (env !== 'server_only' && env !== 'main_till') {
      this.envPending = false;
      return;
    }
    try {
      const r = this.raw.prepare(`SELECT install_mode, install_mode_env FROM store LIMIT 1`).get() as
        | { install_mode?: string; install_mode_env?: string | null }
        | undefined;
      if (!r) return; // not set up yet: try again on the next call
      if (r.install_mode_env !== env) {
        if ((r.install_mode === 'server_only' ? 'server_only' : 'main_till') !== env) {
          if (!this.setMode(env, null).ok) return;
        }
        this.raw.prepare(`UPDATE store SET install_mode_env = ?`).run(env);
      }
      this.envPending = false;
    } catch {
      /* setMode refused (e.g. Till 1 shift open): try again later */
    }
  }

  private get raw() {
    return this.db.raw;
  }

  mode(): InstallMode {
    this.applyEnvMode();
    const r = this.raw.prepare(`SELECT install_mode FROM store LIMIT 1`).get() as { install_mode?: string } | undefined;
    return r?.install_mode === 'server_only' ? 'server_only' : 'main_till';
  }

  /** Active tills the licence allows. Trial and unlicensed dev copies: 2. */
  limit(): number {
    const forced = Number(process.env.DD_TILL_LIMIT);
    if (!LicenseService.enforced()) return Number.isFinite(forced) && forced > 0 ? Math.floor(forced) : 2;
    const st = this.licence.status();
    if (st.state === 'licensed' && st.licence) return Math.max(1, Number((st.licence as { tills?: number }).tills) || 1);
    if (st.state === 'trial') return 2;
    return 0;
  }

  /** Active tills count from Till 1 upwards; a till past the licence limit may not sell. */
  withinLimit(id: string): boolean {
    const rows = this.raw.prepare(`SELECT id FROM tills WHERE active = 1 ORDER BY code`).all() as Array<{ id: string }>;
    const i = rows.findIndex((r) => r.id === id);
    return i >= 0 && i < this.limit();
  }

  usedCount(): number {
    return Number((this.raw.prepare(`SELECT COUNT(*) AS n FROM tills WHERE active = 1`).get() as { n: number }).n);
  }

  // ---- request context -------------------------------------------------------------------

  /** Works out which till a request comes from. */
  resolve(req: Request): TillCtx {
    if (this.envPending) this.applyEnvMode();
    const local = isLoopback(req);
    const raw = req.headers[TILL_HEADER];
    const key = typeof raw === 'string' ? raw.trim() : '';
    let row: TillRow | undefined;
    try {
      if (key) {
        row = this.raw.prepare(`SELECT * FROM tills WHERE device_key_hash = ? AND active = 1`).get(sha(key)) as TillRow | undefined;
        if (!row) return { till: null, keyRejected: true, local };
      } else if (local) {
        row = this.raw.prepare(`SELECT * FROM tills WHERE id = 'till-1' AND active = 1`).get() as TillRow | undefined;
      }
    } catch {
      return { till: null, keyRejected: false, local };
    }
    if (!row) return { till: null, keyRejected: false, local };
    this.touch(row.id);
    return { till: this.ref(row), keyRejected: false, local };
  }

  private ref(r: TillRow): TillRef {
    return { id: r.id, code: Number(r.code), name: r.name, kind: r.kind };
  }

  private touch(id: string) {
    const now = Date.now();
    if (now - (this.seenWritten.get(id) ?? 0) < SEEN_WRITE_MS) return;
    this.seenWritten.set(id, now);
    try {
      this.raw.prepare(`UPDATE tills SET last_seen_at = ? WHERE id = ?`).run(new Date(now).toISOString(), id);
    } catch {
      /* read-only moments (restore) */
    }
  }

  // ---- registry ----------------------------------------------------------------------------

  private row(id: string): TillRow | undefined {
    return this.raw.prepare(`SELECT * FROM tills WHERE id = ?`).get(id) as TillRow | undefined;
  }

  get(id: string): TillRow | undefined {
    return this.row(id);
  }

  list(): { mode: InstallMode; limit: number; used: number; tills: TillView[] } {
    const rows = this.raw.prepare(`SELECT * FROM tills ORDER BY code`).all() as TillRow[];
    const shifts = this.raw
      .prepare(
        `SELECT t.id, t.till_id, t.opened_at, u.display_name AS opened_by_name, t.opening_float_paisa
         FROM till_shifts t LEFT JOIN users u ON u.id = t.opened_by WHERE t.closed_at IS NULL`,
      )
      .all() as Array<{ id: string; till_id: string; opened_at: string; opened_by_name: string | null; opening_float_paisa: number }>;
    const today = this.raw
      .prepare(
        `SELECT till_id, COUNT(*) AS n, COALESCE(SUM(total_paisa), 0) AS t FROM sales
         WHERE voided_at IS NULL AND recorded_at >= ? GROUP BY till_id`,
      )
      .all(pkDayStartIso()) as Array<{ till_id: string; n: number; t: number }>;
    const now = Date.now();
    const mode = this.mode();
    const tills = rows
      .filter((r) => !(r.kind === 'main' && mode === 'server_only' && !Number(r.active)))
      .map((r): TillView => {
        const sh = shifts.find((s) => s.till_id === r.id);
        const td = today.find((x) => x.till_id === r.id);
        const pairing = !!r.pair_code_hash && !!r.pair_expires_at && Date.parse(r.pair_expires_at) > now;
        const seen = r.last_seen_at ? Date.parse(r.last_seen_at) : NaN;
        return {
          id: r.id,
          code: Number(r.code),
          label: `T${r.code}`,
          name: r.name,
          kind: r.kind,
          active: Number(r.active) === 1,
          paired: r.kind === 'main' || !!r.device_key_hash,
          pairing,
          pair_expires_at: pairing ? r.pair_expires_at : null,
          device_name: r.device_name,
          last_seen_at: r.last_seen_at,
          online: Number.isFinite(seen) && now - seen < ONLINE_MS,
          next_bill_no: Number(r.next_bill_no),
          shift: sh
            ? { id: sh.id, opened_at: sh.opened_at, opened_by_name: sh.opened_by_name, opening_float_paisa: Number(sh.opening_float_paisa) }
            : null,
          today_sales: Number(td?.n ?? 0),
          today_total_paisa: Number(td?.t ?? 0),
        };
      });
    return { mode, limit: this.limit(), used: this.usedCount(), tills };
  }

  private newPairCode(id: string): { code: string; expiresAt: string } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + PAIR_MINUTES * 60_000).toISOString();
    this.raw
      .prepare(`UPDATE tills SET pair_code_hash = ?, pair_expires_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(sha(`${id}:${code}`), expiresAt, id);
    return { code, expiresAt };
  }

  /** Owner adds a till: next free number, pairing code shown once. */
  add(input: { name?: unknown; userId: string }):
    | { ok: true; till: TillView; pairCode: string; pairExpiresAt: string }
    | Fail {
    const limit = this.limit();
    if (this.usedCount() >= limit) return { ok: false, error: 'till_limit', limit };
    const codes = (this.raw.prepare(`SELECT code FROM tills`).all() as Array<{ code: number }>).map((r) => Number(r.code));
    let code = 2;
    while (codes.includes(code)) code++;
    if (code > 99) return { ok: false, error: 'till_limit', limit };
    const name = String(input.name ?? '').trim().slice(0, 40) || `Till ${code}`;
    const id = randomUUID();
    this.raw.prepare(`INSERT INTO tills (id, code, name, kind) VALUES (?, ?, ?, 'remote')`).run(id, code, name);
    const p = this.newPairCode(id);
    this.audit('till.add', input.userId, id, { code, name });
    return { ok: true, till: this.view(id)!, pairCode: p.code, pairExpiresAt: p.expiresAt };
  }

  /** New pairing code (new PC for this till): the old device key stops working. */
  repair(id: string, userId: string): { ok: true; till: TillView; pairCode: string; pairExpiresAt: string } | Fail {
    const r = this.row(id);
    if (!r) return { ok: false, error: 'not_found' };
    if (r.kind === 'main') return { ok: false, error: 'main_till_not_paired' };
    if (!Number(r.active)) return { ok: false, error: 'till_off' };
    this.raw.prepare(`UPDATE tills SET device_key_hash = NULL, device_name = NULL, paired_at = NULL WHERE id = ?`).run(id);
    const p = this.newPairCode(id);
    this.audit('till.pair_code', userId, id, {});
    return { ok: true, till: this.view(id)!, pairCode: p.code, pairExpiresAt: p.expiresAt };
  }

  /** A new till PC enters its code once and gets a device key. No session needed. */
  pair(input: { code?: unknown; deviceName?: unknown; ip: string }):
    | { ok: true; deviceKey: string; till: TillRef; store: string | null }
    | { ok: false; error: string; retry_after_s?: number } {
    const tkey = `pair:${input.ip}`;
    const wait = throttleWait(this.raw, tkey);
    if (wait > 0) return { ok: false, error: 'too_many_attempts', retry_after_s: wait };
    const code = String(input.code ?? '').replace(/\D/g, '');
    if (code.length !== 6) return { ok: false, error: 'invalid_pair_code' };
    const now = Date.now();
    const rows = this.raw
      .prepare(`SELECT * FROM tills WHERE pair_code_hash IS NOT NULL AND active = 1`)
      .all() as TillRow[];
    const hit = rows.find((r) => {
      const a = Buffer.from(sha(`${r.id}:${code}`));
      const b = Buffer.from(String(r.pair_code_hash));
      return a.length === b.length && timingSafeEqual(a, b);
    });
    if (!hit) {
      throttleFail(this.raw, tkey);
      return { ok: false, error: 'invalid_pair_code' };
    }
    if (!hit.pair_expires_at || Date.parse(hit.pair_expires_at) <= now) return { ok: false, error: 'pair_code_expired' };
    throttleClear(this.raw, tkey);
    const deviceKey = randomBytes(32).toString('base64url');
    const deviceName = String(input.deviceName ?? '').trim().slice(0, 60) || null;
    this.raw
      .prepare(
        `UPDATE tills SET device_key_hash = ?, device_name = ?, paired_at = ?, last_seen_at = ?,
           pair_code_hash = NULL, pair_expires_at = NULL, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(sha(deviceKey), deviceName, new Date(now).toISOString(), new Date(now).toISOString(), hit.id);
    this.audit('till.paired', null, hit.id, { device: deviceName, ip: input.ip });
    const store = this.raw.prepare(`SELECT name FROM store LIMIT 1`).get() as { name?: string } | undefined;
    return { ok: true, deviceKey, till: this.ref(hit), store: store?.name ?? null };
  }

  update(id: string, input: { name?: unknown; active?: unknown }, userId: string): { ok: true; till: TillView } | Fail {
    const r = this.row(id);
    if (!r) return { ok: false, error: 'not_found' };
    if (input.name !== undefined) {
      const name = String(input.name ?? '').trim().slice(0, 40);
      if (!name) return { ok: false, error: 'invalid_name' };
      this.raw.prepare(`UPDATE tills SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(name, id);
    }
    if (input.active !== undefined) {
      const on = Boolean(input.active);
      if (on !== (Number(r.active) === 1)) {
        if (r.kind === 'main' && this.mode() === 'server_only') return { ok: false, error: 'server_only_install' };
        if (!on && this.openShift(id)) return { ok: false, error: 'till_shift_open' };
        if (on && this.usedCount() >= this.limit()) return { ok: false, error: 'till_limit', limit: this.limit() };
        this.raw
          .prepare(`UPDATE tills SET active = ?, pair_code_hash = NULL, pair_expires_at = NULL, updated_at = datetime('now') WHERE id = ?`)
          .run(on ? 1 : 0, id);
        this.audit(on ? 'till.on' : 'till.off', userId, id, {});
      }
    }
    return { ok: true, till: this.view(id)! };
  }

  /** Main PC with till, or server-only (main PC has no till; Till 1 switched off). */
  setMode(mode: unknown, userId: string | null): { ok: true; mode: InstallMode } | Fail {
    if (mode !== 'main_till' && mode !== 'server_only') return { ok: false, error: 'invalid_mode' };
    const main = this.row('till-1');
    if (mode === 'server_only') {
      if (this.openShift('till-1')) return { ok: false, error: 'till_shift_open' };
      this.raw.prepare(`UPDATE tills SET active = 0 WHERE id = 'till-1'`).run();
    } else if (main && !Number(main.active)) {
      if (this.usedCount() >= this.limit()) return { ok: false, error: 'till_limit', limit: this.limit() };
      this.raw.prepare(`UPDATE tills SET active = 1 WHERE id = 'till-1'`).run();
    }
    this.raw.prepare(`UPDATE store SET install_mode = ?`).run(mode);
    this.audit('till.mode', userId, 'till-1', { mode });
    return { ok: true, mode };
  }

  private openShift(tillId: string): boolean {
    return !!this.raw.prepare(`SELECT 1 AS x FROM till_shifts WHERE till_id = ? AND closed_at IS NULL`).get(tillId);
  }

  view(id: string): TillView | null {
    return this.list().tills.find((t) => t.id === id) ?? null;
  }

  private audit(action: string, userId: string | null, tillId: string, payload: Record<string, unknown>) {
    try {
      this.raw
        .prepare(`INSERT INTO audit_log (id, action, user_id, subject_type, subject_id, payload_json) VALUES (?, ?, ?, 'till', ?, ?)`)
        .run(randomUUID(), action, userId, tillId, JSON.stringify(payload));
    } catch {
      /* audit is best effort */
    }
  }
}
