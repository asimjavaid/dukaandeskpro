import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import {
  ANALYTICS_TIMEZONE,
  AnalyticsSummary,
  CashierTodaySale,
  CashierTodaySummary,
  DEFAULT_LOW_STOCK_THRESHOLD,
  DEFAULT_TOP_PRODUCTS_LIMIT,
  LowStockItem,
  PeriodSales,
  TopProduct,
  ProfitLine,
  TodayProfit,
  AnalyticsInsights,
  CashTill,
  ProfitCompare,
  SLOW_MOVER_DAYS,
  SLOW_MOVER_PREVIEW,
  SlowMover,
  SlowMoversPage,
  TOP_UDHAAR_LIMIT,
  TopProfitItem,
  TopUdhaarCustomer,
  WindowProfit,
} from './analytics.types';

type WindowBounds = { from: string; to: string };

@Injectable()
export class AnalyticsService {
  constructor(private readonly db: DbService) {}

  summary(opts?: {
    storeId?: string | null;
    lowStockThreshold?: number;
    topLimit?: number;
  }): AnalyticsSummary {
    const threshold =
      opts?.lowStockThreshold != null &&
      Number.isFinite(opts.lowStockThreshold) &&
      opts.lowStockThreshold >= 0
        ? Math.floor(opts.lowStockThreshold)
        : DEFAULT_LOW_STOCK_THRESHOLD;
    const topLimit =
      opts?.topLimit != null &&
      Number.isFinite(opts.topLimit) &&
      opts.topLimit > 0
        ? Math.min(50, Math.floor(opts.topLimit))
        : DEFAULT_TOP_PRODUCTS_LIMIT;

    const now = new Date();
    const todayWin = this.todayWindow(now);
    const weekWin = this.last7DaysWindow(now);

    const todaySales = this.periodSales('today', todayWin, opts?.storeId);
    const weekSales = this.periodSales('last_7_days', weekWin, opts?.storeId);

    return {
      timezone: ANALYTICS_TIMEZONE,
      low_stock_threshold: threshold,
      today: {
        ...todaySales,
        top_products: this.topProducts(todayWin, topLimit, opts?.storeId),
      },
      last_7_days: {
        ...weekSales,
        top_products: this.topProducts(weekWin, topLimit, opts?.storeId),
      },
      low_stock: this.lowStock(threshold),
      udhaar_outstanding_paisa: this.udhaarOutstanding(opts?.storeId),
      profit: this.todayProfit(todayWin, todaySales.total_paisa, opts?.storeId),
      sales_tax_enabled: this.salesTaxEnabled(opts?.storeId),
    };
  }

