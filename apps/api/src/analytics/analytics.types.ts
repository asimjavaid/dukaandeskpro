/** Slice 7 — Owner analytics response (SQLite aggregates, Asia/Karachi windows). */

export const ANALYTICS_TIMEZONE = 'Asia/Karachi';
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const DEFAULT_TOP_PRODUCTS_LIMIT = 5;

export type PeriodSales = {
  from: string;
  to: string;
  label: 'today' | 'last_7_days';
  sale_count: number;
  total_paisa: number;
  /** Drawer cash only (digital excluded). */
  cash_paisa: number;
  digital_paisa?: number;
  jazzcash_paisa?: number;
  easypaisa_paisa?: number;
  bank_paisa?: number;
  discount_paisa?: number;
  udhaar_paisa: number;
  /** Tax V1 — sales with a Sales Tax snapshot (tax_enabled = 1). */
  taxed_sale_count: number;
  /** Σ tax extracted from taxed sales (inside total_paisa, never added on top). */
  tax_paisa: number;
  /** Σ taxable base of taxed sales. */
  tax_base_paisa: number;
  /** Bill totals before returns (total_paisa is net of returns dated in the window). */
  gross_paisa: number;
  return_count: number;
  returns_paisa: number;
  /** Cash handed back on returns dated in the window. */
  refund_cash_paisa: number;
};

export type TopProduct = {
  product_id: string;
  product_name: string;
  qty_pieces: number;
  revenue_paisa: number;
};

export type LowStockItem = {
  product_id: string;
  name: string;
  qty_on_hand: number;
  /** For Restock → New purchase prefill. */
  unit_label: string;
  last_unit_cost_paisa: number | null;
};

export type AnalyticsSummary = {
  timezone: typeof ANALYTICS_TIMEZONE;
  low_stock_threshold: number;
  today: PeriodSales & { top_products: TopProduct[] };
  last_7_days: PeriodSales & { top_products: TopProduct[] };
  low_stock: LowStockItem[];
  udhaar_outstanding_paisa: number;
  profit: TodayProfit;
  /** Current store Sales Tax switch (show tax columns when ON or any taxed sale). */
  sales_tax_enabled: boolean;
};

/** Slice 14 — Cashier Today (light; no cost/margin/profit; non-voided only). */
export type CashierTodaySale = {
  id: string;
  short_id: string;
  total_paisa: number;
  payment_method: string;
  recorded_at: string;
};

export type CashierTodaySummary = {
  timezone: typeof ANALYTICS_TIMEZONE;
  from: string;
  to: string;
  sale_count: number;
  /** Net of returns made today. */
  total_paisa: number;
  return_count: number;
  returns_paisa: number;
  refund_cash_paisa: number;
  /** Recent non-voided sales today (newest first). Keep light. */
  sales: CashierTodaySale[];
};

/** Owner today profit. Null cost/profit means at least one line has unknown cost. */
export type ProfitLine = {
  product_name: string;
  qty_pieces: number;
  unit_price_paisa: number;
  unit_cost_paisa: number | null;
  line_total_paisa: number;
  profit_paisa: number | null;
  /** (sell - cost) / cost when cost > 0. Null if cost unknown or cost is 0. */
  markup_ratio: number | null;
};

export type TodayProfit = {
  sales_paisa: number;
  cogs_paisa: number | null;
  gross_profit_paisa: number | null;
  cost_unknown: boolean;
  unknown_sales_paisa: number;
  expenses_paisa: number;
  /** Gross profit minus today's expenses. Null when gross profit is unknown. */
  left_paisa: number | null;
  lines: ProfitLine[];
};


/* ── Analytics insights (Today tab extras) ── */

export const SLOW_MOVER_DAYS = 30;
export const TOP_UDHAAR_LIMIT = 3;
export const SLOW_MOVER_PREVIEW = 10;

/** Cash expected in the till today (Asia/Karachi day). All paisa. */
export type CashTill = {
  day: string;
  /** Cash part of non-voided cash + split sales today. */
  cash_sales_paisa: number;
  /** Customer udhaar payments dated today (khata credits), incl. kept sale surplus. */
  udhaar_received_paisa: number;
  /** Expenses dated today (no payment method on expenses → treated as cash). */
  expenses_paisa: number;
  /** Cash handed back on returns today. */
  refunds_cash_paisa: number;
  /** Till cash in / out entries today. */
  cash_in_paisa: number;
  cash_out_paisa: number;
  /** JazzCash / Easypaisa / bank received today (not in the drawer). */
  digital_paisa: number;
  /** cash_sales + udhaar_received − expenses − cash refunds + cash in − cash out. May be negative. */
  expected_paisa: number;
};

export type TopUdhaarCustomer = {
  party_id: string;
  name: string;
  phone: string | null;
  balance_paisa: number;
  /** 'paid' = days since last payment; 'owed' = never paid, days since first udhaar. */
  since_kind: 'paid' | 'owed';
  since_date: string | null;
  days: number | null;
};

export type SlowMover = {
  product_id: string;
  name: string;
  unit_label: string;
  qty_on_hand: number;
  last_unit_cost_paisa: number | null;
  /** qty × last cost; null when cost unknown. */
  stock_value_paisa: number | null;
  /** Last non-voided sale time (ISO) or null if never sold. */
  last_sold_at: string | null;
};

export type SlowMoversPage = {
  days: number;
  since: string;
  total: number;
  /** Σ stock value of all slow movers with a known cost. */
  stock_value_paisa: number;
  page: number;
  page_size: number;
  items: SlowMover[];
};

export type AnalyticsInsights = {
  timezone: typeof ANALYTICS_TIMEZONE;
  cash_till: CashTill;
  top_udhaar: TopUdhaarCustomer[];
  slow_movers: SlowMoversPage;
};

/* ── Profit tab extras ── */

export type WindowProfit = {
  from_day: string;
  to_day: string;
  sales_paisa: number;
  /** COGS of lines with a known cost. */
  cogs_paisa: number;
  /** Line totals − COGS for lines with a known cost. */
  gross_profit_paisa: number;
  expenses_paisa: number;
  /** gross_profit − expenses. */
  net_profit_paisa: number;
  /** True when some sold lines had no cost (left out of profit). */
  cost_unknown: boolean;
};

export type TopProfitItem = {
  product_id: string;
  product_name: string;
  qty_pieces: number;
  revenue_paisa: number;
  profit_paisa: number;
};

export type ProfitCompare = {
  timezone: typeof ANALYTICS_TIMEZONE;
  this_week: WindowProfit;
  last_week: WindowProfit;
  /** (this − last) / |last| × 100, 1 decimal. Null when last week is 0. */
  change_pct: number | null;
  /** Top 5 items by profit in this_week (known-cost lines only). */
  top_items: TopProfitItem[];
  top_items_cost_unknown: boolean;
};
