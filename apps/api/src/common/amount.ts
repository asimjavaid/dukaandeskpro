/**
 * Shared money and quantity checks.
 * Money is rupees (or integer paisa). Empty is 0 only when the caller allows 0.
 * Quantities must be positive whole numbers. Pieces of 0 are rejected.
 * Junk (letters, minus, commas, scientific notation) is invalid.
 */

export type AmountError = 'invalid_amount' | 'amount_required';

const RUPEES = /^\d+(\.\d+)?$/;
const WHOLE = /^\d+$/;

export function parseNonNegativeRupees(
  value: unknown,
  blank: 'zero' | 'missing',
): { ok: true; paisa: number } | { ok: false; error: AmountError } {
  if (value == null) {
    return blank === 'zero'
      ? { ok: true, paisa: 0 }
      : { ok: false, error: 'amount_required' };
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') {
      return blank === 'zero'
        ? { ok: true, paisa: 0 }
        : { ok: false, error: 'amount_required' };
    }
    if (!RUPEES.test(s)) return { ok: false, error: 'invalid_amount' };
    return { ok: true, paisa: Math.round(Number(s) * 100) };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, error: 'invalid_amount' };
    }
    return { ok: true, paisa: Math.round(value * 100) };
  }
  return { ok: false, error: 'invalid_amount' };
}

export function parseNonNegativePaisa(
  value: unknown,
): { ok: true; paisa: number } | { ok: false; error: 'invalid_amount' } {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, error: 'invalid_amount' };
    }
    return { ok: true, paisa: value };
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!WHOLE.test(s)) return { ok: false, error: 'invalid_amount' };
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < 0) {
      return { ok: false, error: 'invalid_amount' };
    }
    return { ok: true, paisa: n };
  }
  return { ok: false, error: 'invalid_amount' };
}

/** Paisa wins when present. Blank rupees follow `blank` only if paisa is absent. */
export function parseMoneyPair(
  paisa: unknown,
  rupees: unknown,
  blank: 'zero' | 'missing',
): { ok: true; paisa: number } | { ok: false; error: AmountError } {
  if (paisa != null && paisa !== '') return parseNonNegativePaisa(paisa);
  if (paisa === '') {
    return blank === 'zero'
      ? { ok: true, paisa: 0 }
      : { ok: false, error: 'amount_required' };
  }
  return parseNonNegativeRupees(rupees, blank);
}

export function parsePositiveInt(
  value: unknown,
): { ok: true; n: number } | { ok: false; error: 'invalid_qty' } {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      return { ok: false, error: 'invalid_qty' };
    }
    return { ok: true, n: value };
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!WHOLE.test(s)) return { ok: false, error: 'invalid_qty' };
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n <= 0) {
      return { ok: false, error: 'invalid_qty' };
    }
    return { ok: true, n: n };
  }
  return { ok: false, error: 'invalid_qty' };
}

/** Whole number ≥ 0 (stock count counted qty). Rejects blanks, decimals, negatives. */
export function parseNonNegativeInt(
  value: unknown,
): { ok: true; n: number } | { ok: false; error: 'invalid_qty' } {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, error: 'invalid_qty' };
    }
    return { ok: true, n: value };
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!WHOLE.test(s)) return { ok: false, error: 'invalid_qty' };
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < 0) {
      return { ok: false, error: 'invalid_qty' };
    }
    return { ok: true, n };
  }
  return { ok: false, error: 'invalid_qty' };
}
