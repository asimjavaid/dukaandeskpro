/** GS1 EAN-13 check digit for the first 12 digits (left to right, weights 1,3). */
export function ean13CheckDigit(d12: string): number {
  if (!/^\d{12}$/.test(d12)) {
    throw new Error('ean13_body');
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = d12.charCodeAt(i) - 48;
    sum += n * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * In-store EAN-13: prefix 20 (GS1 range 20–29), 10-digit monotonic counter, check digit.
 * Example counter 1 → 2000000000015.
 */
export function inStoreEan13(counter: number): string {
  if (!Number.isInteger(counter) || counter < 0 || counter > 9_999_999_999) {
    throw new Error('ean13_counter');
  }
  const body = `20${String(counter).padStart(10, '0')}`;
  return `${body}${ean13CheckDigit(body)}`;
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === code.charCodeAt(12) - 48;
}

const MAX_BARCODE_LEN = 64;

/** Trim ends. Empty means "generate". Control characters and over-long codes are invalid. */
export function normalizeSuppliedBarcode(
  raw: string,
):
  | { ok: true; value: string | null }
  | { ok: false; error: 'invalid_barcode' } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > MAX_BARCODE_LEN) {
    return { ok: false, error: 'invalid_barcode' };
  }
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) {
      return { ok: false, error: 'invalid_barcode' };
    }
  }
  return { ok: true, value: trimmed };
}
