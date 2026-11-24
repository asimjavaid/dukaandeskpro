import { fmtDateTime } from './dates';
/**
 * Client twin of apps/api/src/catalog/discount.ts.
 * The API is the authority at the till; this keeps screens honest between loads.
 *
 * Window: active when (start empty or now >= start) and (end empty or now < end).
 * Start is inclusive, end is exclusive. Times are shown in store time (Asia/Karachi).
 */

export type DiscountKind = 'percent' | 'fixed';
export type DiscountStatus = 'none' | 'active' | 'scheduled' | 'ended';

export const STORE_TIME_ZONE = 'Asia/Karachi';
const STORE_OFFSET = '+05:00';

/** Discount fields as the catalog API returns them. All optional for older APIs. */
export type ProductDiscountFields = {
  price_paisa: number;
  discount_kind?: DiscountKind | null;
  discount_percent?: number | null;
  discount_amount_paisa?: number | null;
  discount_start_at?: string | null;
  discount_end_at?: string | null;
  effective_price_paisa?: number;
};

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Piece price after a discount, ignoring the window. Never below 0. */
export function applyDiscount(
  pricePaisa: number,
  kind: DiscountKind | null | undefined,
  percent: number | null | undefined,
  amountPaisa: number | null | undefined,
): number {
  const price = Math.max(0, Math.round(pricePaisa || 0));
  if (kind === 'percent') {
    const bp = Math.min(10000, Math.max(0, Math.round((percent ?? 0) * 100)));
    return Math.max(0, price - Math.round((price * bp) / 10000));
  }
  if (kind === 'fixed') {
    return Math.max(0, price - Math.max(0, Math.round(amountPaisa ?? 0)));
  }
  return price;
}

export function windowStatus(
  kind: DiscountKind | null | undefined,
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  now: number,
): DiscountStatus {
  if (kind !== 'percent' && kind !== 'fixed') return 'none';
  const start = ms(startIso);
  const end = ms(endIso);
  if (start != null && now < start) return 'scheduled';
  if (end != null && now >= end) return 'ended';
  return 'active';
}

export function discountStatusOf(p: ProductDiscountFields, now = Date.now()): DiscountStatus {
  return windowStatus(p.discount_kind, p.discount_start_at, p.discount_end_at, now);
}

/** Discounted price (what the till charges while the sale is on). */
export function salePricePaisa(p: ProductDiscountFields): number {
  return applyDiscount(
    p.price_paisa,
    p.discount_kind,
    p.discount_percent,
    p.discount_amount_paisa,
  );
}

/** Price the till charges at `now`. Falls back to the API value for older payloads. */
export function currentPricePaisa(p: ProductDiscountFields, now = Date.now()): number {
  if (p.discount_kind === undefined && typeof p.effective_price_paisa === 'number') {
    return p.effective_price_paisa;
  }
  return discountStatusOf(p, now) === 'active'
    ? salePricePaisa(p)
    : Math.max(0, Math.round(p.price_paisa || 0));
}

/** "12 Oct 2026, 9:00 pm" in store time. */
export function formatStoreDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (locale !== 'ur') return fmtDateTime(d);
  try {
    return new Intl.DateTimeFormat('ur-PK', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: STORE_TIME_ZONE,
      numberingSystem: 'latn',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** UTC ISO → "YYYY-MM-DDTHH:mm" store wall time for <input type="datetime-local">. */
export function isoToStoreInput(iso: string | null | undefined): string {
  const t = ms(iso);
  if (t == null) return '';
  // Karachi is a fixed UTC+05:00 with no DST.
  return new Date(t + 5 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:mm" store wall time → epoch ms. Empty → null. Bad → NaN. */
export function storeInputToMs(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return Number.NaN;
  const withSeconds = s.length === 16 ? `${s}:00` : s;
  return Date.parse(`${withSeconds}${STORE_OFFSET}`);
}

const PERCENT = /^\d+(\.\d{1,2})?$/;

/** 0–100 with up to 2 decimals. Junk, negatives, and > 100 are rejected. */
export function parsePercent(raw: string): number | null {
  const s = raw.trim();
  if (!PERCENT.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}
