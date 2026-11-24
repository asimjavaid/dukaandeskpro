import { allowsFraction } from '../shared/productUnits';

/** What a purchase line is bought in. Mirrors apps/api/src/catalog/measures.ts. */
export const MEASURES = ['kg', 'gram', 'litre', 'piece', 'packet', 'bottle', 'tin', 'can', 'dozen', 'carton', 'crate', 'box', 'bag', 'pack'] as const;
export type Measure = (typeof MEASURES)[number];

export const MEASURE_LABEL: Record<Measure, string> = {
  kg: 'Kg', gram: 'Gram', litre: 'Litre', piece: 'Piece', packet: 'Packet', bottle: 'Bottle', tin: 'Tin', can: 'Can',
  dozen: 'Dozen', carton: 'Carton', crate: 'Crate', box: 'Box', bag: 'Bag', pack: 'Pack',
};
/** Short word next to a number: "3 ctn", "500 g", "6 bottles". */
const SHORT: Partial<Record<Measure, [string, string]>> = {
  kg: ['kg', 'kg'], gram: ['g', 'g'], litre: ['L', 'L'], piece: ['pc', 'pcs'], dozen: ['dozen', 'dozen'], carton: ['ctn', 'ctn'],
};

export const CONTAINER_NAME: Partial<Record<Measure, string>> = { dozen: 'Dozen', carton: 'Carton', crate: 'Crate', box: 'Box', bag: 'Bag', pack: 'Pack' };
export const FIXED_UNITS: Partial<Record<Measure, number>> = { dozen: 12 };
const SINGLES: Measure[] = ['piece', 'packet', 'bottle', 'tin', 'can'];
const CONTAINERS: Measure[] = ['dozen', 'carton', 'crate', 'box', 'bag', 'pack'];

export const isMeasure = (u: unknown): u is Measure => (MEASURES as readonly string[]).includes(String(u ?? ''));
export const isContainer = (u: string | null | undefined): boolean => !!u && !!CONTAINER_NAME[u as Measure];

export function measureFromPackName(name: string | null | undefined): Measure | null {
  const n = String(name ?? '').trim().toLowerCase();
  return isMeasure(n) && isContainer(n) ? n : null;
}

/** Loose kg: kg / gram / bag. Litre: litre or containers. Whole items: singles or containers. */
export function measuresFor(p: { unit_label?: string | null; product_type?: string | null }): Measure[] {
  const u = String(p.unit_label ?? '').toLowerCase();
  if (p.product_type === 'bulk' || u === 'kg') return ['kg', 'gram', 'bag'];
  if (u === 'litre') return ['litre', ...CONTAINERS];
  if (allowsFraction(u)) return ['piece', ...CONTAINERS];
  return [...SINGLES, ...CONTAINERS];
}

/** Product's bought-by: stored, else the old carton / crate / piece, else its own unit. */
export function defaultMeasure(p: { unit_label?: string | null; product_type?: string | null; buy_measure?: string | null; buy_unit?: string | null }): Measure {
  const ok = measuresFor(p);
  if (isMeasure(p.buy_measure) && ok.includes(p.buy_measure)) return p.buy_measure;
  if (isMeasure(p.buy_unit) && ok.includes(p.buy_unit)) return p.buy_unit;
  const u = String(p.unit_label ?? '').toLowerCase();
  if (isMeasure(u) && ok.includes(u)) return u;
  return ok[0];
}

/** Measure of a saved line (older lines carry none). */
export function lineMeasure(l: { unit?: string | null; pack_name?: string | null; by_package?: number | null; unit_label?: string | null }): Measure {
  if (isMeasure(l.unit)) return l.unit;
  const fromPack = measureFromPackName(l.pack_name);
  if (fromPack) return fromPack;
  if (l.by_package === 1) return 'carton';
  const u = String(l.unit_label ?? '').toLowerCase();
  if (u === 'kg' || u === 'litre') return u;
  return 'piece';
}

export function measureWord(m: Measure, n: number): string {
  const s = SHORT[m];
  if (s) return n === 1 ? s[0] : s[1];
  const w = MEASURE_LABEL[m].toLowerCase();
  if (n === 1) return w;
  return w.endsWith('x') ? `${w}es` : `${w}s`;
}
