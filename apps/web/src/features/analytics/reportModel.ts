/**
 * Analytics reports: one model per tab, rendered two ways.
 * - Print / PDF: ReportSheet (browser print → "Save as PDF").
 * - Excel: buildReportSheets -> real .xlsx via POST /export/xlsx (Urdu-safe, numbers stay numbers).
 *   Money is plain rupees (no ".00" when whole); every money header says "(Rs)".
 * Screen / PDF money uses the short "Rs 19,460" format.
 */
import type { MessageKey } from '../../i18n';
import { formatRsShort } from '../../lib/money';
import type {
  AnalyticsInsights,
  AnalyticsSummary,
  AnalyticsTab,
  Period,
  ProfitCompare,
} from './analyticsTypes';

type T = (key: MessageKey) => string;

/** 'rs' = money in paisa shown as rupees; 'pct' = a percentage number. */
type Unit = 'rs' | 'pct';

export type ReportCell =
  | { kind: 'label'; value: string; unit?: Unit }
  | { kind: 'text'; value: string }
  | { kind: 'money'; paisa: number }
  | { kind: 'int'; value: number }
  | { kind: 'pct'; value: number }
  | { kind: 'unknown'; label: string };

export type ReportColumn = { label: string; numeric?: boolean; unit?: Unit };

export type ReportTable = {
  id: string;
  title: string;
  columns: ReportColumn[];
  rows: ReportCell[][];
  empty: string;
};

export type ReportStore = {
  name: string;
  phone: string | null;
  address: string | null;
};

export type ReportPaper = 'a4' | 'letter';

export type AnalyticsReport = {
  tab: AnalyticsTab;
  title: string;
  storeName: string;
  storeLine: string;
  meta: { label: string; value: string }[];
  tables: ReportTable[];
  notes: string[];
  /** File name without extension, e.g. dukaandesk-sales-2026-10-05 */
  fileBase: string;
};

const money = (paisa: number): ReportCell => ({ kind: 'money', paisa });
const int = (value: number): ReportCell => ({ kind: 'int', value });
const text = (value: string): ReportCell => ({ kind: 'text', value });
const label = (value: string, unit?: Unit): ReportCell => ({ kind: 'label', value, unit });
const moneyOr = (paisa: number | null, unknown: string): ReportCell =>
  paisa == null ? { kind: 'unknown', label: unknown } : money(paisa);

function fmt(
  date: Date,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions,
  locale = 'en-GB',
): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, opts).format(date);
  }
}

function day(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return fmt(d, timeZone, { day: 'numeric', month: 'short', year: 'numeric' });
}

function range(period: Period, timeZone: string): string {
  const from = day(period.from, timeZone);
  const to = day(period.to, timeZone);
  return from === to ? from : `${from} – ${to}`;
}

/** YYYY-MM-DD in the store time zone (for file names). */
function isoDay(date: Date, timeZone: string): string {
  return fmt(date, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA');
}

function storeLine(store: ReportStore | null): string {
  return [store?.address?.trim(), store?.phone?.trim()].filter(Boolean).join(' · ');
}

function baseMeta(t: T, data: AnalyticsSummary, period: string, now: Date) {
  return [
    { label: t('reportPeriod'), value: period },
    {
      label: t('reportGenerated'),
      value: fmt(now, data.timezone, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h12',
      }),
    },
    { label: t('reportTimezone'), value: data.timezone },
  ];
}

function topTable(t: T, id: string, title: string, period: Period): ReportTable {
  return {
    id,
    title,
    columns: [
      { label: t('catalogColProduct') },
      { label: t('qty'), numeric: true },
      { label: t('reportRevenue'), numeric: true, unit: 'rs' },
    ],
    rows: period.top_products.map((p) => [
      text(p.product_name),
      int(p.qty_pieces),
      money(p.revenue_paisa),
    ]),
    empty: t('analyticsEmpty'),
  };
}

