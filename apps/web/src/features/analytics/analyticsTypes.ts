import { formatRsShort } from '../../lib/money';

/** Shapes returned by GET /analytics (owner). Shared by the screen and its reports. */

export type TopProduct = {
  product_id: string;
  product_name: string;
  qty_pieces: number;
  revenue_paisa: number;
};

export type Period = {
  from: string;
  to: string;
  sale_count: number;
  total_paisa: number;
  cash_paisa: number;
  udhaar_paisa: number;
  /** Tax V1 — taxed sales in the window (0 when Sales Tax never ON). */
  taxed_sale_count?: number;
  tax_paisa?: number;
  tax_base_paisa?: number;
  top_products: TopProduct[];
};

export type ProfitLine = {
  product_name: string;
  qty_pieces: number;
  unit_price_paisa: number;
  unit_cost_paisa: number | null;
  line_total_paisa: number;
  profit_paisa: number | null;
  markup_ratio: number | null;
};

export type TodayProfit = {
  sales_paisa: number;
  cogs_paisa: number | null;
  gross_profit_paisa: number | null;
  cost_unknown: boolean;
  unknown_sales_paisa: number;
  expenses_paisa: number;
  left_paisa: number | null;
  lines: ProfitLine[];
};

export type AnalyticsSummary = {
  timezone: string;
  low_stock_threshold: number;
  today: Period;
  last_7_days: Period;
  low_stock: LowStockItem[];
  udhaar_outstanding_paisa: number;
  profit: TodayProfit;
  /** Current Sales Tax switch. */
  sales_tax_enabled?: boolean;
};

/** D31: Analytics no longer shows D30 inclusive tax columns. */
export function showSalesTax(_data: AnalyticsSummary): boolean {
  return false;
}

export type AnalyticsTab = 'today' | 'profit';

export type LowStockItem = {
  product_id: string;
  name: string;
  qty_on_hand: number;
  unit_label?: string;
  last_unit_cost_paisa?: number | null;
};

/** GET /analytics/insights */
export type CashTill = {
  day: string;
  cash_sales_paisa: number;
  udhaar_received_paisa: number;
  expenses_paisa: number;
  expected_paisa: number;
  cash_in_paisa?: number;
  cash_out_paisa?: number;
  digital_paisa?: number;
};

export type TopUdhaarCustomer = {
  party_id: string;
  name: string;
  phone: string | null;
  balance_paisa: number;
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
  stock_value_paisa: number | null;
  last_sold_at: string | null;
};

export type SlowMoversPage = {
  days: number;
  since: string;
  total: number;
  stock_value_paisa: number;
  page: number;
  page_size: number;
  items: SlowMover[];
};

export type AnalyticsInsights = {
  timezone: string;
  cash_till: CashTill;
  top_udhaar: TopUdhaarCustomer[];
  slow_movers: SlowMoversPage;
};

/** GET /analytics/profit-compare */
export type WindowProfit = {
  from_day: string;
  to_day: string;
  sales_paisa: number;
  cogs_paisa: number;
  gross_profit_paisa: number;
  expenses_paisa: number;
  net_profit_paisa: number;
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
  timezone: string;
  this_week: WindowProfit;
  last_week: WindowProfit;
  change_pct: number | null;
  top_items: TopProfitItem[];
  top_items_cost_unknown: boolean;
};

/** Restock → New purchase prefill (via App nav state). */
export type RestockItem = {
  id: string;
  name: string;
  unit_label: string;
  last_unit_cost_paisa: number | null;
};

/** Notifications alias; same display as formatRsShort (lib/money). */
export function formatRs(paisa: number): string {
  return formatRsShort(paisa);
}
