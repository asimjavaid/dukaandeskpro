/**
 * Quantities. Loose goods sold by weight/volume/length (kg, litre, meter, foot) take up to 3
 * decimals (0.25 kg, 1.5 litre); everything else stays a whole number.
 * Values are stored as plain numbers rounded to 3 decimals.
 */
export const FRACTION_UNITS = new Set(['kg', 'litre', 'meter', 'foot']);

export function allowsFraction(unitLabel: string | null | undefined): boolean {
  return FRACTION_UNITS.has(String(unitLabel ?? '').toLowerCase());
}

/** Round to 3 decimals (gram precision for kg). */
export function r3(n: number): number {
  return Math.round(Number(n) * 1000) / 1000;
}

const DEC = /^\d+(\.\d{1,3})?$/;
const WHOLE = /^\d+$/;

/**
 * Parse a quantity for a product unit. `allowZero` for counts.
 * Fraction units: > 0, up to 3 decimals. Others: whole numbers.
 */
export function parseQty(
  raw: unknown,
  unitLabel: string | null | undefined,
  opts: { allowZero?: boolean } = {},
): { ok: true; n: number } | { ok: false; error: 'invalid_qty' } {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { ok: false, error: 'invalid_qty' };
  const frac = allowsFraction(unitLabel);
  let n: number;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, error: 'invalid_qty' };
    n = frac ? r3(raw) : raw;
    if (!frac && !Number.isSafeInteger(n)) return { ok: false, error: 'invalid_qty' };
    if (frac && Math.abs(n - raw) > 1e-9) return { ok: false, error: 'invalid_qty' };
  } else {
    if (!(frac ? DEC : WHOLE).test(s)) return { ok: false, error: 'invalid_qty' };
    n = frac ? r3(Number(s)) : Number(s);
  }
  if (n < 0 || (!opts.allowZero && n === 0) || n > 1_000_000) {
    return { ok: false, error: 'invalid_qty' };
  }
  return { ok: true, n };
}

/** Money for qty × unit price, rounded to whole paisa. */
export function lineMoney(qty: number, unitPaisa: number): number {
  return Math.round(Number(qty) * Number(unitPaisa));
}
