import type { MessageKey } from '../../i18n/dictionary';

/** Measure label. kg, litre, meter, foot sell in fractions (3 decimals). */
export const PRODUCT_UNITS = [
  'piece',
  'dozen',
  'pair',
  'packet',
  'box',
  'carton',
  'bottle',
  'can',
  'jar',
  'tin',
  'tube',
  'bar',
  'sachet',
  'strip',
  'tray',
  'roll',
  'bundle',
  'bag',
  'kg',
  'gram',
  'litre',
  'ml',
  'meter',
  'foot',
] as const;

export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** Weight / volume / length units: sold in fractions. */
const FRACTION_UNITS = new Set<string>(['kg', 'litre', 'meter', 'foot']);

const UNIT_KEY: Record<ProductUnit, MessageKey> = {
  piece: 'unitPiece',
  dozen: 'unitDozen',
  pair: 'unitPair',
  packet: 'unitPacket',
  box: 'unitBox',
  carton: 'unitCarton',
  bottle: 'unitBottle',
  can: 'unitCan',
  jar: 'unitJar',
  tin: 'unitTin',
  tube: 'unitTube',
  bar: 'unitBar',
  sachet: 'unitSachet',
  strip: 'unitStrip',
  tray: 'unitTray',
  roll: 'unitRoll',
  bundle: 'unitBundle',
  bag: 'unitBag',
  kg: 'unitKg',
  gram: 'unitGram',
  litre: 'unitLitre',
  ml: 'unitMl',
  meter: 'unitMeter',
  foot: 'unitFoot',
};

export function productUnit(raw: string | null | undefined): ProductUnit {
  const value = (raw ?? '').trim().toLowerCase();
  if ((PRODUCT_UNITS as readonly string[]).includes(value)) {
    return value as ProductUnit;
  }
  return 'piece';
}

export function productUnitKey(raw: string | null | undefined): MessageKey {
  return UNIT_KEY[productUnit(raw)];
}

/** Units sold by weight/volume: quantities may carry up to 3 decimals. */
export function allowsFraction(raw: string | null | undefined): boolean {
  return FRACTION_UNITS.has(productUnit(raw));
}

/** Round to 3 decimals (grams / ml precision). */
export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** "2", "0.25", "1.5" — no trailing zeros. */
export function formatQty(n: number): string {
  const v = r3(Number(n) || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** Parse a typed quantity for this unit; null when invalid. */
export function parseQtyInput(raw: string, unitLabel: string | null | undefined): number | null {
  const s = raw.trim();
  if (!s) return null;
  const frac = allowsFraction(unitLabel);
  if (!(frac ? /^\d*(\.\d{0,3})?$/ : /^\d+$/).test(s)) return null;
  const n = r3(Number(s));
  if (!Number.isFinite(n) || n <= 0 || n > 1e6) return null;
  return n;
}

/** Quick-weight buttons for loose items: [qty, label]. */
export function quickWeights(raw: string | null | undefined): Array<[number, string]> {
  const u = productUnit(raw);
  if (u === 'kg') return [[0.25, '250 g'], [0.5, '½ kg'], [1, '1 kg']];
  if (u === 'litre') return [[0.25, '250 ml'], [0.5, '½ L'], [1, '1 L']];
  return [];
}
