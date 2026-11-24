import { billNoSearch } from '../tills/till-context';
import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

/**
 * Sales screen (read side): list / search / filter bills and open one bill.
 * Dates are Asia/Karachi shop days. Money in paisa. Nothing here writes.
 */

const TZ = 'Asia/Karachi';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_CUSTOM_DAYS = 400;

export type SalesRange = 'all' | 'today' | '7d' | 'month' | 'custom';
export type SalesPaidFilter = 'all' | 'cash' | 'khata' | 'both';
export type SalesStatusFilter = 'all' | 'active' | 'removed' | 'returned';
export type SaleStatus = 'active' | 'removed' | 'replaced';
export type SaleReturnState = 'none' | 'part' | 'full';

export type SaleListItem = {
  id: string;
  short_id: string;
  recorded_at: string;
  party_id: string | null;
  party_name: string | null;
  item_count: number;
  qty_total: number;
  total_paisa: number;
  payment_method: string;
  cash_amount_paisa: number;
  udhaar_amount_paisa: number;
  status: SaleStatus;
  return_state: SaleReturnState;
  sold_by_name: string | null;
};

export type SalesListResult =
  | {
      ok: true;
      range: SalesRange;
      from: string;
      to: string;
      today: string;
      page: number;
      page_size: number;
      total: number;
      /** Bills that count (not removed) among all matches, all pages. */
      sale_count: number;
      total_paisa: number;
      items: SaleListItem[];
    }
  | { ok: false; error: string };

export type SaleDetailLine = {
  id: string;
  line_no: number;
  product_id: string;
  product_name: string;
  unit_label: string;
  barcode: string | null;
  image_file: string | null;
  qty: number;
  unit_price_paisa: number;
  line_total_paisa: number;
  returned_qty: number;
  pack_label: string | null;
  pack_qty: number | null;
  pack_size: number | null;
};

export type SaleDetail = {
  subtotal_paisa: number;
  discount_paisa: number;
  discount_label: string | null;
  rounding_paisa: number;
  digital_paisa: number;
  digital_method: string | null;
  digital_ref: string | null;
  loyalty_redeem_points: number;
  loyalty_redeem_paisa: number;
  loyalty_earned_points: number;
  id: string;
  short_id: string;
  recorded_at: string;
  client_device_at: string;
  status: SaleStatus;
  return_state: SaleReturnState;
  voided_at: string | null;
  void_reason: string | null;
  voided_by_name: string | null;
  replaces: { id: string; short_id: string } | null;
  replaced_by: { id: string; short_id: string } | null;
  payment_method: string;
  total_paisa: number;
  cash_amount_paisa: number;
  udhaar_amount_paisa: number;
  tendered_paisa: number;
  change_paisa: number;
  /** Extra cash kept on the customer's khata instead of change. */
  kept_on_khata_paisa: number;
  party: { id: string; name: string; phone: string | null } | null;
  sold_by: { id: string; name: string } | null;
  lines: SaleDetailLine[];
  /** PKT shop day of the bill and today (for same-day Remove / Edit). */
  day: string;
  today: string;
  returns: Array<{
    id: string;
    short_id: string;
    recorded_at: string;
    total_paisa: number;
    refund_cash_paisa: number;
    refund_khata_paisa: number;
  }>;
};

type ListRow = {
  id: string;
  short_id: string;
  recorded_at: string;
  party_id: string | null;
  party_name: string | null;
  item_count: number;
  qty_total: number;
  total_paisa: number;
  payment_method: string;
  cash_amount_paisa: number;
  udhaar_amount_paisa: number;
  voided_at: string | null;
  replaced_by_sale_id: string | null;
  returned_qty: number;
  sold_by_name: string | null;
};

function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

@Injectable()
export class SalesQueryService {
  constructor(private readonly db: DbService) {}

