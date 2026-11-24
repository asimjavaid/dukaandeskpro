import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';

type Db = BetterSqlite3.Database;

export type PricingSettings = {
  default_markup_bp: number;
  round_paisa: 100 | 500 | 1000;
  round_mode: 'up' | 'nearest';
  min_margin_bp: number;
};

export type CostChange = { productId: string; costPaisa: number; prevCostPaisa: number | null };

export type PriceCheckRow = {
  product_id: string;
  name: string;
  unit_label: string;
  cost_paisa: number;
  prev_cost_paisa: number | null;
  markup_bp: number;
  markup_custom: boolean;
  current_paisa: number;
  suggested_paisa: number;
  current_margin_bp: number | null;
  suggested_margin_bp: number | null;
  /** Price is below the suggestion or margin is under the shop minimum. */
  needs: boolean;
};

export function readPricing(db: Db): PricingSettings {
  const r = db
    .prepare(`SELECT default_markup_bp, price_round_paisa, price_round_mode, min_margin_bp FROM store LIMIT 1`)
    .get() as Record<string, unknown> | undefined;
  const step = Number(r?.price_round_paisa ?? 500);
  return {
    default_markup_bp: Number(r?.default_markup_bp ?? 3000),
    round_paisa: ([100, 500, 1000].includes(step) ? step : 500) as PricingSettings['round_paisa'],
    round_mode: r?.price_round_mode === 'nearest' ? 'nearest' : 'up',
    min_margin_bp: Number(r?.min_margin_bp ?? 500),
  };
}

export function savePricing(
  db: Db,
  input: Record<string, unknown>,
): { ok: true; pricing: PricingSettings } | { ok: false; error: string } {
  const next = { ...readPricing(db) };
  if (input.default_markup_bp !== undefined) {
    const n = Math.round(Number(input.default_markup_bp));
    if (!Number.isInteger(n) || n < 0 || n > 100000) return { ok: false, error: 'invalid_markup' };
    next.default_markup_bp = n;
  }
  if (input.round_paisa !== undefined) {
    const n = Number(input.round_paisa);
    if (![100, 500, 1000].includes(n)) return { ok: false, error: 'invalid_rounding' };
    next.round_paisa = n as PricingSettings['round_paisa'];
  }
  if (input.round_mode !== undefined) {
    if (input.round_mode !== 'up' && input.round_mode !== 'nearest') return { ok: false, error: 'invalid_rounding' };
    next.round_mode = input.round_mode;
  }
  if (input.min_margin_bp !== undefined) {
    const n = Math.round(Number(input.min_margin_bp));
    if (!Number.isInteger(n) || n < 0 || n > 9900) return { ok: false, error: 'invalid_margin' };
    next.min_margin_bp = n;
  }
  db.prepare(
    `UPDATE store SET default_markup_bp = ?, price_round_paisa = ?, price_round_mode = ?, min_margin_bp = ?, updated_at = datetime('now')`,
  ).run(next.default_markup_bp, next.round_paisa, next.round_mode, next.min_margin_bp);
  return { ok: true, pricing: next };
}

/** Round a raw price to the step; never below cost. */
export function roundPrice(raw: number, cost: number, step: number, mode: 'up' | 'nearest'): number {
  let p = mode === 'up' ? Math.ceil(raw / step - 1e-9) * step : Math.round(raw / step) * step;
  if (p < cost) p = Math.ceil(cost / step - 1e-9) * step;
  return Math.max(p, step);
}

export const marginBp = (price: number, cost: number) => (price > 0 ? Math.round(((price - cost) / price) * 10000) : null);

/**
 * Suggested sale prices for new costs. Fixed-price (MRP) items are never listed.
 * onlyChanged: list only when cost moved ≥ 1% (or first cost) and the price needs a look.
 */
