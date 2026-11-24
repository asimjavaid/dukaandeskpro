import { Fragment, type ReactNode } from 'react';
import { formatRsShort } from '../../lib/money';

/** S-SC4 API shapes (apps/api/src/stock/stock-count.service.ts). */
export type ReasonCode = 'damaged' | 'expired' | 'stolen_lost' | 'admin_error';

export const REASON_CODES: readonly ReasonCode[] = [
  'damaged',
  'expired',
  'stolen_lost',
  'admin_error',
] as const;

export type CountSession = {
  id: string;
  status: 'draft' | 'posted' | 'cancelled';
  source: 'full_screen' | 'catalog_quick';
  started_at: string;
  posted_at: string | null;
  cancelled_at: string | null;
  items_total_at_post: number | null;
};

export type CountLine = {
  id: string;
  product_id: string;
  system_qty_snapshot: number;
  counted_qty: number | null;
  reason_code: ReasonCode | null;
  unit_cost_paisa_snapshot: number | null;
};

export type CountAggregates = {
  items_counted: number;
  items_matching: number;
  items_missing: number;
  items_extra: number;
  abs_delta_units: number;
  net_delta_units: number;
  value_delta_paisa: number | null;
  loss_paisa: number | null;
  gain_paisa: number | null;
  items_uncosted: number;
};

export type HistoryItem = {
  session: CountSession;
  count_type: 'Full' | 'Quick';
  aggregates: CountAggregates;
};

export type HistoryResponse = {
  ok: boolean;
  items: HistoryItem[];
  lastFullCount: {
    session: CountSession;
    items_counted: number;
    posted_at: string;
  } | null;
  monthlyShrinkage: {
    loss_paisa: number;
    uncosted_loss_items: number;
    month_start_pkt: string;
  };
};

export type WorksheetItem = {
  product_id: string;
  name: string;
  name_ur: string | null;
  barcode: string | null;
  unit_label?: string;
  qty_on_hand: number;
  line_id: string | null;
  system_qty_snapshot: number | null;
  counted_qty: number | null;
  reason_code: ReasonCode | null;
  unit_cost_paisa_snapshot: number | null;
  variance: number | null;
  counted: boolean;
};

export type Progress = { counted: number; total: number };

export type WorksheetResponse = {
  ok: boolean;
  error?: string;
  session?: CountSession;
  items?: WorksheetItem[];
  page?: number;
  pageSize?: number;
  total?: number;
  progress?: Progress;
};

export type ReportLine = CountLine & {
  product_name: string;
  product_name_ur: string | null;
  barcode: string | null;
  variance: number | null;
  qty_on_hand: number;
  value_delta_paisa: number | null;
};

export type Adjustment = {
  id: string;
  product_id: string;
  line_id: string | null;
  delta_pieces: number;
  qty_before: number;
  qty_after: number;
  reason_code: ReasonCode | null;
  unit_cost_paisa: number | null;
};

export type ReportResponse = {
  ok: boolean;
  error?: string;
  session?: CountSession;
  lines?: ReportLine[];
  adjustments?: Adjustment[];
  aggregates?: CountAggregates;
  progress?: Progress;
};

/** Where Execution should land (Re-count Item from Review). */
export type ExecutionFocus = {
  productId: string;
  query: string;
};

/** Count ≥ 0 (up to 3 decimals for loose kg / litre), or null when blank/invalid. */
export function parseCounted(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return null;
  if (!/^\d+(\.\d{0,3})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 1000) / 1000;
  if (!Number.isFinite(n) || n < 0 || n > 1e6) return null;
  return n;
}

/** SQLite `datetime('now')` (UTC, no zone) or ISO → Date. */
export function parseDbTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date + time in Asia/Karachi, Western digits. */
export function formatPkt(raw: string | null | undefined, locale: string): string {
  const d = parseDbTime(raw);
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Karachi',
      numberingSystem: 'latn',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function pktDayNumber(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const [y, m, day] = parts.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, day) / 86400000);
}

/** Whole PKT calendar days between `raw` and now (0 = today). */
export function daysAgoPkt(raw: string | null | undefined, now = new Date()): number | null {
  const d = parseDbTime(raw);
  if (!d) return null;
  return Math.max(0, pktDayNumber(now) - pktDayNumber(d));
}

/** Rs from paisa; `signed` adds + / − (true minus sign). */
export function formatRs(paisa: number, signed = false): string {
  const abs = formatRsShort(Math.abs(paisa));
  if (!signed) return paisa < 0 ? `−${abs}` : abs;
  if (paisa > 0) return `+${abs}`;
  if (paisa < 0) return `−${abs}`;
  return abs;
}

export function formatSigned(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}

export function diffClass(n: number | null): string {
  if (n == null || n === 0) return 'stock-count-var--muted';
  return n < 0 ? 'stock-count-var--warn' : 'stock-count-var--teal';
}

/**
 * Fill `{key}` slots with nodes so numbers can stay in `ltr-isolate` spans
 * inside EN or UR sentences.
 */
export function fillNodes(template: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/(\{[a-zA-Z]+\})/);
  return parts.map((part, i) => {
    const m = /^\{([a-zA-Z]+)\}$/.exec(part);
    if (m && m[1] in vars) return <Fragment key={i}>{vars[m[1]]}</Fragment>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Number in an LTR island. */
export function Num({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={['ltr-isolate', className].filter(Boolean).join(' ')}>{children}</span>;
}

/** Date/time: isolated but not forced LTR (Urdu month names stay readable). */
export function DateText({ children }: { children: ReactNode }) {
  return <bdi className="stock-count-date">{children}</bdi>;
}

/** First visible letter of a product name (photos deferred, D29-n). */
export function ProductAvatar({ name }: { name: string }) {
  const letter = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?';
  return (
    <span className="stock-count-avatar" aria-hidden="true">
      {letter}
    </span>
  );
}

/** Product cell: avatar + name (dir=auto) + barcode below. */
export function ProductCell({
  name,
  nameUr,
  barcode,
  barcodeLabel,
  showUr,
}: {
  name: string;
  nameUr?: string | null;
  barcode?: string | null;
  barcodeLabel: string;
  showUr?: boolean;
}) {
  void showUr;
  void nameUr;
  const shown = name;
  return (
    <div className="stock-count-product">
      <ProductAvatar name={name} />
      <div className="stock-count-product__text">
        <span className="catalog-table__name" dir="auto">
          {shown}
        </span>
        {barcode ? (
          <span className="catalog-table__barcode ltr-isolate">
            <span className="visually-hidden">{barcodeLabel}: </span>
            {barcode}
          </span>
        ) : null}
      </div>
    </div>
  );
}