  karachiYmd(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  private addDays(ymd: string, days: number): string {
    const base = new Date(`${ymd}T12:00:00+05:00`);
    return this.karachiYmd(new Date(base.getTime() + days * 86400000));
  }

  private validYmd(raw: string | undefined): string | null {
    const s = (raw ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(`${s}T12:00:00+05:00`);
    if (Number.isNaN(d.getTime())) return null;
    return this.karachiYmd(d) === s ? s : null;
  }

  /** Resolve the PKT day window. Cashier is always today. */
  resolveRange(opts: {
    range?: string;
    from?: string;
    to?: string;
    role: 'owner' | 'manager' | 'cashier' | 'data_entry';
    now?: Date;
  }):
    | { ok: true; range: SalesRange; fromYmd: string; toYmd: string; today: string }
    | { ok: false; error: string } {
    const today = this.karachiYmd(opts.now ?? new Date());
    const raw = (opts.range ?? 'today').trim().toLowerCase() || 'today';
    if (opts.role !== 'owner') {
      return { ok: true, range: 'today', fromYmd: today, toYmd: today, today };
    }
    if (raw === 'all') {
      // No date limit: from the first bill's shop day up to today.
      const first = this.db.raw
        .prepare(`SELECT MIN(recorded_at) AS m FROM sales`)
        .get() as { m: string | null } | undefined;
      const firstYmd = first?.m ? this.karachiYmd(new Date(first.m)) : today;
      const fromYmd = firstYmd < today ? firstYmd : today;
      return { ok: true, range: 'all', fromYmd, toYmd: today, today };
    }
    if (raw === 'today') {
      return { ok: true, range: 'today', fromYmd: today, toYmd: today, today };
    }
    if (raw === '7d' || raw === '7days' || raw === 'week') {
      return { ok: true, range: '7d', fromYmd: this.addDays(today, -6), toYmd: today, today };
    }
    if (raw === 'month') {
      return { ok: true, range: 'month', fromYmd: `${today.slice(0, 8)}01`, toYmd: today, today };
    }
    if (raw === 'custom') {
      const from = this.validYmd(opts.from);
      const to = this.validYmd(opts.to);
      if (!from || !to) return { ok: false, error: 'invalid_date' };
      if (to < from) return { ok: false, error: 'invalid_range' };
      const span =
        (new Date(`${to}T12:00:00+05:00`).getTime() -
          new Date(`${from}T12:00:00+05:00`).getTime()) /
        86400000;
      if (span > MAX_CUSTOM_DAYS) return { ok: false, error: 'range_too_long' };
      return { ok: true, range: 'custom', fromYmd: from, toYmd: to, today };
    }
    return { ok: false, error: 'invalid_range' };
  }

  private dayBounds(fromYmd: string, toYmd: string): { from: string; to: string } {
    return {
      from: new Date(`${fromYmd}T00:00:00+05:00`).toISOString(),
      to: new Date(`${toYmd}T23:59:59.999+05:00`).toISOString(),
    };
  }

  /** Rs amount typed in the search box → paisa, or null when the text is not an amount. */
  parseAmountPaisa(q: string): number | null {
    const s = q.trim().replace(/^rs\.?\s*/i, '').replace(/,/g, '');
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
    const n = Math.round(Number(s) * 100);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  list(opts: {
    role: 'owner' | 'manager' | 'cashier' | 'data_entry';
    storeId?: string | null;
    q?: string;
    range?: string;
    from?: string;
    to?: string;
    paid?: string;
    status?: string;
    page?: number;
    pageSize?: number;
    now?: Date;
  }): SalesListResult {
    const r = this.resolveRange({
      range: opts.range,
      from: opts.from,
      to: opts.to,
      role: opts.role,
      now: opts.now,
    });
    if (!r.ok) return r;

    const paidRaw = (opts.paid ?? 'all').trim().toLowerCase() || 'all';
    if (!['all', 'cash', 'khata', 'both'].includes(paidRaw)) {
      return { ok: false, error: 'invalid_paid' };
    }
    const paid = paidRaw as SalesPaidFilter;
    const statusRaw = (opts.status ?? 'all').trim().toLowerCase() || 'all';
    if (!['all', 'active', 'removed', 'returned'].includes(statusRaw)) {
      return { ok: false, error: 'invalid_status' };
    }
    const status = statusRaw as SalesStatusFilter;

    const pageSize =
      opts.pageSize != null && Number.isFinite(opts.pageSize) && opts.pageSize > 0
        ? Math.min(MAX_PAGE_SIZE, Math.floor(opts.pageSize))
        : DEFAULT_PAGE_SIZE;
    const page =
      opts.page != null && Number.isFinite(opts.page) && opts.page > 0
        ? Math.floor(opts.page)
        : 1;

    const win = this.dayBounds(r.fromYmd, r.toYmd);
    const where: string[] = r.range === 'all' ? [] : ['s.recorded_at >= ?', 's.recorded_at <= ?'];
    const params: unknown[] = r.range === 'all' ? [] : [win.from, win.to];
    if (where.length === 0) where.push('1 = 1');

    if (opts.storeId) {
      where.push('(s.store_id IS NULL OR s.store_id = ?)');
      params.push(opts.storeId);
    }

    if (paid === 'cash') where.push(`s.payment_method = 'cash'`);
    if (paid === 'khata') where.push(`s.payment_method = 'udhaar'`);
    if (paid === 'both') where.push(`s.payment_method = 'split'`);

    if (status === 'active') where.push('s.voided_at IS NULL');
    if (status === 'removed') where.push('s.voided_at IS NOT NULL');
    if (status === 'returned') {
      where.push(
        `s.voided_at IS NULL AND EXISTS (SELECT 1 FROM sale_returns sr WHERE sr.sale_id = s.id)`,
      );
    }

    const q = (opts.q ?? '').trim().slice(0, 80);
    if (q) {
      const ors: string[] = [];
      const bn = billNoSearch(q, q.startsWith('#') ? 1 : 3);
      ors.push(...bn.ors);
      params.push(...bn.params);
      const like = `%${escapeLike(q)}%`;
      ors.push(`p.name LIKE ? ESCAPE '\\'`);
      params.push(like);
      const digits = q.replace(/[^\d]/g, '');
      if (digits.length >= 4) {
        ors.push(`REPLACE(REPLACE(REPLACE(COALESCE(p.phone, ''), ' ', ''), '-', ''), '+', '') LIKE ?`);
        params.push(`%${digits}%`);
      }
      ors.push(
        `EXISTS (
           SELECT 1 FROM sale_lines sl2
           LEFT JOIN products pr ON pr.id = sl2.product_id
           WHERE sl2.sale_id = s.id
             AND (sl2.product_name LIKE ? ESCAPE '\\'
                  OR COALESCE(pr.name_ur, '') LIKE ? ESCAPE '\\'
                  OR (pr.barcode IS NOT NULL AND pr.barcode = ?)
                  OR sl2.product_id IN (SELECT product_id FROM product_barcodes WHERE barcode = ?))
         )`,
      );
      params.push(like, like, q, q);
      const amount = this.parseAmountPaisa(q);
      if (amount != null) {
        ors.push('s.total_paisa = ?');
        params.push(amount);
      }
      where.push(`(${ors.join(' OR ')})`);
    }

    const whereSql = where.join(' AND ');
    const base = `FROM sales s LEFT JOIN parties p ON p.id = s.party_id WHERE ${whereSql}`;

    const agg = this.db.raw
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN s.voided_at IS NULL THEN 1 ELSE 0 END), 0) AS sale_count,
                COALESCE(SUM(CASE WHEN s.voided_at IS NULL THEN s.total_paisa ELSE 0 END), 0) AS total_paisa
         ${base}`,
      )
      .get(...params) as { total: number; sale_count: number; total_paisa: number };

    const rows = this.db.raw
      .prepare(
        `SELECT
           s.id, s.short_id, s.recorded_at, s.party_id,
           p.name AS party_name,
           s.total_paisa, s.payment_method, s.cash_amount_paisa, s.udhaar_amount_paisa,
           s.voided_at, s.replaced_by_sale_id,
           u.display_name AS sold_by_name,
           (SELECT COUNT(*) FROM sale_lines sl WHERE sl.sale_id = s.id) AS item_count,
           (SELECT COALESCE(SUM(sl.qty_pieces), 0) FROM sale_lines sl WHERE sl.sale_id = s.id) AS qty_total,
           (SELECT COALESCE(SUM(rl.qty_pieces), 0)
              FROM sale_return_lines rl
              INNER JOIN sale_returns sr ON sr.id = rl.return_id
              WHERE sr.sale_id = s.id) AS returned_qty
         FROM sales s
         LEFT JOIN parties p ON p.id = s.party_id
         LEFT JOIN users u ON u.id = s.sold_by
         WHERE ${whereSql}
         ORDER BY s.recorded_at DESC, s.rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize) as ListRow[];

    return {
      ok: true,
      range: r.range,
      from: r.fromYmd,
      to: r.toYmd,
      today: r.today,
      page,
      page_size: pageSize,
      total: Number(agg?.total ?? 0),
      sale_count: Number(agg?.sale_count ?? 0),
      total_paisa: Number(agg?.total_paisa ?? 0),
      items: rows.map((row) => ({
        id: String(row.id),
        short_id: String(row.short_id),
        recorded_at: String(row.recorded_at),
        party_id: row.party_id == null ? null : String(row.party_id),
        party_name: row.party_name == null ? null : String(row.party_name),
        item_count: Number(row.item_count),
        qty_total: Number(row.qty_total),
        total_paisa: Number(row.total_paisa),
        payment_method: String(row.payment_method),
        cash_amount_paisa: Number(row.cash_amount_paisa),
        udhaar_amount_paisa: Number(row.udhaar_amount_paisa),
        status: this.statusOf(row.voided_at, row.replaced_by_sale_id),
        return_state: this.returnState(Number(row.qty_total), Number(row.returned_qty)),
        sold_by_name: row.sold_by_name == null ? null : String(row.sold_by_name),
      })),
    };
  }

