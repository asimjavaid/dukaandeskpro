import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { hashPin, isValidPinFormat, verifyPinHash } from './pin.util';
import { readShopRules, type ShopRules } from '../settings/shop-rules';
import { throttleClear, throttleFail, throttleWait } from '../common/throttle';
import type { StaffRole } from './session.types';

export type PublicUser = {
  id: string;
  displayName: string;
  role: StaffRole;
};

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService) {}

  needsSetup(): boolean {
    const row = this.db.raw
      .prepare(
        `SELECT COUNT(*) AS c FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.code = 'owner' AND u.disabled_at IS NULL AND u.pin_hash IS NOT NULL`,
      )
      .get() as { c: number };
    return row.c === 0;
  }

  listUsers(): PublicUser[] {
    const rows = this.db.raw
      .prepare(
        `SELECT u.id, u.display_name, r.code AS role
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.disabled_at IS NULL AND u.pin_hash IS NOT NULL
         ORDER BY CASE r.code WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.display_name`,
      )
      .all() as Array<{ id: string; display_name: string; role: string }>;
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      role: r.role as StaffRole,
    }));
  }

  getStore(): {
    id: string;
    name: string;
    phone?: string | null;
    address?: string | null;
    receipt_footer?: string | null;
    locale_default?: string;
    receipt_width_mm?: 58 | 80;
    receipt_printer_name?: string | null;
    receipt_print_enabled?: boolean;
    rules?: ShopRules;
  } | null {
    const row = this.db.raw
      .prepare(
        `SELECT id, name, phone, address, receipt_footer, locale_default,
                receipt_width_mm, receipt_printer_name, receipt_print_enabled
         FROM store LIMIT 1`,
      )
      .get() as
      | {
          id: string;
          name: string;
          phone: string | null;
          address: string | null;
          receipt_footer: string | null;
          locale_default: string;
          receipt_width_mm: number | null;
          receipt_printer_name: string | null;
          receipt_print_enabled: number | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      phone: row.phone ?? null,
      address: row.address ?? null,
      receipt_footer: row.receipt_footer ?? null,
      locale_default: row.locale_default ?? 'en',
      receipt_width_mm: Number(row.receipt_width_mm) === 58 ? 58 : 80,
      receipt_printer_name: row.receipt_printer_name ?? null,
      receipt_print_enabled: Number(row.receipt_print_enabled) !== 0,
      rules: readShopRules(this.db.raw),
    };
  }

  /**
   * First-run: create single local store + Owner with scrypt pin_hash.
   * Fails if an owner already exists.
   */
  setup(input: {
    displayName: string;
    pin: string;
    storeName?: string;
    localeDefault?: string;
  }):
    | {
        ok: true;
        user: PublicUser;
        store: { id: string; name: string; locale_default: string };
      }
    | { ok: false; error: string } {
    if (!this.needsSetup()) {
      return { ok: false, error: 'already_setup' };
    }
    const displayName = (input.displayName ?? '').trim();
    if (!displayName || displayName.length > 80) {
      return { ok: false, error: 'invalid_display_name' };
    }
    if (!isValidPinFormat(input.pin)) {
      return { ok: false, error: 'invalid_pin' };
    }
    const storeName = (input.storeName ?? 'My Store').trim() || 'My Store';
    if (storeName.length > 120) {
      return { ok: false, error: 'invalid_store_name' };
    }
    const localeRaw = (input.localeDefault ?? 'en').toLowerCase().trim();
    if (localeRaw !== 'en' && localeRaw !== 'ur') {
      return { ok: false, error: 'invalid_locale' };
    }
    const localeDefault = localeRaw;

    const storeId = randomUUID();
    const userId = randomUUID();
    const pinHash = hashPin(input.pin);

    const tx = this.db.raw.transaction(() => {
      this.db.raw
        .prepare(
          `INSERT INTO store (id, name, locale_default) VALUES (?, ?, ?)`,
        )
        .run(storeId, storeName, localeDefault);
      this.db.raw
        .prepare(
          `INSERT INTO users (id, role_id, display_name, pin_hash)
           VALUES (?, 'role-owner', ?, ?)`,
        )
        .run(userId, displayName, pinHash);
      this.db.raw
        .prepare(
          `INSERT OR IGNORE INTO staff (id, user_id, name, role_code) VALUES (?, ?, ?, 'owner')`,
        )
        .run(userId, userId, displayName);
    });
    tx();

    return {
      ok: true,
      user: { id: userId, displayName, role: 'owner' },
      store: { id: storeId, name: storeName, locale_default: localeDefault },
    };
  }

  /** Newest sign-in wins: older sessions of this user on other tills stop working. */
  markActiveTill(userId: string, tillId: string): void {
    this.db.raw
      .prepare(`UPDATE users SET active_till_id = ?, active_till_at = ? WHERE id = ?`)
      .run(tillId, Date.now(), userId);
  }

  pinLogin(
    userId: string | undefined,
    pin: string,
  ):
    | {
        ok: true;
        user: PublicUser;
        store: { id: string; name: string };
      }
    | { ok: false; error: string; retry_after_s?: number } {
    if (!isValidPinFormat(pin)) {
      return { ok: false, error: 'invalid_pin' };
    }

    const store = this.getStore();
    if (!store) {
      return { ok: false, error: 'not_setup' };
    }

    let resolvedId = userId?.trim() || '';
    if (!resolvedId) {
      const users = this.listUsers();
      if (users.length === 1) {
        resolvedId = users[0].id;
      } else {
        return { ok: false, error: 'user_required' };
      }
    }

    const user = this.db.raw
      .prepare(
        `SELECT u.id, u.display_name, r.code AS role, u.pin_hash
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = ? AND u.disabled_at IS NULL`,
      )
      .get(resolvedId) as
      | {
          id: string;
          display_name: string;
          role: string;
          pin_hash: string | null;
        }
      | undefined;

    // Persistent throttle: 5 wrong PINs per user in 15 min, kept across restarts.
    const tkey = `login:${resolvedId}`;
    const wait = throttleWait(this.db.raw, tkey);
    if (wait > 0) return { ok: false, error: 'too_many_attempts', retry_after_s: wait };
    if (!user || !verifyPinHash(pin, user.pin_hash)) {
      throttleFail(this.db.raw, tkey);
      return { ok: false, error: 'invalid_credentials' };
    }
    throttleClear(this.db.raw, tkey);

    return {
      ok: true,
      user: {
        id: user.id,
        displayName: user.display_name,
        role: user.role as StaffRole,
      },
      store,
    };
  }
}
