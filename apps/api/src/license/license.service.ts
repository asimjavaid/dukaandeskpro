import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as lic from '@dukaandeskpro/license';
import type { LicenceStatus } from '@dukaandeskpro/license';
import { DbService } from '../db/db.service';

const CACHE_MS = 60_000;
const DAY = 24 * 60 * 60 * 1000;
const USAGE_FLUSH_MS = 2 * 60_000;

/** Newest record time in the shop data: [table, column] pairs (ISO or SQLite 'YYYY-MM-DD HH:MM:SS' UTC). */
const DATA_TIME_COLUMNS: Array<[string, string]> = [
  ['sales', 'recorded_at'],
  ['sales', 'created_at'],
  ['audit_log', 'created_at'],
  ['purchase_invoices', 'created_at'],
  ['stock_adjustments', 'created_at'],
  ['expenses', 'created_at'],
  ['auto_backup', 'last_at'],
];

export function parseDbTime(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * Trial + licence state for this PC. Uses the shared @dukaandeskpro/license core + SQLite copy.
 * Also: counts active-use minutes (heartbeats from the app while someone is using it) for the
 * trial usage cap, checks the clock against the newest shop record, and honours a failed
 * integrity check reported by the desktop app (DD_INTEGRITY_FAIL=1).
 */
@Injectable()
export class LicenseService implements OnModuleDestroy {
  private cached: { at: number; status: LicenceStatus } | null = null;
  private activeMinutes = new Set<number>();
  private flushTimer: NodeJS.Timeout | null = null;
  private hookApplied = false;

  constructor(private readonly db: DbService) {
    if (LicenseService.enforced()) {
      this.flushTimer = setInterval(() => this.flushUsage(), USAGE_FLUSH_MS);
      this.flushTimer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushUsage();
  }

  /** Licence is only enforced when the packaged desktop app starts the API with DD_LICENSE_ENFORCE=1. */
  static enforced(): boolean {
    return process.env.DD_LICENSE_ENFORCE === '1';
  }

  private integrityOk(): boolean {
    return process.env.DD_INTEGRITY_FAIL !== '1';
  }

  /** Newest timestamp found in the shop data, or null. */
  dataNewest(): number | null {
    let max: number | null = null;
    for (const [table, col] of DATA_TIME_COLUMNS) {
      try {
        const row = this.db.raw.prepare(`SELECT MAX(${col}) AS v FROM ${table}`).get() as { v?: unknown } | undefined;
        const t = parseDbTime(row?.v);
        if (t != null && (max == null || t > max)) max = t;
      } catch {
        /* table missing in an old DB */
      }
    }
    return max;
  }

  private check(extra: { newKey?: string; addUsageMinutes?: number } = {}): LicenceStatus {
    this.applyTestHook();
    return lic.checkThisMachine({
      db: this.db.raw,
      dataNewest: this.dataNewest(),
      integrityOk: this.integrityOk(),
      ...extra,
    });
  }

  status(force = false): LicenceStatus {
    const now = Date.now();
    if (!LicenseService.enforced()) {
      // Dev / watch copy: always licensed, no trial pill, nothing written.
      return {
        state: 'licensed', locked: false, readOnly: false, machineCode: 'DEV', trialDays: 14, trialStartedAt: '', trialEndsAt: '',
        daysLeft: 0, tampered: false, licence: null, activationError: null,
      } as LicenceStatus;
    }
    if (!force && this.cached && now - this.cached.at < CACHE_MS && now >= this.cached.at) {
      return this.cached.status;
    }
    let status: LicenceStatus;
    try {
      status = this.check();
    } catch (e) {
      // Fingerprint unavailable -> fail closed (read-only).
      status = {
        state: 'expired', locked: true, readOnly: true, machineCode: 'UNAVAILABLE', trialDays: 14,
        trialStartedAt: '', trialEndsAt: '', daysLeft: 0, tampered: false, licence: null,
        activationError: (e as Error).message,
      };
    }
    this.cached = { at: now, status };
    return status;
  }

  activate(key: string): LicenceStatus {
    if (!LicenseService.enforced()) return this.status();
    const status = this.check({ newKey: key });
    this.cached = { at: Date.now(), status };
    return status;
  }

  /** The app reports "someone used me in the last minute". Counted per wall-clock minute. */
  heartbeat() {
    if (!LicenseService.enforced()) return;
    this.activeMinutes.add(Math.floor(Date.now() / 60_000));
  }

  /** Add the counted minutes to the trial usage (all four stores). */
  flushUsage(): LicenceStatus | null {
    const n = this.activeMinutes.size;
    if (!n || !LicenseService.enforced()) return null;
    this.activeMinutes.clear();
    try {
      const status = this.check({ addUsageMinutes: n });
      this.cached = { at: Date.now(), status };
      return status;
    } catch {
      return null;
    }
  }

  /** Forget the cached state. */
  invalidate() {
    this.cached = null;
  }

  /**
   * Test hook, unpackaged builds only: DD_LICENSE_TEST_DAYS=15 back-dates the trial start to
   * 15 days ago; DD_LICENSE_TEST_USAGE_MIN=N adds N used minutes once. Both can only shorten a
   * trial, never extend it. Ignored when DD_LICENSE_PACKAGED=1.
   */
  private applyTestHook() {
    if (this.hookApplied) return;
    this.hookApplied = true;
    if (process.env.DD_LICENSE_PACKAGED === '1') return;
    const d = Number(process.env.DD_LICENSE_TEST_DAYS);
    const u = Number(process.env.DD_LICENSE_TEST_USAGE_MIN);
    try {
      if (process.env.DD_LICENSE_TEST_DAYS && Number.isFinite(d) && d > 0) lic.checkThisMachine({ db: this.db.raw, now: Date.now() - d * DAY });
      if (process.env.DD_LICENSE_TEST_USAGE_MIN && Number.isFinite(u) && u > 0) lic.checkThisMachine({ db: this.db.raw, addUsageMinutes: u });
    } catch {
      /* fingerprint unavailable: status() fails closed anyway */
    }
  }

  hasFeature(feature: string): boolean {
    return lic.hasFeature(this.status(), feature);
  }
}
