import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';

type Db = BetterSqlite3.Database;
export type ProductType = 'normal' | 'bulk' | 'packed';
export const PRODUCT_TYPES: ProductType[] = ['normal', 'bulk', 'packed'];

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Spec staples → names of an existing loose item that already is that bulk (first match wins). */
export const STAPLES: Array<{ name: string; match: string[] }> = [
  { name: 'Sugar', match: ['Sugar (Cheeni) Loose', 'Sugar Loose', 'Cheeni Loose', 'Sugar'] },
  { name: 'Rice', match: ['Sella Rice Loose', 'Rice Loose', 'Rice'] },
  { name: 'Rice Basmati', match: ['Basmati Rice Loose', 'Rice Basmati Loose', 'Rice Basmati'] },
  { name: 'Daal Mash', match: ['Daal Mash Washed', 'Daal Mash Loose', 'Daal Mash'] },
  { name: 'Daal Chana', match: ['Daal Chana', 'Daal Chana Loose'] },
  { name: 'Masoor', match: ['Daal Masoor', 'Masoor Loose', 'Masoor'] },
  { name: 'Moong', match: ['Daal Moong Washed', 'Daal Moong Loose', 'Moong Loose', 'Moong'] },
  { name: 'Atta', match: ['Atta Loose', 'Atta'] },
];

const WEIGHT = /^(.*?)\s+(\d+(?:\.\d+)?)\s*(kg|g)$/i;
const STAPLE_WORDS = /\b(sugar|cheeni|rice|basmati|sella|daal|dal|chana|mash|masoor|moong|atta|maida|lobia|rajma|gur|shakar|shakkar|khaand|sabudana)\b/i;
const BRANDED = /^(falak|guard|country|nestle|lu|shahi|super crisp|kisan|national|shan|knorr|mitchell'?s|dalda|habib|ariel|surf|bonus|brite|tapal|lipton|vital|peek freans|bisconni|fauji|k&n|young'?s)\b/i;
const DRINK = /\b(cola|pepsi|7up|sprite|fanta|mirinda|mountain dew|sting|red bull|aquafina|pure life|gourmet|tiger energy)\b/i;
const SNACK = /\b(lays|kurkure|cheetos|slanty|biscuit|gluco|sooper|prince|oreo|candi|tuc|rio|marie|noodles|nimco|wafers|rusk|cookies|pik|zeera plus|nankhatai|wheatable|potato sticks|popcorn)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/\s+loose$/, '').replace(/\s+/g, ' ').trim();
const strip = (s: string) => s.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();

/** "Sugar 1.5 kg" → { base: 'Sugar', kg: 1.5 }; "Daal 500 g" → 0.5. */
export function parsePackName(name: string): { base: string; kg: number } | null {
  const m = WEIGHT.exec(name.trim());
  if (!m) return null;
  const n = Number(m[2]);
  if (!(n > 0)) return null;
  return { base: m[1]!.trim(), kg: r3(m[3]!.toLowerCase() === 'g' ? n / 1000 : n) };
}

type Row = {
  id: string;
  name: string;
  unit_label: string;
  product_type: ProductType;
  type_source: string | null;
  repack_from_id: string | null;
  size_qty: number | null;
  size_group_id: string | null;
};
type Before = Pick<Row, 'product_type' | 'type_source' | 'repack_from_id' | 'size_qty' | 'size_group_id'>;
export type PlanChange = { id: string; name: string; before: Before; after: Before; why: string };
export type Plan = {
  changes: PlanChange[];
  createStaples: string[];
  packs: Array<{ productId: string; name: string; packName: string; units: number }>;
  review: Array<{ productId: string; name: string; kg: number; reason: string; candidates: Array<{ id: string; name: string }> }>;
};