export function buildTodayReport(
  t: T,
  data: AnalyticsSummary,
  store: ReportStore | null,
  now = new Date(),
  insights: AnalyticsInsights | null = null,
): AnalyticsReport {
  const tz = data.timezone;
  const today = data.today;
  const week = data.last_7_days;
  return {
    tab: 'today',
    title: t('reportTitleToday'),
    storeName: store?.name?.trim() || t('appName'),
    storeLine: storeLine(store),
    meta: baseMeta(
      t,
      data,
      `${t('analyticsToday')}: ${range(today, tz)} · ${t('analyticsLast7Days')}: ${range(week, tz)}`,
      now,
    ),
    tables: [
      {
        id: 'sales',
        title: t('reportSummary'),
        columns: [
          { label: t('reportItem') },
          { label: t('analyticsToday'), numeric: true },
          { label: t('analyticsLast7Days'), numeric: true },
        ],
        rows: [
          [label(t('analyticsSalesTotal'), 'rs'), money(today.total_paisa), money(week.total_paisa)],
          [label(t('analyticsCash'), 'rs'), money(today.cash_paisa), money(week.cash_paisa)],
          [label(t('analyticsUdhaar'), 'rs'), money(today.udhaar_paisa), money(week.udhaar_paisa)],
          [label(t('analyticsSaleCount')), int(today.sale_count), int(week.sale_count)],
        ],
        empty: t('analyticsEmpty'),
      },
      {
        id: 'position',
        title: t('reportPosition'),
        columns: [{ label: t('reportItem') }, { label: t('reportValue'), numeric: true }],
        rows: [
          [label(t('analyticsUdhaarOutstanding'), 'rs'), money(data.udhaar_outstanding_paisa)],
          [label(t('analyticsStockAlerts')), int(data.low_stock.length)],
        ],
        empty: t('reportNoRows'),
      },
      topTable(t, 'top-today', `${t('analyticsTopProducts')} · ${t('analyticsToday')}`, today),
      topTable(t, 'top-week', `${t('analyticsTopProducts')} · ${t('analyticsLast7Days')}`, week),
      {
        id: 'low-stock',
        title: `${t('analyticsLowStock')} (≤ ${data.low_stock_threshold})`,
        columns: [{ label: t('catalogColProduct') }, { label: t('onHand'), numeric: true }],
        rows: data.low_stock.map((item) => [text(item.name), int(item.qty_on_hand)]),
        empty: t('analyticsLowStockEmpty'),
      },
      ...(insights ? insightTables(t, insights) : []),
    ],
    notes: [],
    fileBase: `dukaandesk-sales-${isoDay(now, tz)}`,
  };
}

function insightTables(t: T, ins: AnalyticsInsights): ReportTable[] {
  const till = ins.cash_till;
  return [
    {
      id: 'cash-till',
      title: t('analyticsCashInTill'),
      columns: [{ label: t('reportItem') }, { label: t('reportAmount'), numeric: true }],
      rows: [
        [label(t('analyticsTillCashSales'), 'rs'), money(till.cash_sales_paisa)],
        [label(t('analyticsTillUdhaarIn'), 'rs'), money(till.udhaar_received_paisa)],
        [label(t('analyticsTillExpenses'), 'rs'), money(-till.expenses_paisa)],
        [label(t('analyticsCashInTill'), 'rs'), money(till.expected_paisa)],
      ],
      empty: t('reportNoRows'),
    },
    {
      id: 'top-udhaar',
      title: t('analyticsTopUdhaar'),
      columns: [
        { label: t('partiesColCustomer') },
        { label: t('balance'), numeric: true, unit: 'rs' },
      ],
      rows: ins.top_udhaar.map((c) => [text(c.name), money(c.balance_paisa)]),
      empty: t('analyticsTopUdhaarEmpty'),
    },
    {
      id: 'slow-movers',
      title: t('analyticsSlowMovers'),
      columns: [
        { label: t('catalogColProduct') },
        { label: t('onHand'), numeric: true },
        { label: t('analyticsStockValue'), numeric: true, unit: 'rs' },
      ],
      rows: ins.slow_movers.items.map((m) => [
        text(m.name),
        int(m.qty_on_hand),
        moneyOr(m.stock_value_paisa, t('costUnknown')),
      ]),
      empty: t('analyticsSlowMoversEmpty'),
    },
  ];
}

function compareTables(t: T, cmp: ProfitCompare): ReportTable[] {
  return [
    {
      id: 'week-compare',
      title: t('analyticsWeekCompare'),
      columns: [
        { label: t('reportItem') },
        { label: t('analyticsThisWeek'), numeric: true },
        { label: t('analyticsLastWeek'), numeric: true },
      ],
      rows: [
        [
          label(t('analyticsSalesTotal'), 'rs'),
          money(cmp.this_week.sales_paisa),
          money(cmp.last_week.sales_paisa),
        ],
        [
          label(t('grossProfit'), 'rs'),
          money(cmp.this_week.gross_profit_paisa),
          money(cmp.last_week.gross_profit_paisa),
        ],
        [
          label(t('analyticsExpenses'), 'rs'),
          money(cmp.this_week.expenses_paisa),
          money(cmp.last_week.expenses_paisa),
        ],
        [
          label(t('leftAfterExpenses'), 'rs'),
          money(cmp.this_week.net_profit_paisa),
          money(cmp.last_week.net_profit_paisa),
        ],
      ],
      empty: t('reportNoRows'),
    },
    {
      id: 'top-profit',
      title: `${t('analyticsTopProfitItems')} · ${t('analyticsThisWeek')}`,
      columns: [
        { label: t('catalogColProduct') },
        { label: t('qty'), numeric: true },
        { label: t('lineProfit'), numeric: true, unit: 'rs' },
      ],
      rows: cmp.top_items.map((i) => [text(i.product_name), int(i.qty_pieces), money(i.profit_paisa)]),
      empty: t('analyticsProfitEmpty'),
    },
  ];
}