  private statusOf(voidedAt: string | null, replacedBy: string | null): SaleStatus {
    if (voidedAt == null) return 'active';
    return replacedBy ? 'replaced' : 'removed';
  }

  private returnState(sold: number, returned: number): SaleReturnState {
    if (returned <= 0) return 'none';
    return returned >= sold ? 'full' : 'part';
  }

  /**
   * One bill with lines, payment split, customer, cashier and status.
   * Cashier may open today's bills only (PKT).
   */
  get(
    id: string,
    opts: { role: 'owner' | 'manager' | 'cashier' | 'data_entry'; now?: Date },
  ): { ok: true; sale: SaleDetail } | { ok: false; error: 'not_found' | 'forbidden' } {
    const sid = (id ?? '').trim();
    if (!sid) return { ok: false, error: 'not_found' };
    const row = this.db.raw
      .prepare(
        `SELECT s.*, p.name AS party_name, p.phone AS party_phone,
                u.display_name AS sold_by_name,
                vu.display_name AS voided_by_name,
                rs.short_id AS replaces_short_id,
                rb.short_id AS replaced_by_short_id
         FROM sales s
         LEFT JOIN parties p ON p.id = s.party_id
         LEFT JOIN users u ON u.id = s.sold_by
         LEFT JOIN users vu ON vu.id = s.voided_by
         LEFT JOIN sales rs ON rs.id = s.replaces_sale_id
         LEFT JOIN sales rb ON rb.id = s.replaced_by_sale_id
         WHERE s.id = ? OR s.short_id = ?
         LIMIT 1`,
      )
      .get(sid, sid.replace(/^#/, '').toUpperCase()) as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: 'not_found' };

    if (opts.role !== 'owner') {
      const today = this.karachiYmd(opts.now ?? new Date());
      const day = this.karachiYmd(new Date(String(row.recorded_at)));
      if (day !== today) return { ok: false, error: 'forbidden' };
    }

    const lines = this.db.raw
      .prepare(
        `SELECT sl.id, sl.line_no, sl.product_id, sl.product_name, sl.unit,
                sl.qty_pieces, sl.unit_price_paisa, sl.line_total_paisa,
                sl.pack_label, sl.pack_qty, sl.pack_size,
                pr.unit_label, pr.barcode, pr.image_file,
                (SELECT COALESCE(SUM(rl.qty_pieces), 0)
                   FROM sale_return_lines rl WHERE rl.sale_line_id = sl.id) AS returned_qty
         FROM sale_lines sl
         LEFT JOIN products pr ON pr.id = sl.product_id
         WHERE sl.sale_id = ?
         ORDER BY sl.line_no ASC, sl.rowid ASC`,
      )
      .all(String(row.id)) as Array<{
      id: string;
      line_no: number;
      product_id: string;
      product_name: string;
      unit: string;
      qty_pieces: number;
      unit_price_paisa: number;
      line_total_paisa: number;
      unit_label: string | null;
      barcode: string | null;
      image_file: string | null;
      returned_qty: number;
      pack_label: string | null;
      pack_qty: number | null;
      pack_size: number | null;
    }>;

    const cash = Number(row.cash_amount_paisa ?? 0);
    const tendered = Number(row.tendered_paisa ?? 0);
    const change = Number(row.change_paisa ?? 0);
    const method = String(row.payment_method);
    const kept =
      row.party_id && method !== 'udhaar' ? Math.max(0, tendered - cash - change) : 0;

    const sold = lines.reduce((s, l) => s + Number(l.qty_pieces), 0);
    const returned = lines.reduce((s, l) => s + Number(l.returned_qty), 0);

    const returns = this.db.raw
      .prepare(
        `SELECT id, short_id, recorded_at, total_paisa, refund_cash_paisa, refund_khata_paisa
         FROM sale_returns WHERE sale_id = ? ORDER BY recorded_at ASC`,
      )
      .all(String(row.id)) as Array<Record<string, unknown>>;

    const sale: SaleDetail = {
      day: this.karachiYmd(new Date(String(row.recorded_at))),
      today: this.karachiYmd(opts.now ?? new Date()),
      returns: returns.map((r) => ({
        id: String(r.id),
        short_id: String(r.short_id),
        recorded_at: String(r.recorded_at),
        total_paisa: Number(r.total_paisa),
        refund_cash_paisa: Number(r.refund_cash_paisa),
        refund_khata_paisa: Number(r.refund_khata_paisa),
      })),
      id: String(row.id),
      short_id: String(row.short_id),
      recorded_at: String(row.recorded_at),
      client_device_at: String(row.client_device_at),
      status: this.statusOf(
        (row.voided_at as string | null) ?? null,
        (row.replaced_by_sale_id as string | null) ?? null,
      ),
      return_state: this.returnState(sold, returned),
      voided_at: row.voided_at == null ? null : String(row.voided_at),
      void_reason: row.void_reason == null ? null : String(row.void_reason),
      voided_by_name: row.voided_by_name == null ? null : String(row.voided_by_name),
      replaces:
        row.replaces_sale_id && row.replaces_short_id
          ? { id: String(row.replaces_sale_id), short_id: String(row.replaces_short_id) }
          : null,
      replaced_by:
        row.replaced_by_sale_id && row.replaced_by_short_id
          ? { id: String(row.replaced_by_sale_id), short_id: String(row.replaced_by_short_id) }
          : null,
      payment_method: method,
      total_paisa: Number(row.total_paisa ?? 0),
      cash_amount_paisa: cash,
      udhaar_amount_paisa: Number(row.udhaar_amount_paisa ?? 0),
      tendered_paisa: tendered,
      change_paisa: change,
      kept_on_khata_paisa: kept,
      party: row.party_id
        ? {
            id: String(row.party_id),
            name: row.party_name == null ? '' : String(row.party_name),
            phone: row.party_phone == null ? null : String(row.party_phone),
          }
        : null,
      sold_by: row.sold_by
        ? {
            id: String(row.sold_by),
            name: row.sold_by_name == null ? '' : String(row.sold_by_name),
          }
        : null,
      lines: lines.map((l) => ({
        id: String(l.id),
        line_no: Number(l.line_no),
        product_id: String(l.product_id),
        product_name: String(l.product_name),
        unit_label: String(l.unit_label ?? l.unit ?? 'piece') || 'piece',
        barcode: l.barcode == null ? null : String(l.barcode),
        image_file: l.image_file == null ? null : String(l.image_file),
        qty: Number(l.qty_pieces),
        unit_price_paisa: Number(l.unit_price_paisa),
        line_total_paisa: Number(l.line_total_paisa),
        returned_qty: Number(l.returned_qty),
        pack_label: l.pack_label ?? null,
        pack_qty: l.pack_qty == null ? null : Number(l.pack_qty),
        pack_size: l.pack_size == null ? null : Number(l.pack_size),
      })),
      subtotal_paisa: row.subtotal_paisa == null ? Number(row.total_paisa ?? 0) : Number(row.subtotal_paisa),
      discount_paisa: Number(row.discount_paisa ?? 0),
      discount_label: row.discount_label == null ? null : String(row.discount_label),
      rounding_paisa: Number(row.rounding_paisa ?? 0),
      digital_paisa: Number(row.digital_paisa ?? 0),
      digital_method: row.digital_method == null ? null : String(row.digital_method),
      digital_ref: row.digital_ref == null ? null : String(row.digital_ref),
      loyalty_redeem_points: Number(row.loyalty_redeem_points ?? 0),
      loyalty_redeem_paisa: Number(row.loyalty_redeem_paisa ?? 0),
      loyalty_earned_points: Number(row.loyalty_earned_points ?? 0),
    };
    return { ok: true, sale };
  }
}