  /** Tax V1 — current store switch (default OFF). */
  private salesTaxEnabled(storeId?: string | null): boolean {
    const row = this.db.raw
      .prepare(
        `SELECT sales_tax_enabled FROM store
         WHERE (? IS NULL OR id = ?)
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(storeId ?? null, storeId ?? null) as
      | { sales_tax_enabled: number }
      | undefined;
    return Number(row?.sales_tax_enabled ?? 0) === 1;
  }

  /** Calendar day in Asia/Karachi → UTC ISO bounds. */
  todayWindow(now = new Date()): WindowBounds {
    const day = this.karachiYmd(now);
    return {
      from: new Date(`${day}T00:00:00+05:00`).toISOString(),
      to: new Date(`${day}T23:59:59.999+05:00`).toISOString(),
    };
  }

  /** Inclusive last 7 Karachi calendar days ending today. */
  last7DaysWindow(now = new Date()): WindowBounds {
    const today = this.karachiYmd(now);
    const todayStart = new Date(`${today}T00:00:00+05:00`);
    const start = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
    const startDay = this.karachiYmd(start);
    return {
      from: new Date(`${startDay}T00:00:00+05:00`).toISOString(),
      to: new Date(`${today}T23:59:59.999+05:00`).toISOString(),
    };
  }


  /**
   * Slice 14 — Cashier Today: Asia/Karachi day window, non-voided only.
   * Sale count + total Rs; optional short list. No cost/margin/profit.
   * Reuses todayWindow / periodSales; does not expose Owner /analytics.
   */
  cashierToday(opts?: {
    storeId?: string | null;
    listLimit?: number;
  }): CashierTodaySummary {
    const win = this.todayWindow();
    const period = this.periodSales('today', win, opts?.storeId);
    const limit =
      opts?.listLimit != null &&
      Number.isFinite(opts.listLimit) &&
      opts.listLimit > 0
        ? Math.min(50, Math.floor(opts.listLimit))
        : 20;

    const sales = this.db.raw
      .prepare(
        `SELECT
           id,
           short_id,
           total_paisa,
           payment_method,
           recorded_at
         FROM sales
         WHERE voided_at IS NULL
           AND recorded_at >= ?
           AND recorded_at <= ?
           AND (? IS NULL OR store_id = ?)
         ORDER BY recorded_at DESC
         LIMIT ?`,
      )
      .all(win.from, win.to, opts?.storeId ?? null, opts?.storeId ?? null, limit) as CashierTodaySale[];

    return {
      timezone: ANALYTICS_TIMEZONE,
      from: win.from,
      to: win.to,
      sale_count: period.sale_count,
      total_paisa: period.total_paisa,
      return_count: period.return_count,
      returns_paisa: period.returns_paisa,
      refund_cash_paisa: period.refund_cash_paisa,
      sales: sales.map((s) => ({
        id: String(s.id),
        short_id: String(s.short_id),
        total_paisa: Number(s.total_paisa),
        payment_method: String(s.payment_method),
        recorded_at: String(s.recorded_at),
      })),
    };
  }


  /**
   * Today gross profit from snapshotted sale-line cost, not current last cost.
   * Unknown cost (NULL) is not treated as free. Explicit 0 is a real cost.
   * Today's expenses are subtracted only when every sold line has a known cost.
   */
  private todayProfit(
    win: WindowBounds,
    salesPaisa: number,
    storeId?: string | null,
  ): TodayProfit {
    const rows = this.db.raw
      .prepare(
        `SELECT
           sl.product_name AS product_name,
           sl.qty_pieces AS qty_pieces,
           sl.unit_price_paisa AS unit_price_paisa,
           sl.unit_cost_paisa AS unit_cost_paisa,
           sl.line_total_paisa AS line_total_paisa
         FROM sale_lines sl
         INNER JOIN sales s ON s.id = sl.sale_id
         WHERE s.voided_at IS NULL
           AND s.recorded_at >= ?
           AND s.recorded_at <= ?
           AND (? IS NULL OR s.store_id = ?)
         ORDER BY s.recorded_at DESC, sl.line_no ASC`,
      )
      .all(win.from, win.to, storeId ?? null, storeId ?? null) as Array<{
      product_name: string;
      qty_pieces: number;
      unit_price_paisa: number;
      unit_cost_paisa: number | null;
      line_total_paisa: number;
    }>;

    let knownCogs = 0;
    let knownSales = 0;
    let unknownSales = 0;
    let anyUnknown = false;
    const lines: ProfitLine[] = [];

    for (const row of rows) {
      const qty = Number(row.qty_pieces);
      const sell = Number(row.unit_price_paisa);
      const lineTotal = Number(row.line_total_paisa);
      const costKnown = row.unit_cost_paisa !== null && row.unit_cost_paisa !== undefined;
      if (!costKnown) {
        anyUnknown = true;
        unknownSales += lineTotal;
        lines.push({
          product_name: String(row.product_name),
          qty_pieces: qty,
          unit_price_paisa: sell,
          unit_cost_paisa: null,
          line_total_paisa: lineTotal,
          profit_paisa: null,
          markup_ratio: null,
        });
        continue;
      }
      const cost = Math.round(Number(row.unit_cost_paisa));
      const cogs = Math.round(cost * qty);
      knownCogs += cogs;
      knownSales += lineTotal;
      const profit = lineTotal - cogs;
      lines.push({
        product_name: String(row.product_name),
        qty_pieces: qty,
        unit_price_paisa: sell,
        unit_cost_paisa: cost,
        line_total_paisa: lineTotal,
        profit_paisa: profit,
        markup_ratio: cost > 0 ? Math.round(((sell - cost) / cost) * 10000) / 10000 : null,
      });
    }

    const ret = this.returnProfitIn(win, storeId);
    knownSales -= ret.knownSales;
    knownCogs -= ret.cogs;
    unknownSales -= ret.unknownSales;

    const day = this.karachiYmd(new Date(win.from));
    const exp = this.db.raw
      .prepare(
        `SELECT COALESCE(SUM(amount_paisa), 0) AS total
         FROM expenses
         WHERE expense_date = ?`,
      )
      .get(day) as { total: number };
    const expensesPaisa = Number(exp?.total ?? 0);

    const noLines = rows.length === 0;
    const cogsPaisa = noLines ? 0 : anyUnknown ? null : knownCogs;
    const gross = noLines ? 0 : anyUnknown ? null : knownSales - knownCogs;

    return {
      sales_paisa: salesPaisa,
      cogs_paisa: cogsPaisa,
      gross_profit_paisa: gross,
      cost_unknown: anyUnknown,
      unknown_sales_paisa: unknownSales,
      expenses_paisa: expensesPaisa,
      left_paisa: gross == null ? null : gross - expensesPaisa,
      lines: lines.slice(0, 40),
    };
  }

  private karachiYmd(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ANALYTICS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  private periodSales(
    label: PeriodSales['label'],
    win: WindowBounds,
    storeId?: string | null,
  ): PeriodSales {
    const row = this.db.raw
      .prepare(
        `SELECT
           COUNT(*) AS sale_count,
           COALESCE(SUM(total_paisa), 0) AS total_paisa,
           COALESCE(SUM(
             CASE
               WHEN payment_method = 'cash' THEN total_paisa - digital_paisa
               WHEN payment_method = 'split' THEN cash_amount_paisa - digital_paisa
               ELSE 0
             END
           ), 0) AS cash_paisa,
           COALESCE(SUM(digital_paisa), 0) AS digital_paisa,
           COALESCE(SUM(CASE WHEN digital_method = 'jazzcash' THEN digital_paisa ELSE 0 END), 0) AS jazzcash_paisa,
           COALESCE(SUM(CASE WHEN digital_method = 'easypaisa' THEN digital_paisa ELSE 0 END), 0) AS easypaisa_paisa,
           COALESCE(SUM(CASE WHEN digital_method = 'bank' THEN digital_paisa ELSE 0 END), 0) AS bank_paisa,
           COALESCE(SUM(discount_paisa), 0) AS discount_paisa,
           COALESCE(SUM(
             CASE
               WHEN payment_method = 'udhaar' THEN total_paisa
               WHEN payment_method = 'split' THEN udhaar_amount_paisa
               ELSE 0
             END
           ), 0) AS udhaar_paisa,
           COALESCE(SUM(CASE WHEN tax_enabled = 1 THEN 1 ELSE 0 END), 0) AS taxed_sale_count,
           COALESCE(SUM(CASE WHEN tax_enabled = 1 THEN tax_paisa ELSE 0 END), 0) AS tax_paisa,
           COALESCE(SUM(CASE WHEN tax_enabled = 1 THEN COALESCE(tax_base_paisa, total_paisa - tax_paisa) ELSE 0 END), 0) AS tax_base_paisa
         FROM sales
         WHERE voided_at IS NULL
           AND recorded_at >= ?
           AND recorded_at <= ?
           AND (? IS NULL OR store_id = ?)`,
      )
      .get(win.from, win.to, storeId ?? null, storeId ?? null) as {
      sale_count: number;
      total_paisa: number;
      cash_paisa: number;
      digital_paisa: number;
      jazzcash_paisa: number;
      easypaisa_paisa: number;
      bank_paisa: number;
      discount_paisa: number;
      udhaar_paisa: number;
      taxed_sale_count: number;
      tax_paisa: number;
      tax_base_paisa: number;
    };

    const ret = this.returnsIn(win, storeId);
    const gross = Number(row?.total_paisa ?? 0);
    return {
      from: win.from,
      to: win.to,
      label,
      sale_count: Number(row?.sale_count ?? 0),
      total_paisa: gross - ret.total,
      gross_paisa: gross,
      return_count: ret.count,
      returns_paisa: ret.total,
      refund_cash_paisa: ret.cash,
      cash_paisa: Number(row?.cash_paisa ?? 0),
      digital_paisa: Number(row?.digital_paisa ?? 0),
      jazzcash_paisa: Number(row?.jazzcash_paisa ?? 0),
      easypaisa_paisa: Number(row?.easypaisa_paisa ?? 0),
      bank_paisa: Number(row?.bank_paisa ?? 0),
      discount_paisa: Number(row?.discount_paisa ?? 0),
      udhaar_paisa: Number(row?.udhaar_paisa ?? 0),
      taxed_sale_count: Number(row?.taxed_sale_count ?? 0),
      tax_paisa: Number(row?.tax_paisa ?? 0),
      tax_base_paisa: Number(row?.tax_base_paisa ?? 0),
    };
  }

  /** Returns dated in a window (by return date). Returns exist only on active bills. */
  returnsIn(
    win: WindowBounds,
    storeId?: string | null,
  ): { count: number; total: number; cash: number } {
    const r = this.db.raw
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(total_paisa), 0) AS t,
                COALESCE(SUM(refund_cash_paisa), 0) AS c
         FROM sale_returns
         WHERE recorded_at >= ? AND recorded_at <= ?
           AND (? IS NULL OR store_id IS NULL OR store_id = ?)`,
      )
      .get(win.from, win.to, storeId ?? null, storeId ?? null) as { n: number; t: number; c: number };
    return { count: Number(r?.n ?? 0), total: Number(r?.t ?? 0), cash: Number(r?.c ?? 0) };
  }

