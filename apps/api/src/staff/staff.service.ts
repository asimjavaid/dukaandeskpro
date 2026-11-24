import { currentTillId } from '../tills/till-context';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { hashPin, isValidPinFormat } from '../auth/pin.util';
import { parseNonNegativeRupees } from '../common/amount';

export type StaffRoleCode = 'owner' | 'manager' | 'cashier' | 'data_entry' | 'helper';
const LOGIN_ROLES = ['manager', 'cashier', 'data_entry'] as const;
const EDITABLE_ROLES = ['manager', 'cashier', 'data_entry', 'helper'] as const;
const ROLE_ID: Record<string, string> = {
  manager: 'role-manager',
  cashier: 'role-cashier',
  data_entry: 'role-data-entry',
};

export type StaffUserPublic = {
  id: string;
  display_name: string;
  role: StaffRoleCode;
  disabled_at: string | null;
  created_at: string;
};

export type StaffPublic = StaffUserPublic & {
  name: string;
  has_login: boolean;
  position: string | null;
  phone: string | null;
  address: string | null;
  monthly_salary_paisa: number | null;
  salary_balance_paisa: number;
  advance_paisa: number;
};

export type LedgerKind = 'salary_due' | 'payment' | 'advance' | 'deduction' | 'bonus';

export type LedgerRow = {
  id: string;
  entry_date: string;
  kind: LedgerKind;
  amount_paisa: number;
  period: string | null;
  note: string | null;
  from_drawer: number | null;
  created_at: string;
  voided_at: string | null;
  can_void: boolean;
};

type Fail = { ok: false; error: string };

