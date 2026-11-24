import { billNoSearch, currentTillId } from '../tills/till-context';
import { lineMoney, parseQty, r3 } from '../common/qty';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { karachiYmd, writeAudit } from '../sales/sale-reversal';

export type ReturnLineInput = { saleLineId: string; qty: number; restock?: boolean };

export type ReturnDetail = {
  id: string;
  short_id: string;
  sale_id: string;
  sale_short_id: string;
  recorded_at: string;
  party: { id: string; name: string; phone: string | null } | null;
  returned_by_name: string | null;
  total_paisa: number;
  refund_cash_paisa: number;
  refund_khata_paisa: number;
  reason: string | null;
  lines: Array<{
    id: string;
    sale_line_id: string;
    product_id: string;
    product_name: string;
    qty: number;
    unit_price_paisa: number;
    line_total_paisa: number;
    restocked: boolean;
  }>;
};

export type BillHit = {
  id: string;
  short_id: string;
  recorded_at: string;
  party_name: string | null;
  total_paisa: number;
  payment_method: string;
  returned_all: boolean;
};

const BILL_DAYS = 90;

/**
 * Returns against a bill. Owner and Cashier. Effects land on the return date:
 * stock (+ restocked lines only), khata credit (never cash received), audit.
 */
@Injectable()
export class ReturnsService {
  constructor(private readonly db: DbService) {}

  /**
   * Owner: undo a return the same shop day. Takes restocked pieces back off the
   * shelf, removes the khata credit and deletes the return (audit kept).
   */
  undo(input: { returnId: string; userId?: string | null; storeId?: string | null; now?: Date }):
    | { ok: true }
    | { ok: false; error: string } {
    const r = this.db.raw
      .prepare(`SELECT * FROM sale_returns WHERE id = ? OR short_id = ?`)
      .get(input.returnId, String(input.returnId).toUpperCase()) as
      | { id: string; short_id: string; sale_id: string; recorded_at: string; total_paisa: number; refund_cash_paisa: number; refund_khata_paisa: number }
      | undefined;
    if (!r) return { ok: false, error: 'return_not_found' };
    const ymd = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    if (ymd(new Date(r.recorded_at)) !== ymd(input.now ?? new Date())) return { ok: false, error: 'undo_same_day_only' };
    const lines = this.db.raw
      .prepare(`SELECT product_id, qty_pieces, restocked FROM sale_return_lines WHERE return_id = ?`)
      .all(r.id) as Array<{ product_id: string; qty_pieces: number; restocked: number }>;
    try {
      this.db.raw.transaction(() => {
        const dec = this.db.raw.prepare(
          `UPDATE stock_balances SET qty_on_hand = ROUND(qty_on_hand - ?, 3), updated_at = datetime('now')
           WHERE product_id = ? AND qty_on_hand >= ? - 0.0000001`,
        );
        for (const l of lines) {
          if (!l.restocked) continue;
          if (dec.run(l.qty_pieces, l.product_id, l.qty_pieces).changes !== 1) throw new Error('stock_gone');
        }
        this.db.raw.prepare(`DELETE FROM party_ledger WHERE return_id = ?`).run(r.id);
        this.db.raw.prepare(`DELETE FROM loyalty_ledger WHERE kind = 'return' AND note = ?`).run(r.id);
        this.db.raw.prepare(`DELETE FROM sale_return_lines WHERE return_id = ?`).run(r.id);
        this.db.raw.prepare(`DELETE FROM sale_returns WHERE id = ?`).run(r.id);
        writeAudit(this.db.raw, {
          action: 'sale.return_undo',
          userId: input.userId ?? undefined,
          storeId: input.storeId ?? undefined,
          subjectType: 'sale',
          subjectId: r.sale_id,
          payload: { short_id: r.short_id, total_paisa: r.total_paisa, cash: r.refund_cash_paisa, khata: r.refund_khata_paisa },
        });
      })();
    } catch (e) {
      if (e instanceof Error && e.message === 'stock_gone') return { ok: false, error: 'undo_stock_sold' };
      throw e;
    }
    return { ok: true };
  }