  /**
   * Return lines dated in a window, for profit: revenue reversed on every line;
   * cost reversed only for lines put back in stock (damaged = loss).
   */
  private returnProfitIn(win: WindowBounds, storeId?: string | null) {
    const r = this.db.raw
      .prepare(
        `SELECT
           COALESCE(SUM(rl.line_total_paisa), 0) AS sales,
           COALESCE(SUM(CASE WHEN rl.unit_cost_paisa IS NOT NULL THEN rl.line_total_paisa ELSE 0 END), 0) AS known_sales,
           COALESCE(SUM(CASE WHEN rl.unit_cost_paisa IS NULL THEN rl.line_total_paisa ELSE 0 END), 0) AS unknown_sales,
           COALESCE(SUM(CASE WHEN rl.unit_cost_paisa IS NOT NULL AND rl.restocked = 1
                             THEN ROUND(rl.unit_cost_paisa) * rl.qty_pieces ELSE 0 END), 0) AS cogs
         FROM sale_return_lines rl
         INNER JOIN sale_returns r ON r.id = rl.return_id
         WHERE r.recorded_at >= ? AND r.recorded_at <= ?
           AND (? IS NULL OR r.store_id IS NULL OR r.store_id = ?)`,
      )
      .get(win.from, win.to, storeId ?? null, storeId ?? null) as {
      sales: number; known_sales: number; unknown_sales: number; cogs: number;
    };
    return {
      sales: Number(r?.sales ?? 0),
      knownSales: Number(r?.known_sales ?? 0),
      unknownSales: Number(r?.unknown_sales ?? 0),
      cogs: Number(r?.cogs ?? 0),
    };
  }

