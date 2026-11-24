import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { parseMoneyPair } from '../common/amount';

type Fail = { ok: false; error: string };

export type TillSummary = {
  opening_float_paisa: number;
  cash_sales_paisa: number;
  udhaar_received_paisa: number;
  refunds_cash_paisa: number;
  expenses_paisa: number;
  cash_in_paisa: number;
  cash_out_paisa: number;
  expected_paisa: number;
  sale_count: number;
  sales_total_paisa: number;
  udhaar_given_paisa: number;
  return_count: number;
  returns_total_paisa: number;
  /** JazzCash / Easypaisa / bank in this shift (not in the drawer). */
  digital_paisa: number;
};

export type TillMove = {
  id: string;
  kind: 'in' | 'out';
  amount_paisa: number;
  reason: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type TillShift = {
  id: string;
  till_id: string;
  till_code: number | null;
  till_name: string | null;
  opened_at: string;
  opened_by_name: string | null;
  opening_float_paisa: number;
  closed_at: string | null;
  closed_by_name: string | null;
  expected_paisa: number | null;
  counted_paisa: number | null;
  over_short_paisa: number | null;
  note: string | null;
};

type ShiftRow = TillShift & { summary_json: string | null };

const SHIFT_SELECT = `SELECT t.id, t.till_id, tl.code AS till_code, tl.name AS till_name, t.opened_at, ou.display_name AS opened_by_name, t.opening_float_paisa,
  t.closed_at, cu.display_name AS closed_by_name, t.expected_paisa, t.counted_paisa,
  t.over_short_paisa, t.note, t.summary_json
  FROM till_shifts t
  LEFT JOIN users ou ON ou.id = t.opened_by
  LEFT JOIN users cu ON cu.id = t.closed_by
  LEFT JOIN tills tl ON tl.id = t.till_id`;

function moneyIn(paisa: unknown, rs: unknown, allowZero: boolean): { ok: true; paisa: number } | Fail {
  const m = parseMoneyPair(paisa, rs, 'missing');
  if (!m.ok) return { ok: false, error: m.error };
  if (!allowZero && m.paisa <= 0) return { ok: false, error: 'invalid_amount' };
  if (m.paisa > 100_000_000_00) return { ok: false, error: 'invalid_amount' };
  return { ok: true, paisa: m.paisa };
}

/**
 * Till (cash drawer) shifts. One open shift per till; every figure is for that till only. Expected cash =
 * opening float + cash sales + udhaar collected − cash refunds − drawer
 * expenses + cash in − cash out, all inside the shift's time window.
 */
@Injectable()
export class TillService {
  constructor(private readonly db: DbService) {}

  private openRow(tillId: string): ShiftRow | undefined {
    return this.db.raw.prepare(`${SHIFT_SELECT} WHERE t.closed_at IS NULL AND t.till_id = ? LIMIT 1`).get(tillId) as
      | ShiftRow
      | undefined;
  }

  private pub(r: ShiftRow): TillShift {
    const { summary_json: _s, ...rest } = r;
    void _s;
    return { ...rest, till_code: rest.till_code == null ? null : Number(rest.till_code) };
  }

  moves(shiftId: string): TillMove[] {
    return this.db.raw
      .prepare(
        `SELECT m.id, m.kind, m.amount_paisa, m.reason, u.display_name AS created_by_name, m.created_at
         FROM till_moves m LEFT JOIN users u ON u.id = m.created_by
         WHERE m.shift_id = ? ORDER BY m.created_at, m.id`,
      )
      .all(shiftId) as TillMove[];
  }

  summary(shift: { id: string; till_id: string; opened_at: string; opening_float_paisa: number; closed_at: string | null }, until = new Date().toISOString()): TillSummary {
    const from = shift.opened_at;
    const to = shift.closed_at ?? until;
    const q = <T>(sql: string, ...args: unknown[]) => this.db.raw.prepare(sql).get(...args) as T;
    const s = q<{ n: number; total: number; cash: number; udhaar: number; digital: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_paisa), 0) AS total,
              COALESCE(SUM(digital_paisa), 0) AS digital,
              COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_paisa - digital_paisa
                                WHEN payment_method = 'split' THEN cash_amount_paisa - digital_paisa ELSE 0 END), 0) AS cash,
              COALESCE(SUM(CASE WHEN payment_method = 'udhaar' THEN total_paisa
                                WHEN payment_method = 'split' THEN udhaar_amount_paisa ELSE 0 END), 0) AS udhaar
       FROM sales WHERE voided_at IS NULL AND till_id = ? AND recorded_at >= ? AND recorded_at <= ?`,
      shift.till_id,
      from,
      to,
    );
    const r = q<{ n: number; total: number; cash: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_paisa), 0) AS total, COALESCE(SUM(refund_cash_paisa), 0) AS cash
       FROM sale_returns WHERE till_id = ? AND recorded_at >= ? AND recorded_at <= ?`,
      shift.till_id,
      from,
      to,
    );
    const col = q<{ t: number }>(
      `SELECT COALESCE(SUM(l.amount_paisa), 0) AS t
       FROM party_ledger l LEFT JOIN sales s ON s.id = l.sale_id
       WHERE l.entry_type = 'credit' AND l.collected_on IS NOT NULL
         AND (l.sale_id IS NULL OR s.voided_at IS NULL) AND l.till_id = ?
         AND l.created_at >= datetime(?) AND l.created_at <= datetime(?)`,
      shift.till_id,
      from,
      to,
    );
    const exp = q<{ t: number }>(
      `SELECT COALESCE(SUM(amount_paisa), 0) AS t FROM expenses
       WHERE from_drawer = 1 AND till_id = ? AND created_at >= datetime(?) AND created_at <= datetime(?)`,
      shift.till_id,
      from,
      to,
    );
    const mv = q<{ i: number; o: number }>(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'in' THEN amount_paisa ELSE 0 END), 0) AS i,
              COALESCE(SUM(CASE WHEN kind = 'out' THEN amount_paisa ELSE 0 END), 0) AS o
       FROM till_moves WHERE shift_id = ?`,
      shift.id,
    );
    const out: TillSummary = {
      opening_float_paisa: Number(shift.opening_float_paisa),
      cash_sales_paisa: Number(s.cash),
      udhaar_received_paisa: Number(col.t),
      refunds_cash_paisa: Number(r.cash),
      expenses_paisa: Number(exp.t),
      cash_in_paisa: Number(mv.i),
      cash_out_paisa: Number(mv.o),
      expected_paisa: 0,
      sale_count: Number(s.n),
      sales_total_paisa: Number(s.total),
      udhaar_given_paisa: Number(s.udhaar),
      return_count: Number(r.n),
      returns_total_paisa: Number(r.total),
      digital_paisa: Number(s.digital),
    };
    out.expected_paisa =
      out.opening_float_paisa + out.cash_sales_paisa + out.udhaar_received_paisa -
      out.refunds_cash_paisa - out.expenses_paisa + out.cash_in_paisa - out.cash_out_paisa;
    return out;
  }

  current(tillId: string): { shift: TillShift | null; summary: TillSummary | null; moves: TillMove[]; last_counted_paisa: number | null } {
    const r = this.openRow(tillId);
    const last = this.db.raw
      .prepare(`SELECT counted_paisa FROM till_shifts WHERE closed_at IS NOT NULL AND till_id = ? ORDER BY closed_at DESC LIMIT 1`)
      .get(tillId) as { counted_paisa: number | null } | undefined;
    if (!r) return { shift: null, summary: null, moves: [], last_counted_paisa: last?.counted_paisa ?? null };
    return { shift: this.pub(r), summary: this.summary(r), moves: this.moves(r.id), last_counted_paisa: last?.counted_paisa ?? null };
  }

  open(input: { tillId: string; userId: string; floatPaisa?: unknown; floatRs?: unknown }): { ok: true; shift: TillShift } | Fail {
    if (this.openRow(input.tillId)) return { ok: false, error: 'till_already_open' };
    const m = moneyIn(input.floatPaisa, input.floatRs ?? (input.floatPaisa == null ? '0' : undefined), true);
    if (!m.ok) return m;
    const id = randomUUID();
    this.db.raw
      .prepare(`INSERT INTO till_shifts (id, till_id, opened_at, opened_by, opening_float_paisa) VALUES (?, ?, ?, ?, ?)`)
      .run(id, input.tillId, new Date().toISOString(), input.userId, m.paisa);
    return { ok: true, shift: this.pub(this.openRow(input.tillId)!) };
  }

  move(input: { tillId: string; userId: string; kind?: unknown; amountPaisa?: unknown; amountRs?: unknown; reason?: unknown }):
    | { ok: true; move: TillMove }
    | Fail {
    const shift = this.openRow(input.tillId);
    if (!shift) return { ok: false, error: 'till_not_open' };
    const kind = input.kind === 'in' || input.kind === 'out' ? input.kind : null;
    if (!kind) return { ok: false, error: 'invalid_kind' };
    const m = moneyIn(input.amountPaisa, input.amountRs, false);
    if (!m.ok) return m;
    const reason = String(input.reason ?? '').trim().slice(0, 120) || null;
    if (kind === 'out') {
      const sum = this.summary(shift);
      if (m.paisa > sum.expected_paisa) return { ok: false, error: 'cash_out_exceeds_till' };
    }
    const id = randomUUID();
    this.db.raw
      .prepare(`INSERT INTO till_moves (id, shift_id, kind, amount_paisa, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, shift.id, kind, m.paisa, reason, input.userId, new Date().toISOString());
    return { ok: true, move: this.moves(shift.id).find((x) => x.id === id)! };
  }

  /** Undo a cash in/out on the open shift. */
  voidMove(tillId: string, moveId: string): { ok: true } | Fail {
    const shift = this.openRow(tillId);
    if (!shift) return { ok: false, error: 'till_not_open' };
    const r = this.db.raw.prepare(`DELETE FROM till_moves WHERE id = ? AND shift_id = ?`).run(moveId, shift.id);
    return r.changes ? { ok: true } : { ok: false, error: 'not_found' };
  }

  close(input: { tillId: string; userId: string; countedPaisa?: unknown; countedRs?: unknown; note?: unknown }):
    | { ok: true; report: ReturnType<TillService['report']> }
    | Fail {
    const shift = this.openRow(input.tillId);
    if (!shift) return { ok: false, error: 'till_not_open' };
    const m = moneyIn(input.countedPaisa, input.countedRs, true);
    if (!m.ok) return m;
    const now = new Date().toISOString();
    const sum = this.summary(shift, now);
    const note = String(input.note ?? '').trim().slice(0, 200) || null;
    this.db.raw
      .prepare(
        `UPDATE till_shifts SET closed_at = ?, closed_by = ?, expected_paisa = ?, counted_paisa = ?,
           over_short_paisa = ?, summary_json = ?, note = ? WHERE id = ? AND closed_at IS NULL`,
      )
      .run(now, input.userId, sum.expected_paisa, m.paisa, m.paisa - sum.expected_paisa, JSON.stringify(sum), note, shift.id);
    return { ok: true, report: this.report(shift.id)! };
  }

  report(id: string): { shift: TillShift; summary: TillSummary; moves: TillMove[] } | null {
    const r = this.db.raw.prepare(`${SHIFT_SELECT} WHERE t.id = ?`).get(id) as ShiftRow | undefined;
    if (!r) return null;
    let summary: TillSummary | null = null;
    if (r.closed_at && r.summary_json) {
      try {
        summary = JSON.parse(r.summary_json) as TillSummary;
      } catch {
        summary = null;
      }
    }
    return { shift: this.pub(r), summary: summary ?? this.summary(r), moves: this.moves(r.id) };
  }

  history(opts: { page?: number; pageSize?: number; tillId?: string | null }) {
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(opts.pageSize) || 20)));
    const where = opts.tillId ? `WHERE t.till_id = ?` : '';
    const args = opts.tillId ? [opts.tillId] : [];
    const total = Number((this.db.raw.prepare(`SELECT COUNT(*) AS n FROM till_shifts t ${where}`).get(...args) as { n: number }).n);
    const page = Math.max(1, Math.min(Math.ceil(total / pageSize) || 1, Math.floor(Number(opts.page) || 1)));
    const rows = this.db.raw
      .prepare(`${SHIFT_SELECT} ${where} ORDER BY t.opened_at DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize) as ShiftRow[];
    return { shifts: rows.map((r) => this.pub(r)), total, page, pageSize };
  }
}
