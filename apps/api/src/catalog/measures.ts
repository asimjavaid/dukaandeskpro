import type BetterSqlite3 from 'better-sqlite3';
import { allowsFraction } from '../common/qty';

/** What a line is bought in. Containers hold "pcs per" (kg per bag for loose); singles add their count. */
export const MEASURES = ['kg', 'gram', 'litre', 'piece', 'packet', 'bottle', 'tin', 'can', 'dozen', 'carton', 'crate', 'box', 'bag', 'pack'] as const;
export type Measure = (typeof MEASURES)[number];

export const CONTAINER_NAME: Partial<Record<Measure, string>> = { dozen: 'Dozen', carton: 'Carton', crate: 'Crate', box: 'Box', bag: 'Bag', pack: 'Pack' };
export const FIXED_UNITS: Partial<Record<Measure, number>> = { dozen: 12 };
const SINGLES: Measure[] = ['piece', 'packet', 'bottle', 'tin', 'can'];
const CONTAINERS: Measure[] = ['dozen', 'carton', 'crate', 'box', 'bag', 'pack'];

export const isMeasure = (u: unknown): u is Measure => (MEASURES as readonly string[]).includes(String(u ?? ''));
export const isContainer = (u: string | null | undefined) => !!u && !!CONTAINER_NAME[u as Measure];

/** "Carton" pack name → carton; anything else unknown. */
export function measureFromPackName(name: string | null | undefined): Measure | null {
  const n = String(name ?? '').trim().toLowerCase();
  return isMeasure(n) && isContainer(n) ? n : null;
}

/** Measures that make sense for a product: loose kg items buy by kg / gram / bag; litre items by litre or containers. */
export function measuresFor(p: { unit_label?: string | null; product_type?: string | null }): Measure[] {
  const u = String(p.unit_label ?? '').toLowerCase();
  if (p.product_type === 'bulk' || u === 'kg') return ['kg', 'gram', 'bag'];
  if (u === 'litre') return ['litre', ...CONTAINERS];
  if (allowsFraction(u)) return ['piece', ...CONTAINERS];
  return [...SINGLES, ...CONTAINERS];
}

/** Product's "bought by": stored measure, else the old carton / crate / piece setting, else from its unit. */
export function defaultMeasure(p: { unit_label?: string | null; product_type?: string | null; buy_measure?: string | null; buy_unit?: string | null }): Measure {
  const ok = measuresFor(p);
  if (isMeasure(p.buy_measure) && ok.includes(p.buy_measure)) return p.buy_measure;
  if (isMeasure(p.buy_unit) && ok.includes(p.buy_unit)) return p.buy_unit;
  const u = String(p.unit_label ?? '').toLowerCase();
  if (isMeasure(u) && ok.includes(u)) return u;
  return ok[0];
}

/** Legacy buy_unit (carton / crate / piece) kept in step for older screens and backups. */
export function legacyBuyUnit(m: Measure): 'carton' | 'crate' | 'piece' | null {
  if (m === 'crate') return 'crate';
  if (isContainer(m)) return 'carton';
  if (m === 'kg' || m === 'gram' || m === 'litre') return null;
  return 'piece';
}

/** Measure a stored line was bought in (older lines carry none). */
export function lineMeasure(l: { unit?: string | null; pack_name?: string | null; by_package?: number | null; unit_label?: string | null }): Measure {
  if (isMeasure(l.unit)) return l.unit;
  const fromPack = measureFromPackName(l.pack_name);
  if (fromPack) return fromPack;
  if (l.by_package === 1) return 'carton';
  const u = String(l.unit_label ?? '').toLowerCase();
  if (u === 'kg' || u === 'litre') return u;
  return 'piece';
}

/** Set a product's "bought by" (manual). Keeps the old carton / crate / piece column in step. */
export function setBuyMeasure(
  db: BetterSqlite3.Database,
  productId: string,
  m: unknown,
): { ok: true } | { ok: false; error: string } {
  if (!isMeasure(m)) return { ok: false, error: 'invalid_buy_measure' };
  const p = db.prepare(`SELECT unit_label, product_type FROM products WHERE id = ? AND active = 1`).get(productId) as
    | { unit_label: string; product_type: string }
    | undefined;
  if (!p) return { ok: false, error: 'product_not_found' };
  if (!measuresFor(p).includes(m)) return { ok: false, error: 'invalid_buy_measure' };
  const legacy = legacyBuyUnit(m);
  db.prepare(
    `UPDATE products SET buy_measure = ?, buy_unit = CASE WHEN ? IS NULL THEN buy_unit ELSE ? END,
            buy_unit_source = CASE WHEN ? IS NULL THEN buy_unit_source ELSE 'manual' END, updated_at = datetime('now') WHERE id = ?`,
  ).run(m, legacy, legacy, legacy, productId);
  return { ok: true };
}