/** Work out what the sorter would do. Pure read; manual choices and existing links are left alone. */
export function planTypes(db: Db): Plan {
  const rows = db
    .prepare(
      `SELECT id, name, unit_label, product_type, type_source, repack_from_id, size_qty, size_group_id FROM products WHERE active = 1 ORDER BY name COLLATE NOCASE`,
    )
    .all() as Row[];
  const before = (r: Row): Before => ({
    product_type: r.product_type,
    type_source: r.type_source,
    repack_from_id: r.repack_from_id,
    size_qty: r.size_qty,
    size_group_id: r.size_group_id,
  });
  const changes: PlanChange[] = [];
  const touched = new Map<string, Before>();
  const set = (r: Row, after: Partial<Before>, why: string) => {
    const a: Before = { ...before(r), ...after, type_source: 'auto' };
    changes.push({ id: r.id, name: r.name, before: before(r), after: a, why });
    touched.set(r.id, a);
  };
  const manual = (r: Row) => r.type_source === 'manual';

  // 1. bulk: every kg item (plus anything already bulk)
  const bulks = rows.filter((r) => r.product_type === 'bulk' || (r.unit_label === 'kg' && !manual(r) && r.product_type === 'normal'));
  for (const r of bulks) if (r.product_type !== 'bulk') set(r, { product_type: 'bulk' }, 'kg item');
  const byLower = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  const createStaples: string[] = [];
  for (const s of STAPLES) {
    const hit = s.match.map((n) => byLower.get(n.toLowerCase())).find((r) => r && (r.unit_label === 'kg' || r.product_type === 'bulk'));
    if (!hit) createStaples.push(s.name);
  }

  // 2. packed: existing links, then "<bulk base> <n> kg|g"
  const bulkKeys = new Map<string, Row>();
  for (const b of bulks) {
    bulkKeys.set(norm(b.name), b);
    if (!bulkKeys.has(strip(norm(b.name)))) bulkKeys.set(strip(norm(b.name)), b);
  }
  const review: Plan['review'] = [];
  const isBulk = (r: Row) => r.product_type === 'bulk' || bulks.includes(r);
  for (const r of rows) {
    if (isBulk(r) || manual(r)) continue;
    if (r.repack_from_id && r.size_qty && r.size_qty > 0) {
      if (r.product_type !== 'packed') set(r, { product_type: 'packed' }, 'linked to bulk');
      continue;
    }
    if (r.product_type !== 'normal') continue;
    const p = parsePackName(r.name);
    if (!p) continue;
    const base = norm(p.base);
    const b = bulkKeys.get(base) ?? bulkKeys.get(strip(base));
    if (b) {
      set(r, { product_type: 'packed', repack_from_id: b.id, size_qty: p.kg, size_group_id: null }, `${p.kg} kg of ${b.name}`);
      continue;
    }
    if (STAPLE_WORDS.test(r.name) && !BRANDED.test(r.name)) {
      const words = strip(base).split(' ').filter((w) => w.length > 3);
      const cands = bulks
        .filter((x) => words.some((w) => strip(norm(x.name)).includes(w)))
        .sort((a, c) => {
          const sc = (x: Row) => words.filter((w) => strip(norm(x.name)).includes(w)).length + (/washed/i.test(x.name) ? 0.5 : 0);
          return sc(c) - sc(a);
        })
        .map((x) => ({ id: x.id, name: x.name }));
      review.push({ productId: r.id, name: r.name, kg: p.kg, reason: cands.length ? 'pick_bulk' : 'no_bulk', candidates: cands });
    }
  }

  // 3. default buying packs (only for items with none)
  const hasPack = new Set((db.prepare(`SELECT DISTINCT product_id FROM product_packs WHERE active = 1`).all() as Array<{ product_id: string }>).map((x) => x.product_id));
  const packs: Plan['packs'] = [];
  for (const r of rows) {
    if (hasPack.has(r.id) || manual(r)) continue;
    const type = touched.get(r.id)?.product_type ?? r.product_type;
    if (type === 'bulk') packs.push({ productId: r.id, name: r.name, packName: 'Bag', units: 50 });
    else if (type === 'normal' && DRINK.test(r.name) && !/\b5\s*l\b/i.test(r.name)) packs.push({ productId: r.id, name: r.name, packName: 'Crate', units: 12 });
    else if (type === 'normal' && SNACK.test(r.name) && !/\b(jar|box|family|pack)\b/i.test(r.name)) packs.push({ productId: r.id, name: r.name, packName: 'Carton', units: 24 });
  }
  const reviewed = new Set((db.prepare(`SELECT product_id FROM product_type_review WHERE resolved_by IS NULL OR resolved_by != 'undo'`).all() as Array<{ product_id: string }>).map((x) => x.product_id));
  return { changes, createStaples, packs, review: review.filter((x) => !reviewed.has(x.productId)) };
}

export type RunLog = {
  products: Array<{ id: string; before: Before; after: Before }>;
  created_products: string[];
  created_packs: string[];
  review: string[];
};

/**
 * Apply the plan in one transaction and log it for undo. Repeatable: a second run changes nothing.
 * createProduct makes a bulk staple (kg, Rs 0, in-store barcode).
 */