  /** Cash that can still go back on this bill: cash taken less earlier cash refunds. */
  cashRefundable(saleId: string, cashAmountPaisa: number): number {
    const prior = (
      this.db.raw
        .prepare(`SELECT COALESCE(SUM(refund_cash_paisa), 0) AS c FROM sale_returns WHERE sale_id = ?`)
        .get(saleId) as { c: number }
    ).c;
    return Math.max(0, Number(cashAmountPaisa) - Number(prior));
  }

  private makeShortId(id: string): string {
    return `R${id.replace(/-/g, '').slice(0, 7).toUpperCase()}`;
  }

  /** Find bills to return against: bill no prefix, customer name/phone, exact barcode. */
  findBills(q: string, now = new Date()): BillHit[] {
    const text = (q ?? '').trim().slice(0, 80);
    const since = new Date(now.getTime() - BILL_DAYS * 86400000).toISOString();
    const where: string[] = ['s.voided_at IS NULL', 's.recorded_at >= ?'];
    const params: unknown[] = [since];
    if (text) {
      const ors: string[] = [];
      const bn = billNoSearch(text);
      ors.push(...bn.ors);
      params.push(...bn.params);
      ors.push(`p.name LIKE ?`);
      params.push(`%${text.replace(/[%_]/g, '')}%`);
      const digits = text.replace(/[^\d]/g, '');
      if (digits.length >= 4) {
        ors.push(
          `REPLACE(REPLACE(REPLACE(COALESCE(p.phone, ''), ' ', ''), '-', ''), '+', '') LIKE ?`,
        );
        params.push(`%${digits}%`);
      }
      where.push(`(${ors.join(' OR ')})`);
    }
    const rows = this.db.raw
      .prepare(
        `SELECT s.id, s.short_id, s.recorded_at, p.name AS party_name, s.total_paisa,
                s.payment_method,
                (SELECT COALESCE(SUM(qty_pieces), 0) FROM sale_lines WHERE sale_id = s.id) AS sold,
                (SELECT COALESCE(SUM(rl.qty_pieces), 0) FROM sale_return_lines rl
                   INNER JOIN sale_returns r ON r.id = rl.return_id WHERE r.sale_id = s.id) AS returned
         FROM sales s LEFT JOIN parties p ON p.id = s.party_id
         WHERE ${where.join(' AND ')}
         ORDER BY s.recorded_at DESC LIMIT 20`,
      )
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      short_id: String(r.short_id),
      recorded_at: String(r.recorded_at),
      party_name: r.party_name == null ? null : String(r.party_name),
      total_paisa: Number(r.total_paisa),
      payment_method: String(r.payment_method),
      returned_all: Number(r.returned) >= Number(r.sold) && Number(r.sold) > 0,
    }));
  }

  create(input: {
    saleId: string;
    lines: ReturnLineInput[];
    refundCashPaisa?: number | null;
    refundKhataPaisa?: number | null;
    reason?: string | null;
    clientDeviceAt?: string | null;
    userId?: string | null;
    storeId?: string | null;
    now?: Date;
    approvedBy?: string | null;
  }): { ok: true; return: ReturnDetail } | { ok: false; error: string } {
    const now = input.now ?? new Date();
    const sid = String(input.saleId ?? '').trim();
    const sale = this.db.raw
      .prepare(
        `SELECT id, short_id, party_id, voided_at, cash_amount_paisa, store_id, total_paisa, subtotal_paisa, till_id
         FROM sales WHERE id = ? OR short_id = ? LIMIT 1`,
      )
      .get(sid, sid.replace(/^#/, '').toUpperCase()) as
      | { id: string; short_id: string; party_id: string | null; voided_at: string | null; cash_amount_paisa: number; store_id: string | null; total_paisa: number; subtotal_paisa: number | null; till_id: string }
      | undefined;
    if (!sale) return { ok: false, error: 'sale_not_found' };
    if (sale.voided_at) return { ok: false, error: 'sale_voided' };

    const raw = Array.isArray(input.lines) ? input.lines : [];
    const saleLines = this.db.raw
      .prepare(
        `SELECT sl.id, sl.product_id, sl.product_name, sl.qty_pieces, sl.unit_price_paisa,
                sl.unit_cost_paisa, sl.line_no,
                (SELECT p.unit_label FROM products p WHERE p.id = sl.product_id) AS unit_label,
                (SELECT COALESCE(SUM(rl.qty_pieces), 0) FROM sale_return_lines rl
                   WHERE rl.sale_line_id = sl.id) AS returned
         FROM sale_lines sl WHERE sl.sale_id = ? ORDER BY sl.line_no`,
      )
      .all(sale.id) as Array<{
      id: string;
      product_id: string;
      product_name: string;
      qty_pieces: number;
      unit_price_paisa: number;
      unit_cost_paisa: number | null;
      line_no: number;
      unit_label: string | null;
      returned: number;
    }>;
    const byId = new Map(saleLines.map((l) => [l.id, l]));
    const picked = new Map<string, { qty: number; restock: boolean }>();
    for (const l of raw) {
      const line = byId.get(String(l?.saleLineId ?? ''));
      if (!line) return { ok: false, error: 'invalid_line' };
      const pq = parseQty(l.qty, line.unit_label, { allowZero: true });
      if (!pq.ok) return { ok: false, error: 'invalid_qty' };
      const qty = pq.n;
      if (qty === 0) continue;
      if (picked.has(line.id)) return { ok: false, error: 'duplicate_line' };
      picked.set(line.id, { qty, restock: l.restock !== false });
    }
    if (picked.size === 0) return { ok: false, error: 'nothing_to_return' };
    // Bill discount / rounding: each returned line gives back its share of what was paid.
    const sub = sale.subtotal_paisa == null ? Number(sale.total_paisa) : Number(sale.subtotal_paisa);
    const factor = sub > 0 ? Number(sale.total_paisa) / sub : 1;
    const amt = (qty: number, price: number) => Math.round(lineMoney(qty, price) * factor);
    let total = 0;
    for (const [id, p] of picked) {
      const line = byId.get(id)!;
      if (p.qty > r3(Number(line.qty_pieces) - Number(line.returned)) + 1e-9) {
        return { ok: false, error: 'qty_exceeds_sold' };
      }
      total += amt(p.qty, Number(line.unit_price_paisa));
    }
    if (total <= 0) return { ok: false, error: 'nothing_to_return' };

    let cash = input.refundCashPaisa == null ? null : Math.round(Number(input.refundCashPaisa));
    let khata = input.refundKhataPaisa == null ? null : Math.round(Number(input.refundKhataPaisa));
    if (cash == null && khata == null) {
      khata = sale.party_id ? total : 0;
      cash = total - khata;
    } else if (cash == null) {
      cash = total - (khata ?? 0);
    } else if (khata == null) {
      khata = total - cash;
    }
    if (!Number.isFinite(cash) || !Number.isFinite(khata!) || cash < 0 || khata! < 0) {
      return { ok: false, error: 'invalid_refund' };
    }
    if (cash + khata! !== total) return { ok: false, error: 'refund_mismatch' };
    if (khata! > 0 && !sale.party_id) return { ok: false, error: 'khata_needs_customer' };
    // Cash back never exceeds the cash taken on this bill (less earlier cash refunds).
    const priorCash = (
      this.db.raw
        .prepare(`SELECT COALESCE(SUM(refund_cash_paisa), 0) AS c FROM sale_returns WHERE sale_id = ?`)
        .get(sale.id) as { c: number }
    ).c;
    if (cash > Math.max(0, Number(sale.cash_amount_paisa) - Number(priorCash))) {
      return { ok: false, error: 'refund_exceeds_cash' };
    }

    const id = randomUUID();
    const shortId = this.makeShortId(id);
    const tillId = currentTillId() ?? sale.till_id ?? 'till-1';
    const recordedAt = now.toISOString();
    let clientAt = recordedAt;
    if (input.clientDeviceAt) {
      const d = new Date(String(input.clientDeviceAt));
      if (!Number.isNaN(d.getTime())) clientAt = d.toISOString();
    }
    const reason = input.reason ? String(input.reason).trim().slice(0, 200) || null : null;

    this.db.raw.transaction(() => {
      this.db.raw
        .prepare(
          `INSERT INTO sale_returns (till_id, approved_by, id, short_id, sale_id, store_id, party_id, returned_by,
             total_paisa, refund_cash_paisa, refund_khata_paisa, reason, client_device_at, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(tillId, input.approvedBy ?? null, id, shortId, sale.id, input.storeId ?? sale.store_id ?? null, sale.party_id,
          input.userId ?? null, total, cash, khata, reason, clientAt, recordedAt);
      const insLine = this.db.raw.prepare(
        `INSERT INTO sale_return_lines (id, return_id, sale_line_id, product_id, product_name,
           qty_pieces, unit_price_paisa, line_total_paisa, unit_cost_paisa, restocked, line_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const ensure = this.db.raw.prepare(
        `INSERT OR IGNORE INTO stock_balances (product_id, qty_on_hand) VALUES (?, 0)`,
      );
      const restock = this.db.raw.prepare(
        `UPDATE stock_balances SET qty_on_hand = ROUND(qty_on_hand + ?, 3), updated_at = datetime('now')
         WHERE product_id = ?`,
      );
      let n = 0;
      for (const [lineId, p] of picked) {
        const l = byId.get(lineId)!;
        n += 1;
        insLine.run(randomUUID(), id, l.id, l.product_id, l.product_name, p.qty,
          l.unit_price_paisa, amt(p.qty, l.unit_price_paisa), l.unit_cost_paisa, p.restock ? 1 : 0, n);
        if (p.restock) {
          ensure.run(l.product_id);
          restock.run(p.qty, l.product_id);
        }
      }
      // Loyalty: points earned on the returned part come back off the customer.
      if (sale.party_id && Number(sale.total_paisa) > 0) {
        const lr = this.db.raw
          .prepare(
            `SELECT COALESCE(SUM(CASE WHEN kind = 'earn' THEN points ELSE 0 END), 0) AS earned,
                    COALESCE(SUM(CASE WHEN kind = 'return' THEN -points ELSE 0 END), 0) AS back
             FROM loyalty_ledger WHERE sale_id = ?`,
          )
          .get(sale.id) as { earned: number; back: number };
        const want = Math.floor((Number(lr.earned) * total) / Number(sale.total_paisa));
        const take = Math.min(want, Number(lr.earned) - Number(lr.back));
        if (take > 0) {
          this.db.raw
            .prepare(`INSERT INTO loyalty_ledger (id, party_id, sale_id, points, kind, note) VALUES (?, ?, ?, ?, 'return', ?)`)
            .run(randomUUID(), sale.party_id, sale.id, -take, id);
        }
      }
      if (khata! > 0 && sale.party_id) {
        this.db.raw
          .prepare(
            `INSERT INTO party_ledger (till_id, id, party_id, entry_type, amount_paisa, sale_id, note, return_id)
             VALUES (?, ?, ?, 'credit', ?, ?, ?, ?)`,
          )
          .run(tillId, randomUUID(), sale.party_id, khata, sale.id,
            `Return ${shortId} on bill ${sale.short_id}`, id);
      }
      writeAudit(this.db.raw, {
        action: 'sale.return',
        userId: input.userId,
        storeId: input.storeId,
        subjectType: 'sale_return',
        subjectId: id,
        payload: { short_id: shortId, sale_id: sale.id, sale_short_id: sale.short_id,
          total_paisa: total, refund_cash_paisa: cash, refund_khata_paisa: khata,
          till_id: tillId, approved_by: input.approvedBy ?? null },
      });
    })();

    const detail = this.get(id);
    if (!detail.ok) return { ok: false, error: 'return_not_found' };
    return { ok: true, return: detail.return };
  }

  get(id: string): { ok: true; return: ReturnDetail } | { ok: false; error: string } {
    const rid = String(id ?? '').trim();
    const r = this.db.raw
      .prepare(
        `SELECT r.*, s.short_id AS sale_short_id, p.name AS party_name, p.phone AS party_phone,
                u.display_name AS returned_by_name
         FROM sale_returns r
         INNER JOIN sales s ON s.id = r.sale_id
         LEFT JOIN parties p ON p.id = r.party_id
         LEFT JOIN users u ON u.id = r.returned_by
         WHERE r.id = ? OR r.short_id = ? LIMIT 1`,
      )
      .get(rid, rid.replace(/^#/, '').toUpperCase()) as Record<string, unknown> | undefined;
    if (!r) return { ok: false, error: 'return_not_found' };
    const lines = this.db.raw
      .prepare(`SELECT * FROM sale_return_lines WHERE return_id = ? ORDER BY line_no`)
      .all(String(r.id)) as Array<Record<string, unknown>>;
    return {
      ok: true,
      return: {
        id: String(r.id),
        short_id: String(r.short_id),
        sale_id: String(r.sale_id),
        sale_short_id: String(r.sale_short_id),
        recorded_at: String(r.recorded_at),
        party: r.party_id
          ? { id: String(r.party_id), name: String(r.party_name ?? ''), phone: r.party_phone == null ? null : String(r.party_phone) }
          : null,
        returned_by_name: r.returned_by_name == null ? null : String(r.returned_by_name),
        total_paisa: Number(r.total_paisa),
        refund_cash_paisa: Number(r.refund_cash_paisa),
        refund_khata_paisa: Number(r.refund_khata_paisa),
        reason: r.reason == null ? null : String(r.reason),
        lines: lines.map((l) => ({
          id: String(l.id),
          sale_line_id: String(l.sale_line_id),
          product_id: String(l.product_id),
          product_name: String(l.product_name),
          qty: Number(l.qty_pieces),
          unit_price_paisa: Number(l.unit_price_paisa),
          line_total_paisa: Number(l.line_total_paisa),
          restocked: Number(l.restocked) === 1,
        })),
      },
    };
  }

  /** Returns list. Owner: PKT day range (default today). Cashier: today only. */
  list(opts: {
    role: string;
    q?: string;
    from?: string;
    to?: string;
    saleId?: string;
    page?: number;
    now?: Date;
  }) {
    const now = opts.now ?? new Date();
    const today = karachiYmd(now);
    let from = today;
    let to = today;
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    if (opts.role === 'owner') {
      if (opts.from && ymd.test(opts.from)) from = opts.from;
      if (opts.to && ymd.test(opts.to)) to = opts.to;
      if (to < from) return { ok: false as const, error: 'invalid_range' };
    }
    const where = ['r.recorded_at >= ?', 'r.recorded_at <= ?'];
    const params: unknown[] = [
      new Date(`${from}T00:00:00+05:00`).toISOString(),
      new Date(`${to}T23:59:59.999+05:00`).toISOString(),
    ];
    if (opts.saleId) {
      where.length = 0;
      params.length = 0;
      where.push('r.sale_id = ?');
      params.push(opts.saleId);
    }
    const q = (opts.q ?? '').trim().replace(/[%_]/g, '');
    if (q) {
      const up = q.replace(/^#/, '').toUpperCase();
      where.push(`(r.short_id LIKE ? OR s.short_id LIKE ? OR p.name LIKE ?)`);
      params.push(`${up}%`, `${up}%`, `%${q}%`);
    }
    const page = Math.max(1, Math.floor(Number(opts.page) || 1));
    const base = `FROM sale_returns r INNER JOIN sales s ON s.id = r.sale_id
                  LEFT JOIN parties p ON p.id = r.party_id WHERE ${where.join(' AND ')}`;
    const agg = this.db.raw
      .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(r.total_paisa), 0) AS t ${base}`)
      .get(...params) as { n: number; t: number };
    const rows = this.db.raw
      .prepare(
        `SELECT r.id, r.short_id, r.recorded_at, r.total_paisa, r.refund_cash_paisa,
                r.refund_khata_paisa, s.short_id AS sale_short_id, r.sale_id, p.name AS party_name
         ${base} ORDER BY r.recorded_at DESC LIMIT 50 OFFSET ?`,
      )
      .all(...params, (page - 1) * 50) as Array<Record<string, unknown>>;
    return {
      ok: true as const,
      from,
      to,
      today,
      page,
      total: Number(agg.n),
      total_paisa: Number(agg.t),
      items: rows.map((r) => ({
        id: String(r.id),
        short_id: String(r.short_id),
        recorded_at: String(r.recorded_at),
        sale_id: String(r.sale_id),
        sale_short_id: String(r.sale_short_id),
        party_name: r.party_name == null ? null : String(r.party_name),
        total_paisa: Number(r.total_paisa),
        refund_cash_paisa: Number(r.refund_cash_paisa),
        refund_khata_paisa: Number(r.refund_khata_paisa),
      })),
    };
  }
}
