/** Client twin of the API amount checks. Inputs are text fields. */

const RUPEES = /^\d+(\.\d+)?$/;
const WHOLE = /^\d+$/;

/** Empty is 0. Junk and negatives are rejected. */
export function parseMoneyRs(raw: string): number | null {
  const s = raw.trim();
  if (s === '') return 0;
  if (!RUPEES.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Whole number greater than zero. 0, blanks, and decimals are rejected. */
export function parsePieces(raw: string): number | null {
  const s = raw.trim();
  if (!WHOLE.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/** Urdu/Persian (۰-۹) and Arabic-Indic (٠-٩) digits → ASCII so Urdu keyboards still work. */
function asciiDigits(raw: string): string {
  return raw
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));
}

/**
 * Typing filter for money fields: digits and one optional "." only.
 * Drops "-", "+", "e", letters, spaces, commas. Keeps at most `maxDecimals` digits after ".".
 * A leading "." becomes "0.". The result is still checked by parseMoneyRs on save.
 */
export function sanitizeMoneyInput(raw: string, maxDecimals = 2): string {
  const s = asciiDigits(raw).replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot === -1 || maxDecimals <= 0) return s.replace(/\./g, '');
  const whole = s.slice(0, dot);
  const frac = s.slice(dot + 1).replace(/\./g, '').slice(0, maxDecimals);
  return `${whole === '' ? '0' : whole}.${frac}`;
}

/** Typing filter for whole-number fields (pieces, cartons): digits only. */
export function sanitizeWholeInput(raw: string): string {
  return asciiDigits(raw).replace(/\D/g, '');
}