export function runTypes(db: Db, userId: string | null, createProduct: (name: string) => string) {
  return db.transaction(() => {
    const log: RunLog = { products: [], created_products: [], created_packs: [], review: [] };
    // staples first so packets can match them
    for (const name of planTypes(db).createStaples) {
      const id = createProduct(name);
      db.prepare(`UPDATE products SET product_type = 'bulk', type_source = 'auto' WHERE id = ?`).run(id);
      log.created_products.push(id);
      db.prepare(
        `INSERT INTO product_type_review (product_id, reason, kg, candidates_json) VALUES (?, 'new_bulk_price', NULL, NULL)
         ON CONFLICT(product_id) DO UPDATE SET reason = excluded.reason, resolved_at = NULL, resolved_by = NULL WHERE resolved_by = 'undo'`,
      ).run(id);
      log.review.push(id);
    }
    const plan = planTypes(db);
    const upd = db.prepare(
      `UPDATE products SET product_type = ?, type_source = ?, repack_from_id = ?, size_qty = ?, size_group_id = ?, updated_at = datetime('now') WHERE id = ?`,
    );
    for (const c of plan.changes) {
      upd.run(c.after.product_type, c.after.type_source, c.after.repack_from_id, c.after.size_qty, c.after.size_group_id, c.id);
      log.products.push({ id: c.id, before: c.before, after: c.after });
    }
    const insPack = db.prepare(`INSERT INTO product_packs (id, product_id, name, units, sort) VALUES (?, ?, ?, ?, 0)`);
    for (const p of plan.packs) {
      const id = randomUUID();
      insPack.run(id, p.productId, p.packName, p.units);
      log.created_packs.push(id);
    }
    const insR = db.prepare(`INSERT INTO product_type_review (product_id, reason, kg, candidates_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET reason = excluded.reason, kg = excluded.kg, candidates_json = excluded.candidates_json,
         created_at = datetime('now'), resolved_at = NULL, resolved_by = NULL WHERE resolved_by = 'undo'`);
    for (const r of plan.review) {
      insR.run(r.productId, r.reason, r.kg, JSON.stringify(r.candidates));
      log.review.push(r.productId);
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO product_type_runs (id, user_id, changes_json) VALUES (?, ?, ?)`).run(id, userId, JSON.stringify(log));
    return {
      id,
      counts: {
        changed: log.products.length,
        bulk: log.products.filter((x) => x.after.product_type === 'bulk').length + log.created_products.length,
        packed: log.products.filter((x) => x.after.product_type === 'packed').length,
        created: log.created_products.length,
        packs: log.created_packs.length,
        review: log.review.length,
      },
    };
  })();
}

/** Put back what a run changed. Nothing is deleted: created items/packs are switched off. */
export function undoRun(db: Db, runId: string): { ok: true; restored: number } | { ok: false; error: string } {
  const run = db.prepare(`SELECT changes_json, undone_at FROM product_type_runs WHERE id = ?`).get(runId) as
    | { changes_json: string; undone_at: string | null }
    | undefined;
  if (!run) return { ok: false, error: 'run_not_found' };
  if (run.undone_at) return { ok: false, error: 'already_undone' };
  const log = JSON.parse(run.changes_json) as RunLog;
  return db.transaction(() => {
    const upd = db.prepare(
      `UPDATE products SET product_type = ?, type_source = ?, repack_from_id = ?, size_qty = ?, size_group_id = ?, updated_at = datetime('now') WHERE id = ?`,
    );
    for (const p of log.products) upd.run(p.before.product_type, p.before.type_source, p.before.repack_from_id, p.before.size_qty, p.before.size_group_id, p.id);
    const offPack = db.prepare(`UPDATE product_packs SET active = 0 WHERE id = ?`);
    for (const id of log.created_packs) offPack.run(id);
    for (const id of log.created_products) {
      const moved =
        db.prepare(`SELECT 1 FROM stock_receives WHERE product_id = ? UNION SELECT 1 FROM sale_lines WHERE product_id = ? LIMIT 1`).get(id, id) ||
        Number((db.prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`).get(id) as { qty_on_hand: number } | undefined)?.qty_on_hand ?? 0) !== 0;
      if (!moved) db.prepare(`UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
    }
    const res = db.prepare(`UPDATE product_type_review SET resolved_at = datetime('now'), resolved_by = 'undo' WHERE product_id = ? AND resolved_at IS NULL`);
    for (const id of log.review) res.run(id);
    db.prepare(`UPDATE product_type_runs SET undone_at = datetime('now') WHERE id = ?`).run(runId);
    return { ok: true as const, restored: log.products.length };
  })();
}

/** Bulk items buy in bags: add "Bag 50" when the item has no buying pack yet. */
export function ensureBagPack(db: Db, productId: string): void {
  const has = db.prepare(`SELECT 1 FROM product_packs WHERE product_id = ? AND active = 1 LIMIT 1`).get(productId);
  if (!has) db.prepare(`INSERT INTO product_packs (id, product_id, name, units, sort) VALUES (?, ?, 'Bag', 50, 0)`).run(randomUUID(), productId);
}

/** Same checks as setProductType for a product not created yet, so a bad request never leaves a row behind. */
export function checkNewProductType(
  db: Db,
  input: { type?: unknown; bulkId?: unknown; kg?: unknown; unitLabel?: string },
): { ok: true } | { ok: false; error: string } {
  const type = String(input.type ?? '') as ProductType;
  if (!PRODUCT_TYPES.includes(type)) return { ok: false, error: 'invalid_product_type' };
  if (type === 'bulk' && input.unitLabel !== 'kg') return { ok: false, error: 'bulk_needs_kg' };
  if (type !== 'packed') return { ok: true };
  const bulkId = String(input.bulkId ?? '');
  const kg = r3(Number(input.kg));
  const b = bulkId ? (db.prepare(`SELECT product_type FROM products WHERE id = ? AND active = 1`).get(bulkId) as { product_type: string } | undefined) : undefined;
  if (!b || b.product_type !== 'bulk') return { ok: false, error: 'packed_needs_bulk' };
  if (!Number.isFinite(kg) || kg <= 0 || kg > 1000) return { ok: false, error: 'packed_needs_kg' };
  if (input.unitLabel === 'kg') return { ok: false, error: 'packed_is_pieces' };
  return { ok: true };
}

/** Set a product's type by hand. Packed needs an active bulk item and kg > 0 (3 decimals). */
export function setProductType(
  db: Db,
  productId: string,
  input: { type?: unknown; bulkId?: unknown; kg?: unknown },
): { ok: true } | { ok: false; error: string } {
  const p = db.prepare(`SELECT id, unit_label, product_type FROM products WHERE id = ? AND active = 1`).get(productId) as
    | { id: string; unit_label: string; product_type: ProductType }
    | undefined;
  if (!p) return { ok: false, error: 'product_not_found' };
  const type = String(input.type ?? '') as ProductType;
  if (!PRODUCT_TYPES.includes(type)) return { ok: false, error: 'invalid_product_type' };
  const hasPackets = () =>
    !!db.prepare(`SELECT 1 FROM products WHERE repack_from_id = ? AND active = 1 AND product_type = 'packed' LIMIT 1`).get(productId);
  if (type === 'bulk') {
    if (p.unit_label !== 'kg') return { ok: false, error: 'bulk_needs_kg' };
    db.prepare(`UPDATE products SET product_type = 'bulk', type_source = 'manual', repack_from_id = NULL, updated_at = datetime('now') WHERE id = ?`).run(productId);
    ensureBagPack(db, productId);
    return { ok: true };
  }
  if (p.product_type === 'bulk' && hasPackets()) return { ok: false, error: 'bulk_has_packets' };
  if (type === 'packed') {
    const bulkId = String(input.bulkId ?? '');
    const kg = r3(Number(input.kg));
    if (!bulkId || bulkId === productId) return { ok: false, error: 'packed_needs_bulk' };
    const b = db.prepare(`SELECT product_type FROM products WHERE id = ? AND active = 1`).get(bulkId) as { product_type: string } | undefined;
    if (!b || b.product_type !== 'bulk') return { ok: false, error: 'packed_needs_bulk' };
    if (!Number.isFinite(kg) || kg <= 0 || kg > 1000) return { ok: false, error: 'packed_needs_kg' };
    if (p.unit_label === 'kg') return { ok: false, error: 'packed_is_pieces' };
    db.prepare(
      `UPDATE products SET product_type = 'packed', type_source = 'manual', repack_from_id = ?, size_qty = ?, size_group_id = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).run(bulkId, kg, productId);
    return { ok: true };
  }
  db.prepare(
    `UPDATE products SET product_type = 'normal', type_source = 'manual',
       size_qty = CASE WHEN repack_from_id IS NOT NULL THEN NULL ELSE size_qty END, repack_from_id = NULL, updated_at = datetime('now') WHERE id = ?`,
  ).run(productId);
  return { ok: true };
}