  private topProducts(
    win: WindowBounds,
    limit: number,
    storeId?: string | null,
  ): TopProduct[] {
    return this.db.raw
      .prepare(
        `SELECT product_id, MAX(product_name) AS product_name,
                SUM(qty) AS qty_pieces, SUM(rev) AS revenue_paisa
         FROM (
           SELECT sl.product_id, sl.product_name, sl.qty_pieces AS qty, ROUND(sl.line_total_paisa * CASE WHEN COALESCE(s.subtotal_paisa, 0) > 0 THEN CAST(s.total_paisa AS REAL) / s.subtotal_paisa ELSE 1 END) AS rev
           FROM sale_lines sl
           INNER JOIN sales s ON s.id = sl.sale_id
           WHERE s.voided_at IS NULL
             AND s.recorded_at >= ?
             AND s.recorded_at <= ?
             AND (? IS NULL OR s.store_id = ?)
           UNION ALL
           SELECT rl.product_id, rl.product_name, -rl.qty_pieces, -rl.line_total_paisa
           FROM sale_return_lines rl
           INNER JOIN sale_returns r ON r.id = rl.return_id
           WHERE r.recorded_at >= ?
             AND r.recorded_at <= ?
             AND (? IS NULL OR r.store_id IS NULL OR r.store_id = ?)
         )
         GROUP BY product_id
         HAVING qty_pieces > 0 OR revenue_paisa > 0
         ORDER BY revenue_paisa DESC, qty_pieces DESC, product_name ASC
         LIMIT ?`,
      )
      .all(
        win.from, win.to, storeId ?? null, storeId ?? null,
        win.from, win.to, storeId ?? null, storeId ?? null, limit,
      ) as TopProduct[];
  }

  private lowStock(threshold: number): LowStockItem[] {
    return this.db.raw
      .prepare(
        `SELECT
           p.id AS product_id,
           p.name AS name,
           COALESCE(sb.qty_on_hand, 0) AS qty_on_hand,
           COALESCE(p.unit_label, 'piece') AS unit_label,
           p.last_unit_cost_paisa AS last_unit_cost_paisa
         FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id
         WHERE p.active = 1
           AND COALESCE(sb.qty_on_hand, 0) <= ?
         ORDER BY qty_on_hand ASC, p.name COLLATE NOCASE ASC`,
      )
      .all(threshold) as LowStockItem[];
  }

  /**
   * Sum of party balances where balance > 0 (party owes us).
   * Balance = debits − credits (same as PartiesService).
   */
  private udhaarOutstanding(storeId?: string | null): number {
    const row = this.db.raw
      .prepare(
        `SELECT COALESCE(SUM(bal), 0) AS outstanding FROM (
           SELECT
             COALESCE(SUM(CASE WHEN l.entry_type = 'debit' THEN l.amount_paisa ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN l.entry_type = 'credit' THEN l.amount_paisa ELSE 0 END), 0)
             AS bal
           FROM parties p
           LEFT JOIN party_ledger l ON l.party_id = p.id
           WHERE (? IS NULL OR p.store_id = ?)
           GROUP BY p.id
           HAVING bal > 0
         )`,
      )
      .get(storeId ?? null, storeId ?? null) as { outstanding: number };
    return Number(row?.outstanding ?? 0);
  }

  /* ── Insights (Today tab): cash in till, top udhaar, slow movers ── */

  insights(opts?: { storeId?: string | null }): AnalyticsInsights {
    const now = new Date();
    return {
      timezone: ANALYTICS_TIMEZONE,
      cash_till: this.cashTill(now, opts?.storeId),
      top_udhaar: this.topUdhaar(TOP_UDHAAR_LIMIT, now, opts?.storeId),
      slow_movers: this.slowMovers({
        storeId: opts?.storeId,
        page: 1,
        pageSize: SLOW_MOVER_PREVIEW,
        now,
      }),
    };
  }

