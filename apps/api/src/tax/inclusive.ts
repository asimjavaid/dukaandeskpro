/**
 * Tax V1 (D30 LOCK) — tax-inclusive extraction from the shelf/MRP price.
 *
 *   Tax Base   = Selling Price / (1 + rate)   (half-up to the paisa)
 *   Tax Amount = Selling Price − Tax Base
 *
 * Extracted per line on the line total (qty × discounted unit price), so the
 * customer total never changes. Integer paisa + basis points only (17% = 1700).
 */

export const MAX_TAX_RATE_BP = 10000;

/** Clamp/sanitise a stored or posted rate in basis points (0..10000). */
export function normalizeRateBp(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_TAX_RATE_BP, n);
}

/**
 * Split one line total into base + tax. Pure integer math:
 * base = floor((2·L·10000 + (10000 + r)) / (2·(10000 + r)))  — half-up of L·10000/(10000+r).
 */
export function extractInclusive(
  lineTotalPaisa: number,
  rateBp: number,
): { basePaisa: number; taxPaisa: number } {
  const L = Math.max(0, Math.round(Number(lineTotalPaisa) || 0));
  const r = normalizeRateBp(rateBp);
  if (L === 0 || r === 0) return { basePaisa: L, taxPaisa: 0 };
  const denom = 10000 + r;
  const basePaisa = Math.floor((2 * L * 10000 + denom) / (2 * denom));
  return { basePaisa, taxPaisa: L - basePaisa };
}

/** Percent text for display: 1700 → "17", 1750 → "17.5", 1725 → "17.25". */
export function rateBpToPercentText(rateBp: number): string {
  const r = normalizeRateBp(rateBp);
  return String(Number((r / 100).toFixed(2)));
}

/**
 * Parse an Owner-entered percent (e.g. "17", "17.5", 18) → basis points.
 * Returns null when not a finite number in 0..100 with ≤ 2 decimals.
 */
export function percentToRateBp(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(/%$/, '').trim();
  if (!text || !/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const bp = Math.round(Number(text) * 100);
  if (!Number.isFinite(bp) || bp < 0 || bp > MAX_TAX_RATE_BP) return null;
  return bp;
}

/**
 * D31 — period tax from sales base: round_half_up(base × rate_bp / 10000).
 * Integer-only half-up (0.5 → up).
 */
export function taxFromSalesBase(salesBasePaisa: number, rateBp: number): number {
  const base = Math.max(0, Math.round(Number(salesBasePaisa) || 0));
  const r = normalizeRateBp(rateBp);
  if (base === 0 || r === 0) return 0;
  return Math.floor((2 * base * r + 10000) / 20000);
}
