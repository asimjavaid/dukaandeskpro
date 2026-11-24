/** Scannable bars for a saved product barcode. Does not mint new codes. */

const EAN_L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];

const EAN_G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];

const EAN_R = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
];

/** Parity of the left six digits, chosen by the leading digit. */
const EAN_PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

/** Code 128 symbol patterns, values 0–106. 106 is the stop symbol. */
const CODE128 = [
  '11011001100',
  '11001101100',
  '11001100110',
  '10010011000',
  '10010001100',
  '10001001100',
  '10011001000',
  '10011000100',
  '10001100100',
  '11001001000',
  '11001000100',
  '11000100100',
  '10110011100',
  '10011011100',
  '10011001110',
  '10111001100',
  '10011101100',
  '10011100110',
  '11001110010',
  '11001011100',
  '11001001110',
  '11011100100',
  '11001110100',
  '11101101110',
  '11101001100',
  '11100101100',
  '11100100110',
  '11101100100',
  '11100110100',
  '11100110010',
  '11011011000',
  '11011000110',
  '11000110110',
  '10100011000',
  '10001011000',
  '10001000110',
  '10110001000',
  '10001101000',
  '10001100010',
  '11010001000',
  '11000101000',
  '11000100010',
  '10110111000',
  '10110001110',
  '10001101110',
  '10111011000',
  '10111000110',
  '10001110110',
  '11101110110',
  '11010001110',
  '11000101110',
  '11011101000',
  '11011100010',
  '11011101110',
  '11101011000',
  '11101000110',
  '11100010110',
  '11101101000',
  '11101100010',
  '11100011010',
  '11101111010',
  '11001000010',
  '11110001010',
  '10100110000',
  '10100001100',
  '10010110000',
  '10010000110',
  '10000101100',
  '10000100110',
  '10110010000',
  '10110000100',
  '10011010000',
  '10011000010',
  '10000110100',
  '10000110010',
  '11000010010',
  '11001010000',
  '11110111010',
  '11000010100',
  '10001111010',
  '10100111100',
  '10010111100',
  '10010011110',
  '10111100100',
  '10011110100',
  '10011110010',
  '11110100100',
  '11110010100',
  '11110010010',
  '11011011110',
  '11011110110',
  '11110110110',
  '10101111000',
  '10100011110',
  '10001011110',
  '10111101000',
  '10111100010',
  '11110101000',
  '11110100010',
  '10111011110',
  '10111101110',
  '11101011110',
  '11110101110',
  '11010000100',
  '11010010000',
  '11010011100',
  '1100011101011'
];

const QUIET = '0000000000';

function ean13Check(d12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = d12.charCodeAt(i) - 48;
    sum += n * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

function ean13Bits(code: string): string | null {
  if (!/^\d{13}$/.test(code)) return null;
  if (ean13Check(code.slice(0, 12)) !== code.charCodeAt(12) - 48) return null;
  const parity = EAN_PARITY[code.charCodeAt(0) - 48];
  let bits = QUIET + '101';
  for (let i = 0; i < 6; i++) {
    const d = code.charCodeAt(i + 1) - 48;
    bits += parity[i] === 'L' ? EAN_L[d] : EAN_G[d];
  }
  bits += '01010';
  for (let i = 0; i < 6; i++) {
    bits += EAN_R[code.charCodeAt(i + 7) - 48];
  }
  bits += '101' + QUIET;
  return bits;
}

/** Code 128 set B. Covers the printable ASCII a saved barcode may hold. */
function code128Bits(text: string): string | null {
  if (!text || text.length > 80) return null;
  const values: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 32 || c > 127) return null;
    values.push(c - 32);
  }
  const startB = 104;
  let sum = startB;
  for (let i = 0; i < values.length; i++) sum += values[i] * (i + 1);
  const check = sum % 103;
  const symbols = [startB, ...values, check, 106];
  let bits = QUIET;
  for (const symbol of symbols) bits += CODE128[symbol];
  return bits + QUIET;
}

export type BarcodeArt = { bits: string; text: string };

/**
 * Draw the saved code. Valid EAN-13 (or 12-digit UPC-A) uses EAN-13.
 * Anything else printable uses Code 128. Returns null if it cannot be drawn.
 */
export function encodeBarcode(raw: string): BarcodeArt | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\d{13}$/.test(text)) {
    const bits = ean13Bits(text);
    if (bits) return { bits, text };
  }
  if (/^\d{12}$/.test(text)) {
    const withZero = `0${text}`;
    const bits = ean13Bits(withZero);
    if (bits) return { bits, text };
  }
  const bits = code128Bits(text);
  if (!bits) return null;
  return { bits, text };
}
