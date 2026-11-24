import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DbService } from '../db/db.service';
import { hashPin, isValidPinFormat, verifyPinHash } from './pin.util';
import { throttleClear, throttleFail, throttleWait } from '../common/throttle';
import type { StaffRole } from './session.types';

/** No 0/O/1/I/L to avoid misreading a printed code. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRecoveryCode(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function normalizeRecoveryCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

type Fail = { ok: false; error: string; retry_after_s?: number };

@Injectable()
export class RecoveryService {
  constructor(private readonly db: DbService) {}

  status(userId: string): { has_code: boolean; acknowledged: boolean } {
    const r = this.db.raw
      .prepare(`SELECT acknowledged_at FROM owner_recovery WHERE user_id = ?`)
      .get(userId) as { acknowledged_at: string | null } | undefined;
    return { has_code: !!r, acknowledged: !!r?.acknowledged_at };
  }

  /** Replace the owner's code; returns the plain code once. */
  issue(userId: string): string {
    const code = newRecoveryCode();
    const now = new Date().toISOString();
    this.db.raw
      .prepare(
        `INSERT INTO owner_recovery (user_id, code_hash, created_at, acknowledged_at)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash,
           created_at = excluded.created_at, acknowledged_at = NULL`,
      )
      .run(userId, hashPin(normalizeRecoveryCode(code)), now);
    return code;
  }

  acknowledge(userId: string): { ok: boolean } {
    const r = this.db.raw
      .prepare(`UPDATE owner_recovery SET acknowledged_at = ? WHERE user_id = ?`)
      .run(new Date().toISOString(), userId);
    return { ok: r.changes > 0 };
  }

  /** Persistent (DB) throttle shared by every recovery attempt. */
  private limited(now: number): number {
    return throttleWait(this.db.raw, 'recovery', now);
  }

  /** Recovery code + new PIN → sets owner PIN, burns the code, issues a fresh one. */
  recover(input: { code: unknown; newPin: unknown; confirmPin?: unknown }):
    | {
        ok: true;
        user: { id: string; displayName: string; role: StaffRole };
        store: { id: string; name: string };
        code: string;
      }
    | Fail {
    const now = Date.now();
    const wait = this.limited(now);
    if (wait > 0) return { ok: false, error: 'too_many_attempts', retry_after_s: wait };
    if (!isValidPinFormat(input.newPin)) return { ok: false, error: 'invalid_pin' };
    if (input.confirmPin !== undefined && input.confirmPin !== input.newPin) {
      return { ok: false, error: 'pin_mismatch' };
    }
    const code = normalizeRecoveryCode(input.code);
    const owners = this.db.raw
      .prepare(
        `SELECT u.id, u.display_name, o.code_hash FROM users u
         JOIN roles r ON r.id = u.role_id
         JOIN owner_recovery o ON o.user_id = u.id
         WHERE r.code = 'owner' AND u.disabled_at IS NULL`,
      )
      .all() as Array<{ id: string; display_name: string; code_hash: string }>;
    const owner = code.length === 12 ? owners.find((o) => verifyPinHash(code, o.code_hash)) : undefined;
    if (!owner) {
      throttleFail(this.db.raw, 'recovery', now);
      return { ok: false, error: 'bad_recovery_code' };
    }
    const store = this.db.raw.prepare(`SELECT id, name FROM store LIMIT 1`).get() as
      | { id: string; name: string }
      | undefined;
    if (!store) return { ok: false, error: 'not_setup' };
    let fresh = '';
    this.db.raw.transaction(() => {
      this.db.raw
        .prepare(`UPDATE users SET pin_hash = ?, updated_at = ? WHERE id = ?`)
        .run(hashPin(input.newPin as string), new Date().toISOString(), owner.id);
      fresh = this.issue(owner.id);
    })();
    throttleClear(this.db.raw, 'recovery');
    return {
      ok: true,
      user: { id: owner.id, displayName: owner.display_name, role: 'owner' },
      store,
      code: fresh,
    };
  }
}