export function buildProfitReport(
  t: T,
  data: AnalyticsSummary,
  store: ReportStore | null,
  now = new Date(),
  compare: ProfitCompare | null = null,
): AnalyticsReport {
  const tz = data.timezone;
  const p = data.profit;
  const unknown = t('costUnknown');
  return {
    tab: 'profit',
    title: t('reportTitleProfit'),
    storeName: store?.name?.trim() || t('appName'),
    storeLine: storeLine(store),
    meta: baseMeta(t, data, `${t('analyticsToday')}: ${range(data.today, tz)}`, now),
    tables: [
      {
        id: 'profit',
        title: t('reportSummary'),
        columns: [{ label: t('reportItem') }, { label: t('reportAmount'), numeric: true }],
        rows: [
          [label(t('analyticsSalesTotal'), 'rs'), money(p.sales_paisa)],
          [label(t('cogsToday'), 'rs'), moneyOr(p.cogs_paisa, unknown)],
          [label(t('grossProfit'), 'rs'), moneyOr(p.gross_profit_paisa, unknown)],
          [label(t('analyticsExpenses'), 'rs'), money(p.expenses_paisa)],
          [label(t('leftAfterExpenses'), 'rs'), moneyOr(p.left_paisa, t('profitUnknown'))],
        ],
        empty: t('reportNoRows'),
      },
      {
        id: 'lines',
        title: t('reportItemsSold'),
        columns: [
          { label: t('catalogColProduct') },
          { label: t('qty'), numeric: true },
          { label: t('reportUnitCost'), numeric: true, unit: 'rs' },
          { label: t('reportUnitPrice'), numeric: true, unit: 'rs' },
          { label: t('reportLineTotal'), numeric: true, unit: 'rs' },
          { label: t('lineProfit'), numeric: true, unit: 'rs' },
          { label: t('markup'), numeric: true, unit: 'pct' },
        ],
        rows: p.lines.map((line) => [
          text(line.product_name),
          int(line.qty_pieces),
          moneyOr(line.unit_cost_paisa, unknown),
          money(line.unit_price_paisa),
          money(line.line_total_paisa),
          moneyOr(line.profit_paisa, unknown),
          line.markup_ratio == null
            ? { kind: 'unknown', label: unknown }
            : { kind: 'pct', value: line.markup_ratio * 100 },
        ]),
        empty: t('analyticsEmpty'),
      },
      ...(compare ? compareTables(t, compare) : []),
    ],
    notes: p.cost_unknown ? [t('profitUnknown')] : [],
    fileBase: `dukaandesk-profit-${isoDay(now, tz)}`,
  };
}

export function buildReport(
  tab: AnalyticsTab,
  t: T,
  data: AnalyticsSummary,
  store: ReportStore | null,
  extras: { insights?: AnalyticsInsights | null; compare?: ProfitCompare | null } = {},
): AnalyticsReport {
  const now = new Date();
  return tab === 'profit'
    ? buildProfitReport(t, data, store, now, extras.compare ?? null)
    : buildTodayReport(t, data, store, now, extras.insights ?? null);
}

/* ── Screen / print text ── */

export function formatCellForPrint(cell: ReportCell): string {
  switch (cell.kind) {
    case 'label':
    case 'text':
      return cell.value;
    case 'money':
      return formatRsShort(cell.paisa);
    case 'int':
      return String(cell.value);
    case 'pct':
      return `${cell.value.toFixed(1)}%`;
    case 'unknown':
      return cell.label;
  }
}

/* ── Excel (.xlsx) ── */

function withUnit(t: T, value: string, unit?: Unit): string {
  if (unit === 'rs') return `${value} ${t('reportRsSuffix')}`;
  if (unit === 'pct') return `${value} (%)`;
  return value;
}

type XCell = string | number | null;

function xlsxCell(t: T, cell: ReportCell): XCell {
  switch (cell.kind) {
    case 'label':
      return withUnit(t, cell.value, cell.unit);
    case 'text':
      return cell.value;
    case 'money':
      return Math.round(cell.paisa) / 100;
    case 'int':
      return cell.value;
    case 'pct':
      return Math.round(cell.value * 10) / 10;
    case 'unknown':
      return cell.label;
  }
}

/** One sheet laid out like the printed report: header lines, then each table with its columns. */
export function buildReportSheets(t: T, report: AnalyticsReport): Array<{ name: string; rows: XCell[][]; widths: number[] }> {
  const rows: XCell[][] = [];
  rows.push([report.title]);
  rows.push([report.storeName]);
  if (report.storeLine) rows.push([report.storeLine]);
  for (const m of report.meta) rows.push([m.label, m.value]);
  let maxCols = 2;
  for (const table of report.tables) {
    rows.push([]);
    rows.push([table.title]);
    rows.push(table.columns.map((c) => withUnit(t, c.label, c.unit)));
    maxCols = Math.max(maxCols, table.columns.length);
    if (table.rows.length === 0) rows.push([table.empty]);
    else for (const row of table.rows) rows.push(row.map((c) => xlsxCell(t, c)));
  }
  if (report.notes.length > 0) {
    rows.push([]);
    for (const note of report.notes) rows.push([note]);
  }
  const widths = Array.from({ length: maxCols }, (_, i) => (i === 0 ? 34 : 16));
  return [{ name: report.title.slice(0, 31) || 'Report', rows, widths }];
}