  /**
   * Cash expected in the till today = cash part of today's non-voided sales
   * + udhaar payments dated today − expenses dated today.
   * Expenses carry no payment method, so all are treated as paid in cash.
   */
  cashTill(now = new Date(), storeId?: string | null): CashTill {
    const win = this.todayWindow(now);
    const day = this.karachiYmd(now);
    const sales = this.periodSales('today', win, storeId);
    const received = this.db.raw
      .prepare(
        `SELECT COALESCE(SUM(l.amount_paisa), 0) AS total
         FROM party_ledger l
         INNER JOIN parties p ON p.id = l.party_id
         LEFT JOIN sales s ON s.id = l.sale_id
         WHERE l.entry_type = 'credit'
           AND l.collected_on = ?
           AND (l.sale_id IS NULL OR s.voided_at IS NULL)
           AND (? IS NULL OR p.store_id = ?)`,
      )
      .get(day, storeId ?? null, storeId ?? null) as { total: number };
    // Salary paid from outside the drawer still counts in profit, not here.
    const expenses = this.expensesBetween(day, day, true);
    const cashSales = sales.cash_paisa;
    const udhaarReceived = Number(received?.total ?? 0);
    const refunds = sales.refund_cash_paisa;
    // Till cash in / out entries made today (Karachi day of created_at).
    const moves = this.db.raw
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN kind = 'in' THEN amount_paisa ELSE 0 END), 0) AS cin,
                COALESCE(SUM(CASE WHEN kind = 'out' THEN amount_paisa ELSE 0 END), 0) AS cout
         FROM till_moves WHERE date(created_at, '+5 hours') = ?`,
      )
      .get(day) as { cin: number; cout: number };
    const cashIn = Number(moves?.cin ?? 0);
    const cashOut = Number(moves?.cout ?? 0);
    return {
      day,
      cash_sales_paisa: cashSales,
      udhaar_received_paisa: udhaarReceived,
      expenses_paisa: expenses,
      refunds_cash_paisa: refunds,
      cash_in_paisa: cashIn,
      cash_out_paisa: cashOut,
      digital_paisa: sales.digital_paisa ?? 0,
      expected_paisa: cashSales + udhaarReceived - expenses - refunds + cashIn - cashOut,
    };
  }

  /**
   * Customers who owe the most (balance = debits − credits > 0).
   * Days since last real payment (dated credit, not on a voided sale);
   * never paid → days since their first udhaar entry.
   */
  topUdhaar(
    limit: number,
    now = new Date(),
    storeId?: string | null,
  ): TopUdhaarCustomer[] {
    const rows = this.db.raw
      .prepare(
        `SELECT
           p.id AS party_id,
           p.name AS name,
           p.phone AS phone,
           COALESCE(SUM(CASE WHEN l.entry_type = 'debit' THEN l.amount_paisa ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN l.entry_type = 'credit' THEN l.amount_paisa ELSE 0 END), 0)
             AS balance_paisa,
           MAX(CASE
                 WHEN l.entry_type = 'credit' AND l.collected_on IS NOT NULL
                      AND (l.sale_id IS NULL OR s.voided_at IS NULL)
                 THEN l.collected_on
               END) AS last_paid_on,
           MIN(CASE
                 WHEN l.entry_type = 'debit'
                 THEN date(l.created_at, '+5 hours')
               END) AS first_owed_on
         FROM parties p
         INNER JOIN party_ledger l ON l.party_id = p.id
         LEFT JOIN sales s ON s.id = l.sale_id
         WHERE (? IS NULL OR p.store_id = ?)
         GROUP BY p.id
         HAVING balance_paisa > 0
         ORDER BY balance_paisa DESC, p.name COLLATE NOCASE ASC
         LIMIT ?`,
      )
      .all(storeId ?? null, storeId ?? null, Math.max(1, Math.min(50, limit))) as Array<{
      party_id: string;
      name: string;
      phone: string | null;
      balance_paisa: number;
      last_paid_on: string | null;
      first_owed_on: string | null;
    }>;
    const today = this.karachiYmd(now);
    return rows.map((r) => {
      const paid = r.last_paid_on ? String(r.last_paid_on) : null;
      const owed = r.first_owed_on ? String(r.first_owed_on) : null;
      const sinceDate = paid ?? owed;
      return {
        party_id: String(r.party_id),
        name: String(r.name),
        phone: r.phone == null ? null : String(r.phone),
        balance_paisa: Number(r.balance_paisa),
        since_kind: paid ? 'paid' : 'owed',
        since_date: sinceDate,
        days: sinceDate ? this.daysBetween(sinceDate, today) : null,
      };
    });
  }

  /**
   * Active items with stock > 0 and no non-voided sale in the last
   * SLOW_MOVER_DAYS Karachi days (today included). Sorted by stock value
   * (qty × last cost; unknown cost last), then qty.
   */
  slowMovers(opts: {
    storeId?: string | null;
    page?: number;
    pageSize?: number;
    now?: Date;
  }): SlowMoversPage {
    const now = opts.now ?? new Date();
    const win = this.daysBackWindow(SLOW_MOVER_DAYS, now);
    const pageSize =
      opts.pageSize != null && Number.isFinite(opts.pageSize) && opts.pageSize > 0
        ? Math.min(100, Math.floor(opts.pageSize))
        : 20;
    const page =
      opts.page != null && Number.isFinite(opts.page) && opts.page > 0
        ? Math.floor(opts.page)
        : 1;
    const storeId = opts.storeId ?? null;

    const base = `
      FROM products p
      INNER JOIN stock_balances sb ON sb.product_id = p.id
      WHERE p.active = 1
        AND sb.qty_on_hand > 0
        AND NOT EXISTS (
          SELECT 1 FROM sale_lines sl
          INNER JOIN sales s ON s.id = sl.sale_id
          WHERE sl.product_id = p.id
            AND s.voided_at IS NULL
            AND s.recorded_at >= ?
            AND (? IS NULL OR s.store_id = ?)
        )`;

    const agg = this.db.raw
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN p.last_unit_cost_paisa IS NULL THEN 0
                             ELSE ROUND(sb.qty_on_hand * p.last_unit_cost_paisa) END), 0) AS value
         ${base}`,
      )
      .get(win.from, storeId, storeId) as { total: number; value: number };

    const rows = this.db.raw
      .prepare(
        `SELECT
           p.id AS product_id,
           p.name AS name,
           COALESCE(p.unit_label, 'piece') AS unit_label,
           sb.qty_on_hand AS qty_on_hand,
           p.last_unit_cost_paisa AS last_unit_cost_paisa,
           CASE WHEN p.last_unit_cost_paisa IS NULL THEN NULL
                ELSE ROUND(sb.qty_on_hand * p.last_unit_cost_paisa) END AS stock_value_paisa,
           (SELECT MAX(s2.recorded_at) FROM sale_lines sl2
              INNER JOIN sales s2 ON s2.id = sl2.sale_id
              WHERE sl2.product_id = p.id AND s2.voided_at IS NULL) AS last_sold_at
         ${base}
         ORDER BY (stock_value_paisa IS NULL) ASC, stock_value_paisa DESC,
                  sb.qty_on_hand DESC, p.name COLLATE NOCASE ASC
         LIMIT ? OFFSET ?`,
      )
      .all(win.from, storeId, storeId, pageSize, (page - 1) * pageSize) as SlowMover[];

    return {
      days: SLOW_MOVER_DAYS,
      since: this.karachiYmd(new Date(win.from)),
      total: Number(agg?.total ?? 0),
      stock_value_paisa: Number(agg?.value ?? 0),
      page,
      page_size: pageSize,
      items: rows.map((r) => ({
        product_id: String(r.product_id),
        name: String(r.name),
        unit_label: String(r.unit_label),
        qty_on_hand: Number(r.qty_on_hand),
        last_unit_cost_paisa:
          r.last_unit_cost_paisa == null ? null : Number(r.last_unit_cost_paisa),
        stock_value_paisa:
          r.stock_value_paisa == null ? null : Number(r.stock_value_paisa),
        last_sold_at: r.last_sold_at == null ? null : String(r.last_sold_at),
      })),
    };
  }

  /* ── Profit tab: this week vs last week, top items by profit ── */

  profitCompare(opts?: { storeId?: string | null; topLimit?: number }): ProfitCompare {
    const now = new Date();
    const thisWin = this.last7DaysWindow(now);
    const lastEnd = new Date(new Date(thisWin.from).getTime() - 1);
    const lastWin = this.last7DaysWindow(lastEnd);
    const thisWeek = this.windowProfit(thisWin, opts?.storeId);
    const lastWeek = this.windowProfit(lastWin, opts?.storeId);
    const last = lastWeek.net_profit_paisa;
    const change =
      last === 0
        ? null
        : Math.round(((thisWeek.net_profit_paisa - last) / Math.abs(last)) * 1000) / 10;
    const limit =
      opts?.topLimit != null && Number.isFinite(opts.topLimit) && opts.topLimit > 0
        ? Math.min(20, Math.floor(opts.topLimit))
        : 5;
    const top = this.topProfitItems(thisWin, limit, opts?.storeId);
    return {
      timezone: ANALYTICS_TIMEZONE,
      this_week: thisWeek,
      last_week: lastWeek,
      change_pct: change,
      top_items: top.items,
      top_items_cost_unknown: top.costUnknown,
    };
  }

  /** Profit for a window from snapshotted line cost; unknown-cost lines left out and flagged. */
  windowProfit(win: WindowBounds, storeId?: string | null): WindowProfit {
    const row = this.db.raw
      .prepare(
        `SELECT
           COALESCE(SUM(ROUND(sl.line_total_paisa * CASE WHEN COALESCE(s.subtotal_paisa, 0) > 0 THEN CAST(s.total_paisa AS REAL) / s.subtotal_paisa ELSE 1 END)), 0) AS sales,
           COALESCE(SUM(CASE WHEN sl.unit_cost_paisa IS NOT NULL
                             THEN ROUND(sl.line_total_paisa * CASE WHEN COALESCE(s.subtotal_paisa, 0) > 0 THEN CAST(s.total_paisa AS REAL) / s.subtotal_paisa ELSE 1 END) ELSE 0 END), 0) AS known_sales,
           COALESCE(SUM(CASE WHEN sl.unit_cost_paisa IS NOT NULL
                             THEN ROUND(ROUND(sl.unit_cost_paisa) * sl.qty_pieces) ELSE 0 END), 0) AS cogs,
           COALESCE(SUM(CASE WHEN sl.unit_cost_paisa IS NULL THEN 1 ELSE 0 END), 0) AS unknown_lines
         FROM sale_lines sl
         INNER JOIN sales s ON s.id = sl.sale_id
         WHERE s.voided_at IS NULL
           AND s.recorded_at >= ?
           AND s.recorded_at <= ?
           AND (? IS NULL OR s.store_id = ?)`,
      )
      .get(win.from, win.to, storeId ?? null, storeId ?? null) as {
      sales: number;
      known_sales: number;
      cogs: number;
      unknown_lines: number;
    };
    const fromDay = this.karachiYmd(new Date(win.from));
    const toDay = this.karachiYmd(new Date(win.to));
    const ret = this.returnProfitIn(win, storeId);
    const cogs = Number(row?.cogs ?? 0) - ret.cogs;
    const gross = Number(row?.known_sales ?? 0) - ret.knownSales - cogs;
    const expenses = this.expensesBetween(fromDay, toDay);
    return {
      from_day: fromDay,
      to_day: toDay,
      sales_paisa: Number(row?.sales ?? 0) - ret.sales,
      cogs_paisa: cogs,
      gross_profit_paisa: gross,
      expenses_paisa: expenses,
      net_profit_paisa: gross - expenses,
      cost_unknown: Number(row?.unknown_lines ?? 0) > 0,
    };
  }

  private topProfitItems(
    win: WindowBounds,
    limit: number,
    storeId?: string | null,
  ): { items: TopProfitItem[]; costUnknown: boolean } {
    const items = this.db.raw
      .prepare(
        `SELECT
           sl.product_id AS product_id,
           MAX(sl.product_name) AS product_name,
           COALESCE(SUM(sl.qty_pieces), 0) AS qty_pieces,
           COALESCE(SUM(ROUND(sl.line_total_paisa * CASE WHEN COALESCE(s.subtotal_paisa, 0) > 0 THEN CAST(s.total_paisa AS REAL) / s.subtotal_paisa ELSE 1 END)), 0) AS revenue_paisa,
           COALESCE(SUM(ROUND(sl.line_total_paisa * CASE WHEN COALESCE(s.subtotal_paisa, 0) > 0 THEN CAST(s.total_paisa AS REAL) / s.subtotal_paisa ELSE 1 END) - ROUND(ROUND(sl.unit_cost_paisa) * sl.qty_pieces)), 0) AS profit_paisa
         FROM sale_lines sl
         INNER JOIN sales s ON s.id = sl.sale_id
         WHERE s.voided_at IS NULL
           AND sl.unit_cost_paisa IS NOT NULL
           AND s.recorded_at >= ?
           AND s.recorded_at <= ?
           AND (? IS NULL OR s.store_id = ?)
         GROUP BY sl.product_id
         ORDER BY profit_paisa DESC, qty_pieces DESC, product_name COLLATE NOCASE ASC
         LIMIT ?`,
      )
      .all(win.from, win.to, storeId ?? null, storeId ?? null, limit) as TopProfitItem[];
    const unknown = this.db.raw
      .prepare(
        `SELECT COUNT(*) AS n
         FROM sale_lines sl
         INNER JOIN sales s ON s.id = sl.sale_id
         WHERE s.voided_at IS NULL
           AND sl.unit_cost_paisa IS NULL
           AND s.recorded_at >= ?
           AND s.recorded_at <= ?
           AND (? IS NULL OR s.store_id = ?)`,
      )
      .get(win.from, win.to, storeId ?? null, storeId ?? null) as { n: number };
    return {
      items: items.map((r) => ({
        product_id: String(r.product_id),
        product_name: String(r.product_name),
        qty_pieces: Number(r.qty_pieces),
        revenue_paisa: Number(r.revenue_paisa),
        profit_paisa: Number(r.profit_paisa),
      })),
      costUnknown: Number(unknown?.n ?? 0) > 0,
    };
  }

  /**
   * Profit per product over a Karachi date range (bill discount shared out;
   * returns taken off). Lines with no known cost show revenue only.
   */
  productProfit(fromDay: string, toDay: string, storeId?: string | null) {
    const win = {
      from: new Date(`${fromDay}T00:00:00+05:00`).toISOString(),
      to: new Date(new Date(`${toDay}T00:00:00+05:00`).getTime() + 86400000 - 1).toISOString(),
    };
    const rows = this.db.raw
      .prepare(
        `SELECT product_id, MAX(product_name) AS product_name, MAX(unit_label) AS unit_label,
                ROUND(SUM(qty), 3) AS qty, SUM(rev) AS revenue_paisa,
                SUM(CASE WHEN cost IS NULL THEN 0 ELSE ROUND(ROUND(cost) * qty) END) AS cogs_paisa,
                SUM(CASE WHEN cost IS NULL THEN 1 ELSE 0 END) AS unknown_lines
         FROM (
           SELECT sl.product_id, sl.product_name, p.unit_label, sl.qty_pieces AS qty, ROUND(sl.line_total_paisa * CASE WHEN COALESCE(s.subtotal_paisa, 0) > 0 THEN CAST(s.total_paisa AS REAL) / s.subtotal_paisa ELSE 1 END) AS rev, sl.unit_cost_paisa AS cost
           FROM sale_lines sl
           INNER JOIN sales s ON s.id = sl.sale_id
           LEFT JOIN products p ON p.id = sl.product_id
           WHERE s.voided_at IS NULL AND s.recorded_at >= ? AND s.recorded_at <= ?
             AND (? IS NULL OR s.store_id = ?)
           UNION ALL
           SELECT rl.product_id, rl.product_name, p.unit_label, -rl.qty_pieces, -rl.line_total_paisa, rl.unit_cost_paisa
           FROM sale_return_lines rl
           INNER JOIN sale_returns r ON r.id = rl.return_id
           LEFT JOIN products p ON p.id = rl.product_id
           WHERE r.recorded_at >= ? AND r.recorded_at <= ?
             AND (? IS NULL OR r.store_id IS NULL OR r.store_id = ?)
         )
         GROUP BY product_id
         HAVING qty <> 0 OR revenue_paisa <> 0
         ORDER BY (revenue_paisa - cogs_paisa) DESC, product_name COLLATE NOCASE`,
      )
      .all(
        win.from, win.to, storeId ?? null, storeId ?? null,
        win.from, win.to, storeId ?? null, storeId ?? null,
      ) as Array<{ product_id: string; product_name: string; unit_label: string | null; qty: number; revenue_paisa: number; cogs_paisa: number; unknown_lines: number }>;
    const items = rows.map((r) => {
      const rev = Number(r.revenue_paisa);
      const cogs = Number(r.cogs_paisa);
      const unknown = Number(r.unknown_lines) > 0;
      return {
        product_id: r.product_id,
        product_name: r.product_name,
        unit_label: r.unit_label ?? 'piece',
        qty: Number(r.qty),
        revenue_paisa: rev,
        cogs_paisa: cogs,
        profit_paisa: rev - cogs,
        margin_bp: rev > 0 ? Math.round(((rev - cogs) * 10000) / rev) : 0,
        cost_unknown: unknown,
      };
    });
    return {
      from_day: fromDay,
      to_day: toDay,
      items,
      revenue_paisa: items.reduce((s, i) => s + i.revenue_paisa, 0),
      profit_paisa: items.reduce((s, i) => s + i.profit_paisa, 0),
    };
  }

  /** Σ expenses with expense_date in [fromDay, toDay] (YYYY-MM-DD, Karachi). */
  private expensesBetween(fromDay: string, toDay: string, drawerOnly = false): number {
    const row = this.db.raw
      .prepare(
        `SELECT COALESCE(SUM(amount_paisa), 0) AS total
         FROM expenses
         WHERE expense_date >= ? AND expense_date <= ?${drawerOnly ? ' AND from_drawer = 1' : ''}`,
      )
      .get(fromDay, toDay) as { total: number };
    return Number(row?.total ?? 0);
  }

  /** Inclusive last `days` Karachi calendar days ending today. */
  daysBackWindow(days: number, now = new Date()): WindowBounds {
    const today = this.karachiYmd(now);
    const todayStart = new Date(`${today}T00:00:00+05:00`);
    const start = new Date(todayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    const startDay = this.karachiYmd(start);
    return {
      from: new Date(`${startDay}T00:00:00+05:00`).toISOString(),
      to: new Date(`${today}T23:59:59.999+05:00`).toISOString(),
    };
  }

  /** Whole days from a to b (YYYY-MM-DD). */
  private daysBetween(a: string, b: string): number | null {
    const re = /^(\d{4})-(\d{2})-(\d{2})$/;
    const ma = re.exec(a);
    const mb = re.exec(b);
    if (!ma || !mb) return null;
    const ta = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
    const tb = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
    return Math.max(0, Math.round((tb - ta) / 86400000));
  }
}
