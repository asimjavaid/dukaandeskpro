/**
 * Product discount overlay on the piece price.
 *
 * Storage (products):
 *   discount_kind      NULL | 'percent' | 'fixed'
 *   discount_value     percent → basis points (12.5% = 1250); fixed → paisa
 *   discount_start_at  UTC ISO text or NULL (inclusive)
 *   discount_end_at    UTC ISO text or NULL (exclusive)
 *
 * Active window: (start IS NULL OR now >= start) AND (end IS NULL OR now < end).
 * Store-local inputs without a zone are read as Asia/Karachi (UTC+05:00, no DST).
 */
import { parseNonNegativeRupees } from '../common/amount';

export type DiscountKind = 'percent' | 'fixed';
export type DiscountStatus = 'none' | 'active' | 'scheduled' | 'ended';

export const STORE_UTC_OFFSET = '+05:00';

export type DiscountColumns = {
  price_paisa: number;
  discount_kind: string | null;
  discount_value: number | null;
  discount_start_at: string | null;
  discount_end_at: string | null;
};

export type DiscountView = {
  discount_kind: DiscountKind | null;
  /** Percent off (e.g. 12.5) when kind = percent, else null. */
  discount_percent: number | null;
  /** Paisa off one unit when kind = fixed, else null. */
  discount_amount_paisa: number | null;
  discount_start_at: string | null;
  discount_end_at: string | null;
  discount_status: DiscountStatus;
  /** True when the discount applies right now. */
  sale_active: boolean;
  /** Price the till charges right now (piece price after an active discount). */
  effective_price_paisa: number;
};

export type StoredDiscount = {
  kind: DiscountKind | null;
  value: number | null;
  startAt: string | null;
  endAt: string | null;
};

export const NO_DISCOUNT: StoredDiscount = {
  kind: null,
  value: null,
  startAt: null,
  endAt: null,
};

function asKind(raw: unknown): DiscountKind | null {
  return raw === 'percent' || raw === 'fixed' ? raw : null;
}

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Paisa price after applying a discount (no time check). Never below 0. */
export function applyDiscount(
  pricePaisa: number,
  kind: DiscountKind | null,
  value: number | null,
): number {
  const price = Math.max(0, Math.round(Number(pricePaisa) || 0));
  const v = Math.max(0, Math.round(Number(value) || 0));
  if (kind === 'percent') {
    const off = Math.round((price * Math.min(v, 10000)) / 10000);
    return Math.max(0, price - off);
  }
  if (kind === 'fixed') return Math.max(0, price - v);
  return price;
}

export function discountStatus(
  row: Pick<DiscountColumns, 'discount_kind' | 'discount_start_at' | 'discount_end_at'>,
  now: Date = new Date(),
): DiscountStatus {
  if (!asKind(row.discount_kind)) return 'none';
  const t = now.getTime();
  const start = ms(row.discount_start_at);
  const end = ms(row.discount_end_at);
  if (start != null && t < start) return 'scheduled';
  if (end != null && t >= end) return 'ended';
  return 'active';
}

/** Price the till charges at `now`. */
export function effectivePricePaisa(
  row: DiscountColumns,
  now: Date = new Date(),
): number {
  if (discountStatus(row, now) !== 'active') {
    return Math.max(0, Math.round(Number(row.price_paisa) || 0));
  }
  return applyDiscount(row.price_paisa, asKind(row.discount_kind), row.discount_value);
}

export function discountView(row: DiscountColumns, now: Date = new Date()): DiscountView {
  const kind = asKind(row.discount_kind);
  const value = kind ? Math.max(0, Math.round(Number(row.discount_value) || 0)) : null;
  const status = discountStatus(row, now);
  return {
    discount_kind: kind,
    discount_percent: kind === 'percent' && value != null ? value / 100 : null,
    discount_amount_paisa: kind === 'fixed' ? value : null,
    discount_start_at: kind ? row.discount_start_at : null,
    discount_end_at: kind ? row.discount_end_at : null,
    discount_status: status,
    sale_active: status === 'active',
    effective_price_paisa: effectivePricePaisa(row, now),
  };
}

const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i;
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts an ISO timestamp with a zone, or a store-local date-time / date
 * (read as Asia/Karachi). Returns UTC ISO, null for blank, or an error.
 */
