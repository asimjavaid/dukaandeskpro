import { currentTillId } from '../tills/till-context';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ListPage } from '../common/list-page';
import { parseMoneyPair } from '../common/amount';
import { DbService } from '../db/db.service';

export const EXPENSE_KINDS = ['bill', 'salary', 'commission'] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export type ExpenseRow = {
  id: string;
  kind: ExpenseKind;
  amount_paisa: number;
  expense_date: string;
  note: string | null;
  created_at: string;
  staff_id?: string | null;
  staff_name?: string | null;
  from_drawer?: number;
};

const TIMEZONE = 'Asia/Karachi';

export function karachiYmd(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export type ExpensePeriod = 'day' | 'month' | 'year' | 'all';

/** Inclusive Karachi calendar bounds. Dates are YYYY-MM-DD. */
export function expenseBounds(
  period: ExpensePeriod,
  today = karachiYmd(),
): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  if (period === 'day') return { from: today, to: today };
  if (period === 'year') {
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  const dd = String(last).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${dd}` };
}

function isYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, day] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === day
  );
}

@Injectable()
export class ExpensesService {
  constructor(private readonly db: DbService) {}

  list(period?: string, paging?: ListPage | null): {
    today: string;
    today_total_paisa: number;
    items: ExpenseRow[];
    total?: number;
    page?: number;
    pageSize?: number;
    period?: ExpensePeriod;
    from?: string;
    to?: string;
    period_total_paisa?: number;
  } {
    const today = karachiYmd();
    const total = this.db.raw
      .prepare(
        `SELECT COALESCE(SUM(amount_paisa), 0) AS total
         FROM expenses
         WHERE expense_date = ?`,
      )
      .get(today) as { total: number };
    const todayTotal = Number(total?.total ?? 0);

    if (period === 'all' || period === 'day' || period === 'month' || period === 'year') {
      const bounds =
        period === 'all' ? null : expenseBounds(period, today);
      const where = bounds
        ? 'WHERE expense_date >= ? AND expense_date <= ?'
        : '';
      const whereE = where.replace(/expense_date/g, 'e.expense_date');
      const args = bounds ? [bounds.from, bounds.to] : [];
      const sums = this.db.raw
        .prepare(
          `SELECT COUNT(*) AS c, COALESCE(SUM(amount_paisa), 0) AS total
           FROM expenses ${where}`,
        )
        .get(...args) as { c: number; total: number };
      let sql = `SELECT e.id, e.kind, e.amount_paisa, e.expense_date, e.note, e.created_at,
                e.staff_id, st.name AS staff_name, e.from_drawer
         FROM expenses e LEFT JOIN staff st ON st.id = e.staff_id ${whereE}
         ORDER BY e.expense_date DESC, e.created_at DESC`;
      const runArgs: Array<string | number> = [...args];
      if (paging) {
        sql += ' LIMIT ? OFFSET ?';
        runArgs.push(paging.pageSize, (paging.page - 1) * paging.pageSize);
      }
      const items = this.db.raw.prepare(sql).all(...runArgs) as ExpenseRow[];
      return {
        today,
        today_total_paisa: todayTotal,
        period,
        from: bounds?.from,
        to: bounds?.to,
        period_total_paisa: Number(sums?.total ?? 0),
        total: Number(sums?.c ?? 0),
        page: paging?.page,
        pageSize: paging?.pageSize,
        items,
      };
    }

    const items = this.db.raw
      .prepare(
        `SELECT e.id, e.kind, e.amount_paisa, e.expense_date, e.note, e.created_at,
                e.staff_id, st.name AS staff_name, e.from_drawer
         FROM expenses e LEFT JOIN staff st ON st.id = e.staff_id
         ORDER BY e.expense_date DESC, e.created_at DESC
         LIMIT 40`,
      )
      .all() as ExpenseRow[];
    return {
      today,
      today_total_paisa: todayTotal,
      items,
    };
  }

  create(input: {
    kind?: string;
    amountRs?: unknown;
    amountPaisa?: unknown;
    expenseDate?: string;
    note?: string;
    createdBy?: string;
  }):
    | { ok: true; expense: ExpenseRow; today_total_paisa: number; today: string }
    | { ok: false; error: string } {
    const kind = (input.kind ?? '').toLowerCase().trim();
    if (!EXPENSE_KINDS.includes(kind as ExpenseKind)) {
      return { ok: false, error: 'invalid_expense_kind' };
    }

    const parsed = parseMoneyPair(input.amountPaisa, input.amountRs, 'missing');
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const amountPaisa = parsed.paisa;
    if (amountPaisa <= 0) return { ok: false, error: 'invalid_amount' };

    const rawDate = (input.expenseDate ?? '').trim();
    const expenseDate = rawDate || karachiYmd();
    if (!isYmd(expenseDate)) {
      return { ok: false, error: 'invalid_date' };
    }

    const note =
      input.note != null && String(input.note).trim()
        ? String(input.note).trim().slice(0, 160)
        : null;

    const id = randomUUID();
    this.db.raw
      .prepare(
        `INSERT INTO expenses
           (till_id, id, kind, amount_paisa, expense_date, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(currentTillId() ?? 'till-1', id, kind, amountPaisa, expenseDate, note, input.createdBy ?? null);

    const expense = this.db.raw
      .prepare(
        `SELECT e.id, e.kind, e.amount_paisa, e.expense_date, e.note, e.created_at,
                e.staff_id, st.name AS staff_name, e.from_drawer
         FROM expenses e LEFT JOIN staff st ON st.id = e.staff_id WHERE e.id = ?`,
      )
      .get(id) as ExpenseRow;

    const listed = this.list();
    return {
      ok: true,
      expense,
      today: listed.today,
      today_total_paisa: listed.today_total_paisa,
    };
  }

  remove(id: string): { ok: true } | { ok: false; error: string } {
    const clean = (id ?? '').trim();
    if (!clean) return { ok: false, error: 'not_found' };
    const linked = this.db.raw
      .prepare(`SELECT staff_id FROM expenses WHERE id = ?`)
      .get(clean) as { staff_id: string | null } | undefined;
    // Salary entries are undone from the person's salary khata in Staff.
    if (linked?.staff_id) return { ok: false, error: 'salary_managed_in_staff' };
    const info = this.db.raw
      .prepare(`DELETE FROM expenses WHERE id = ?`)
      .run(clean);
    if (info.changes !== 1) return { ok: false, error: 'not_found' };
    return { ok: true };
  }
}