export function suggestPrices(db: Db, changes: CostChange[], opts: { onlyChanged: boolean }): PriceCheckRow[] {
  const s = readPricing(db);
  const last = new Map<string, CostChange>();
  for (const c of changes) {
    const prev = last.get(c.productId);
    last.set(c.productId, prev ? { ...c, prevCostPaisa: prev.prevCostPaisa } : c);
  }
  const get = db.prepare(`SELECT id, name, unit_label, price_paisa, fixed_price, markup_bp FROM products WHERE id = ? AND active = 1`);
  const out: PriceCheckRow[] = [];
  for (const c of last.values()) {
    const p = get.get(c.productId) as
      | { id: string; name: string; unit_label: string; price_paisa: number; fixed_price: number; markup_bp: number | null }
      | undefined;
    if (!p || p.fixed_price === 1 || !(c.costPaisa > 0)) continue;
    const markup = p.markup_bp ?? s.default_markup_bp;
    const suggested = roundPrice((c.costPaisa * (10000 + markup)) / 10000, c.costPaisa, s.round_paisa, s.round_mode);
    const curMargin = marginBp(p.price_paisa, c.costPaisa);
    const needs = p.price_paisa < suggested || curMargin == null || curMargin < s.min_margin_bp;
    const moved = c.prevCostPaisa == null || c.prevCostPaisa <= 0 || Math.abs(c.costPaisa - c.prevCostPaisa) / c.prevCostPaisa >= 0.01;
    if (opts.onlyChanged && !(moved && needs)) continue;
    out.push({
      product_id: p.id,
      name: p.name,
      unit_label: p.unit_label,
      cost_paisa: c.costPaisa,
      prev_cost_paisa: c.prevCostPaisa,
      markup_bp: markup,
      markup_custom: p.markup_bp != null,
      current_paisa: p.price_paisa,
      suggested_paisa: suggested,
      current_margin_bp: curMargin,
      suggested_margin_bp: marginBp(suggested, c.costPaisa),
      needs,
    });
  }
  return out;
}

/** Owner-confirmed new prices. Refuses printed-price items. */
export function applyPrices(
  db: Db,
  items: Array<{ productId?: unknown; pricePaisa?: unknown }>,
  userId: string | null,
): { ok: true; updated: number } | { ok: false; error: string } {
  if (!Array.isArray(items) || items.length < 1 || items.length > 500) return { ok: false, error: 'nothing_to_apply' };
  const clean: Array<{ id: string; price: number; name: string; old: number }> = [];
  for (const it of items) {
    const id = String(it?.productId ?? '');
    const price = Math.round(Number(it?.pricePaisa));
    if (!Number.isSafeInteger(price) || price <= 0) return { ok: false, error: 'invalid_price' };
    const p = db.prepare(`SELECT name, price_paisa, fixed_price FROM products WHERE id = ? AND active = 1`).get(id) as
      | { name: string; price_paisa: number; fixed_price: number }
      | undefined;
    if (!p) return { ok: false, error: 'product_not_found' };
    if (p.fixed_price === 1) return { ok: false, error: 'fixed_price' };
    clean.push({ id, price, name: p.name, old: p.price_paisa });
  }
  db.transaction(() => {
    const set = db.prepare(`UPDATE products SET price_paisa = ?, updated_at = datetime('now') WHERE id = ?`);
    const stamp = db.prepare(`UPDATE price_history SET changed_by = ? WHERE product_id = ? AND changed_by IS NULL`);
    for (const c of clean) {
      if (c.price === c.old) continue;
      set.run(c.price, c.id);
      if (userId) stamp.run(userId, c.id);
    }
    const store = db.prepare(`SELECT id FROM store LIMIT 1`).get() as { id: string } | undefined;
    db.prepare(
      `INSERT INTO audit_log (id, action, user_id, store_id, subject_type, subject_id, payload_json) VALUES (?, 'price.suggest_apply', ?, ?, 'price', ?, ?)`,
    ).run(
      randomUUID(),
      userId,
      store?.id ?? null,
      clean[0]!.id,
      JSON.stringify({
        name: clean.length === 1 ? clean[0]!.name : `${clean.length} prices`,
        note: clean.map((c) => `${c.name} Rs ${c.old / 100} → Rs ${c.price / 100}`).join(', ').slice(0, 400),
      }),
    );
  })();
  return { ok: true, updated: clean.filter((c) => c.price !== c.old).length };
}