export function parseDiscountDate(
  raw: unknown,
): { ok: true; iso: string | null } | { ok: false; error: 'invalid_discount_date' } {
  if (raw == null) return { ok: true, iso: null };
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_discount_date' };
  const s = raw.trim();
  if (s === '') return { ok: true, iso: null };
  let candidate: string | null = null;
  if (ISO_WITH_ZONE.test(s)) {
    candidate = s.replace(' ', 'T');
  } else {
    const m = LOCAL_DATE_TIME.exec(s);
    if (m) candidate = `${m[1]}T${m[2]}${m[3] ?? ':00'}${STORE_UTC_OFFSET}`;
    else if (LOCAL_DATE.test(s)) candidate = `${s}T00:00:00${STORE_UTC_OFFSET}`;
  }
  if (!candidate) return { ok: false, error: 'invalid_discount_date' };
  const t = Date.parse(candidate);
  if (Number.isNaN(t)) return { ok: false, error: 'invalid_discount_date' };
  const iso = new Date(t).toISOString();
  // Reject rollovers like 2026-02-31 that Date quietly moves to March.
  const day = candidate.slice(0, 10);
  const back = new Date(t + offsetMs(candidate)).toISOString().slice(0, 10);
  if (back !== day) return { ok: false, error: 'invalid_discount_date' };
  return { ok: true, iso };
}

/** Offset in ms encoded at the end of an ISO string (Z → 0). */
function offsetMs(iso: string): number {
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

const PERCENT = /^\d+(\.\d{1,2})?$/;

export type DiscountInput = {
  kind?: string | null;
  /** Percent off, 0–100, up to 2 decimals. Used when kind = percent. */
  percent?: number | string | null;
  /** Rupees off one unit. Used when kind = fixed (amountPaisa wins). */
  amountRs?: number | string | null;
  amountPaisa?: number | string | null;
  startAt?: string | null;
  endAt?: string | null;
};

export type DiscountError =
  | 'invalid_discount_kind'
  | 'invalid_discount_percent'
  | 'invalid_discount_amount'
  | 'discount_exceeds_price'
  | 'invalid_discount_date'
  | 'discount_end_before_start';

/**
 * Validate a discount body. `null`, `{}` without kind, or kind 'none' clears it.
 * Fixed amount must not exceed the piece price it will be saved with.
 */
export function parseDiscountInput(
  input: DiscountInput | null | undefined,
  pricePaisa: number,
): { ok: true; discount: StoredDiscount } | { ok: false; error: DiscountError } {
  if (input == null || typeof input !== 'object') return { ok: true, discount: NO_DISCOUNT };
  const kindRaw = input.kind == null ? '' : String(input.kind).trim().toLowerCase();
  if (kindRaw === '' || kindRaw === 'none') return { ok: true, discount: NO_DISCOUNT };
  if (kindRaw !== 'percent' && kindRaw !== 'fixed') {
    return { ok: false, error: 'invalid_discount_kind' };
  }

  let value: number;
  if (kindRaw === 'percent') {
    const raw = input.percent;
    let pct: number;
    if (typeof raw === 'number') {
      pct = raw;
    } else if (typeof raw === 'string' && PERCENT.test(raw.trim())) {
      pct = Number(raw.trim());
    } else {
      return { ok: false, error: 'invalid_discount_percent' };
    }
    const bp = Math.round(pct * 100);
    if (!Number.isFinite(pct) || bp < 0 || bp > 10000) {
      return { ok: false, error: 'invalid_discount_percent' };
    }
    value = bp;
  } else {
    let paisa: number | null = null;
    if (input.amountPaisa != null && input.amountPaisa !== '') {
      const p = typeof input.amountPaisa === 'string' ? input.amountPaisa.trim() : input.amountPaisa;
      const n = typeof p === 'number' ? p : /^\d+$/.test(p) ? Number(p) : NaN;
      if (!Number.isSafeInteger(n) || n < 0) {
        return { ok: false, error: 'invalid_discount_amount' };
      }
      paisa = n;
    } else {
      const r = parseNonNegativeRupees(input.amountRs, 'missing');
      if (!r.ok) return { ok: false, error: 'invalid_discount_amount' };
      paisa = r.paisa;
    }
    if (paisa > Math.max(0, pricePaisa)) {
      return { ok: false, error: 'discount_exceeds_price' };
    }
    value = paisa;
  }

  const start = parseDiscountDate(input.startAt);
  if (start.ok === false) return { ok: false, error: start.error };
  const end = parseDiscountDate(input.endAt);
  if (end.ok === false) return { ok: false, error: end.error };
  if (start.iso && end.iso && Date.parse(end.iso) <= Date.parse(start.iso)) {
    return { ok: false, error: 'discount_end_before_start' };
  }

  return {
    ok: true,
    discount: { kind: kindRaw, value, startAt: start.iso, endAt: end.iso },
  };
}