const TZ = 'Asia/Karachi';
export function karachiYmd(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function isYmd(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export function isPeriod(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

function cleanText(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

type StaffDbRow = {
  id: string;
  user_id: string | null;
  name: string;
  role_code: StaffRoleCode;
  position: string | null;
  phone: string | null;
  address: string | null;
  monthly_salary_paisa: number | null;
  left_at: string | null;
  created_at: string;
  pin_hash: string | null;
};

@Injectable()
export class StaffService {
  constructor(private readonly db: DbService) {}

  /** Every login user has a staff row (covers restores of older copies and new owners). */
  private sync(): void {
    this.db.raw
      .prepare(
        `INSERT OR IGNORE INTO staff (id, user_id, name, role_code, left_at, created_at, updated_at)
         SELECT u.id, u.id, u.display_name, r.code, u.disabled_at, u.created_at, u.updated_at
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE u.pin_hash IS NOT NULL AND u.id NOT IN (SELECT id FROM staff)`,
      )
      .run();
  }

  private row(id: string): StaffDbRow | undefined {
    this.sync();
    return this.db.raw
      .prepare(
        `SELECT s.*, u.pin_hash FROM staff s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .get(id) as StaffDbRow | undefined;
  }

  private balances(staffId: string): { salary: number; advance: number } {
    const r = this.db.raw
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN kind IN ('salary_due','bonus') THEN amount_paisa
                             WHEN kind IN ('payment','deduction') THEN -amount_paisa END), 0) AS salary,
           COALESCE(SUM(CASE WHEN kind = 'advance' THEN amount_paisa
                             WHEN kind = 'deduction' THEN -amount_paisa END), 0) AS advance
         FROM staff_ledger WHERE staff_id = ? AND voided_at IS NULL`,
      )
      .get(staffId) as { salary: number; advance: number };
    return { salary: Number(r.salary) || 0, advance: Number(r.advance) || 0 };
  }

  private toPublic(r: StaffDbRow): StaffPublic {
    const b = this.balances(r.id);
    return {
      id: r.id,
      display_name: r.name,
      name: r.name,
      role: r.role_code,
      has_login: !!r.user_id && r.role_code !== 'helper' && !!r.pin_hash,
      position: r.position,
      phone: r.phone,
      address: r.address,
      monthly_salary_paisa: r.monthly_salary_paisa,
      disabled_at: r.left_at,
      created_at: r.created_at,
      salary_balance_paisa: b.salary,
      advance_paisa: b.advance,
    };
  }

  /** All staff (active + left). Never includes PIN data. */
  list(): StaffPublic[] {
    this.sync();
    const rows = this.db.raw
      .prepare(
        `SELECT s.*, u.pin_hash FROM staff s LEFT JOIN users u ON u.id = s.user_id
         ORDER BY CASE s.role_code WHEN 'owner' THEN 0 ELSE 1 END,
                  CASE WHEN s.left_at IS NULL THEN 0 ELSE 1 END,
                  s.name COLLATE NOCASE`,
      )
      .all() as StaffDbRow[];
    return rows.map((r) => this.toPublic(r));
  }

  get(id: string): { ok: true; staff: StaffPublic; ledger: LedgerRow[] } | Fail {
    const r = this.row(id);
    if (!r) return { ok: false, error: 'not_found' };
    return { ok: true, staff: this.toPublic(r), ledger: this.ledger(id) };
  }

  ledger(staffId: string): LedgerRow[] {
    const today = karachiYmd();
    const rows = this.db.raw
      .prepare(
        `SELECT l.id, l.entry_date, l.kind, l.amount_paisa, l.period, l.note, l.created_at, l.voided_at,
                e.from_drawer
         FROM staff_ledger l LEFT JOIN expenses e ON e.id = l.expense_id
         WHERE l.staff_id = ?
         ORDER BY l.entry_date, l.created_at, l.rowid`,
      )
      .all(staffId) as Array<Omit<LedgerRow, 'can_void'>>;
    return rows.map((r) => ({
      ...r,
      from_drawer: r.from_drawer == null ? null : Number(r.from_drawer),
      can_void:
        !r.voided_at &&
        r.kind !== 'deduction' &&
        karachiYmd(new Date(r.created_at.includes('T') ? r.created_at : `${r.created_at.replace(' ', 'T')}Z`)) === today,
    }));
  }

  private parseSalary(input: { monthlySalaryRs?: unknown; monthlySalaryPaisa?: unknown }):
    | { ok: true; value: number | null | undefined }
    | Fail {
    if (input.monthlySalaryPaisa !== undefined) {
      if (input.monthlySalaryPaisa === null) return { ok: true, value: null };
      const n = Number(input.monthlySalaryPaisa);
      if (!Number.isSafeInteger(n) || n < 0) return { ok: false, error: 'invalid_amount' };
      return { ok: true, value: n || null };
    }
    if (input.monthlySalaryRs === undefined) return { ok: true, value: undefined };
    if (input.monthlySalaryRs === null || input.monthlySalaryRs === '') return { ok: true, value: null };
    const p = parseNonNegativeRupees(input.monthlySalaryRs, 'zero');
    if (!p.ok) return { ok: false, error: p.error };
    return { ok: true, value: p.paisa || null };
  }

  create(input: {
    name?: string;
    role?: string;
    position?: unknown;
    phone?: unknown;
    address?: unknown;
    monthlySalaryRs?: unknown;
    monthlySalaryPaisa?: unknown;
    pin?: string;
  }): { ok: true; staff: StaffPublic; pin_once: string | null } | Fail {
    const name = (input.name ?? '').trim();
    if (!name || name.length > 80) return { ok: false, error: 'invalid_display_name' };
    const role = (input.role ?? 'cashier').trim() as StaffRoleCode;
    if (!(EDITABLE_ROLES as readonly string[]).includes(role)) return { ok: false, error: 'invalid_role' };
    const login = (LOGIN_ROLES as readonly string[]).includes(role);
    if (login && !isValidPinFormat(input.pin)) return { ok: false, error: 'invalid_pin' };
    const salary = this.parseSalary(input);
    if (!salary.ok) return salary;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.raw.transaction(() => {
      if (login) {
        this.db.raw
          .prepare(
            `INSERT INTO users (id, role_id, display_name, pin_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(id, ROLE_ID[role], name, hashPin(input.pin as string), now, now);
      }
      this.db.raw
        .prepare(
          `INSERT INTO staff (id, user_id, name, role_code, position, phone, address,
                              monthly_salary_paisa, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          login ? id : null,
          name,
          role,
          cleanText(input.position, 60),
          cleanText(input.phone, 32),
          cleanText(input.address, 240),
          salary.value ?? null,
          now,
          now,
        );
    })();
    const r = this.row(id)!;
    return { ok: true, staff: this.toPublic(r), pin_once: login ? (input.pin as string) : null };
  }

  /** Back-compat (Slice 8): cashier with PIN. */
  createCashier(input: { displayName: string; pin: string }):
    | { ok: true; user: StaffUserPublic; pin_once: string }
    | Fail {
    const res = this.create({ name: input.displayName, role: 'cashier', pin: input.pin });
    if (!res.ok) return res;
    const s = res.staff;
    return {
      ok: true,
      user: { id: s.id, display_name: s.name, role: s.role, disabled_at: s.disabled_at, created_at: s.created_at },
      pin_once: input.pin,
    };
  }

  update(
    id: string,
    input: {
      name?: string;
      role?: string;
      position?: unknown;
      phone?: unknown;
      address?: unknown;
      monthlySalaryRs?: unknown;
      monthlySalaryPaisa?: unknown;
      pin?: string;
    },
  ): { ok: true; staff: StaffPublic; pin_once: string | null } | Fail {
    const r = this.row(id);
    if (!r) return { ok: false, error: 'not_found' };
    const name = input.name === undefined ? r.name : (input.name ?? '').trim();
    if (!name || name.length > 80) return { ok: false, error: 'invalid_display_name' };
    let role = r.role_code;
    if (input.role !== undefined && input.role !== r.role_code) {
      if (r.role_code === 'owner') return { ok: false, error: 'cannot_change_owner' };
      if (!(EDITABLE_ROLES as readonly string[]).includes(input.role)) return { ok: false, error: 'invalid_role' };
      role = input.role as StaffRoleCode;
    }
    const salary = this.parseSalary(input);
    if (!salary.ok) return salary;
    const login = (LOGIN_ROLES as readonly string[]).includes(role);
    const pinGiven = input.pin != null && input.pin !== '';
    if (pinGiven && !isValidPinFormat(input.pin)) return { ok: false, error: 'invalid_pin' };
    const needsUser = login && !r.user_id;
    if (needsUser && !pinGiven) return { ok: false, error: 'invalid_pin' };
    const now = new Date().toISOString();
    const pick = (v: unknown, cur: string | null, max: number) => (v === undefined ? cur : cleanText(v, max));
    this.db.raw.transaction(() => {
      let userId = r.user_id;
      if (needsUser) {
        userId = r.id;
        this.db.raw
          .prepare(
            `INSERT INTO users (id, role_id, display_name, pin_hash, disabled_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(userId, ROLE_ID[role], name, hashPin(input.pin as string), r.left_at, now, now);
      } else if (userId) {
        const roleId = role === 'owner' ? 'role-owner' : ROLE_ID[role] ?? null;
        // Helper keeps the user row (history) but can no longer log in.
        const disabled = r.left_at ?? (login || role === 'owner' ? null : now);
        this.db.raw
          .prepare(
            `UPDATE users SET display_name = ?, role_id = COALESCE(?, role_id), disabled_at = ?,
                              pin_hash = COALESCE(?, pin_hash), updated_at = ? WHERE id = ?`,
          )
          .run(name, roleId, disabled, pinGiven && role !== 'owner' ? hashPin(input.pin as string) : null, now, userId);
      }
      this.db.raw
        .prepare(
          `UPDATE staff SET user_id = ?, name = ?, role_code = ?, position = ?, phone = ?, address = ?,
                            monthly_salary_paisa = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          userId,
          name,
          role,
          pick(input.position, r.position, 60),
          pick(input.phone, r.phone, 32),
          pick(input.address, r.address, 240),
          salary.value === undefined ? r.monthly_salary_paisa : salary.value,
          now,
          id,
        );
    })();
    return {
      ok: true,
      staff: this.toPublic(this.row(id)!),
      pin_once: pinGiven && login ? (input.pin as string) : null,
    };
  }

  resetPin(id: string, pin: string): { ok: true; pin_once: string } | Fail {
    const r = this.row(id);
    if (!r) return { ok: false, error: 'not_found' };
    if (r.role_code === 'owner') return { ok: false, error: 'cannot_change_owner' };
    if (!r.user_id || r.role_code === 'helper') return { ok: false, error: 'no_login' };
    if (!isValidPinFormat(pin)) return { ok: false, error: 'invalid_pin' };
    this.db.raw
      .prepare(`UPDATE users SET pin_hash = ?, updated_at = ? WHERE id = ?`)
      .run(hashPin(pin), new Date().toISOString(), r.user_id);
    return { ok: true, pin_once: pin };
  }

  /** Mark as left: no login, no salary runs. Cannot disable owner. */
  deactivate(id: string): { ok: true; user: StaffPublic } | Fail {
    const r = this.row(id);
    if (!r) return { ok: false, error: 'not_found' };
    if (r.role_code === 'owner') return { ok: false, error: 'cannot_disable_owner' };
    if (!r.left_at) {
      const now = new Date().toISOString();
      this.db.raw.transaction(() => {
        this.db.raw.prepare(`UPDATE staff SET left_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
        if (r.user_id) {
          this.db.raw.prepare(`UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?`).run(now, now, r.user_id);
        }
      })();
    }
    return { ok: true, user: this.toPublic(this.row(id)!) };
  }

  activate(id: string): { ok: true; user: StaffPublic } | Fail {
    const r = this.row(id);
    if (!r) return { ok: false, error: 'not_found' };
    const now = new Date().toISOString();
    this.db.raw.transaction(() => {
      this.db.raw.prepare(`UPDATE staff SET left_at = NULL, updated_at = ? WHERE id = ?`).run(now, id);
      if (r.user_id && r.role_code !== 'helper') {
        this.db.raw.prepare(`UPDATE users SET disabled_at = NULL, updated_at = ? WHERE id = ?`).run(now, r.user_id);
      }
    })();
    return { ok: true, user: this.toPublic(this.row(id)!) };
  }

  // ---------------- Salary ----------------

  /** Preview of the monthly run: who gets salary, what advance is deducted, what is payable. */
  runPreview(period: string): {
    ok: true;
    period: string;
    done: boolean;
    rows: Array<{
      staff_id: string;
      name: string;
      salary_paisa: number;
      deduction_paisa: number;
      payable_paisa: number;
      already_run: boolean;
    }>;
  } | Fail {
    if (!isPeriod(period)) return { ok: false, error: 'invalid_period' };
    this.sync();
    const staff = this.db.raw
      .prepare(
        `SELECT id, name, monthly_salary_paisa FROM staff
         WHERE left_at IS NULL AND monthly_salary_paisa > 0 ORDER BY name COLLATE NOCASE`,
      )
      .all() as Array<{ id: string; name: string; monthly_salary_paisa: number }>;
    const rows = staff.map((s) => {
      const done = this.db.raw
        .prepare(
          `SELECT 1 FROM staff_ledger WHERE staff_id = ? AND period = ? AND kind = 'salary_due' AND voided_at IS NULL`,
        )
        .get(s.id, period);
      const b = this.balances(s.id);
      const salary = s.monthly_salary_paisa;
      const deduction = done ? 0 : Math.min(Math.max(b.advance, 0), salary);
      return {
        staff_id: s.id,
        name: s.name,
        salary_paisa: salary,
        deduction_paisa: deduction,
        payable_paisa: done ? Math.max(b.salary, 0) : b.salary + salary - deduction,
        already_run: !!done,
      };
    });
    return { ok: true, period, done: rows.length > 0 && rows.every((r) => r.already_run), rows };
  }

  /** Adds salary due for the month and auto-deducts outstanding advances. Idempotent per person + month. */
  run(period: string, createdBy?: string): { ok: true; added: number; deducted_paisa: number } | Fail {
    if (!isPeriod(period)) return { ok: false, error: 'invalid_period' };
    const preview = this.runPreview(period);
    if (!preview.ok) return preview;
    const today = karachiYmd();
    const now = new Date().toISOString();
    let added = 0;
    let deducted = 0;
    const ins = this.db.raw.prepare(
      `INSERT INTO staff_ledger (id, staff_id, entry_date, kind, amount_paisa, period, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.raw.transaction(() => {
      for (const r of preview.rows) {
        if (r.already_run) continue;
        ins.run(randomUUID(), r.staff_id, today, 'salary_due', r.salary_paisa, period, null, createdBy ?? null, now);
        added += 1;
        if (r.deduction_paisa > 0) {
          ins.run(randomUUID(), r.staff_id, today, 'deduction', r.deduction_paisa, period, null, createdBy ?? null, now);
          deducted += r.deduction_paisa;
        }
      }
    })();
    return { ok: true, added, deducted_paisa: deducted };
  }

  /** Payment (against salary), advance (loan, recovered in next runs) or bonus (added to salary). */
  addEntry(
    staffId: string,
    input: {
      kind?: string;
      amountRs?: unknown;
      amountPaisa?: unknown;
      date?: string;
      fromDrawer?: boolean;
      note?: unknown;
      period?: string;
      createdBy?: string;
    },
  ): { ok: true; entry: LedgerRow; staff: StaffPublic } | Fail {
    const r = this.row(staffId);
    if (!r) return { ok: false, error: 'not_found' };
    const kind = (input.kind ?? '').trim();
    if (!['payment', 'advance', 'bonus'].includes(kind)) return { ok: false, error: 'invalid_kind' };
    let amount: number;
    if (input.amountPaisa !== undefined) {
      amount = Number(input.amountPaisa);
      if (!Number.isSafeInteger(amount)) return { ok: false, error: 'invalid_amount' };
    } else {
      const p = parseNonNegativeRupees(input.amountRs, 'missing');
      if (!p.ok) return { ok: false, error: p.error };
      amount = p.paisa;
    }
    if (amount <= 0) return { ok: false, error: 'invalid_amount' };
    const date = (input.date ?? '').trim() || karachiYmd();
    if (!isYmd(date) || date > karachiYmd()) return { ok: false, error: 'invalid_date' };
    const period = input.period && isPeriod(input.period) ? input.period : date.slice(0, 7);
    if (kind === 'payment') {
      const b = this.balances(staffId);
      if (amount > b.salary) return { ok: false, error: 'payment_over_balance' };
    }
    const note = cleanText(input.note, 160);
    const fromDrawer = input.fromDrawer === false ? 0 : 1;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.raw.transaction(() => {
      let expenseId: string | null = null;
      if (kind !== 'bonus') {
        expenseId = randomUUID();
        const label = `${kind === 'advance' ? 'Advance' : 'Salary'} · ${r.name}${note ? ` · ${note}` : ''}`;
        this.db.raw
          .prepare(
            `INSERT INTO expenses (till_id, id, kind, amount_paisa, expense_date, note, created_by, staff_id, from_drawer)
             VALUES (?, ?, 'salary', ?, ?, ?, ?, ?, ?)`,
          )
          .run(currentTillId() ?? 'till-1', expenseId, amount, date, label.slice(0, 160), input.createdBy ?? null, staffId, fromDrawer);
      }
      this.db.raw
        .prepare(
          `INSERT INTO staff_ledger (id, staff_id, entry_date, kind, amount_paisa, period, expense_id, note, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, staffId, date, kind, amount, period, expenseId, note, input.createdBy ?? null, now);
    })();
    const entry = this.ledger(staffId).find((e) => e.id === id)!;
    return { ok: true, entry, staff: this.toPublic(this.row(staffId)!) };
  }

  /** Same PKT day only. Voiding a month's salary also voids that month's advance deduction. */
  voidEntry(staffId: string, entryId: string): { ok: true; staff: StaffPublic } | Fail {
    const e = this.ledger(staffId).find((x) => x.id === entryId);
    if (!e) return { ok: false, error: 'not_found' };
    if (e.voided_at) return { ok: false, error: 'already_voided' };
    if (!e.can_void) return { ok: false, error: 'void_same_day_only' };
    const now = new Date().toISOString();
    this.db.raw.transaction(() => {
      const ids = [entryId];
      if (e.kind === 'salary_due' && e.period) {
        const d = this.db.raw
          .prepare(
            `SELECT id FROM staff_ledger WHERE staff_id = ? AND period = ? AND kind = 'deduction' AND voided_at IS NULL`,
          )
          .all(staffId, e.period) as Array<{ id: string }>;
        ids.push(...d.map((x) => x.id));
      }
      for (const id of ids) {
        const row = this.db.raw.prepare(`SELECT expense_id FROM staff_ledger WHERE id = ?`).get(id) as
          | { expense_id: string | null }
          | undefined;
        if (row?.expense_id) this.db.raw.prepare(`DELETE FROM expenses WHERE id = ?`).run(row.expense_id);
        this.db.raw.prepare(`UPDATE staff_ledger SET voided_at = ? WHERE id = ?`).run(now, id);
      }
    })();
    return { ok: true, staff: this.toPublic(this.row(staffId)!) };
  }
}
