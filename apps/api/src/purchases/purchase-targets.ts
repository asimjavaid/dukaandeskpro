import type BetterSqlite3 from 'better-sqlite3';

/** Everything can be bought: loose (bulk) by kg / bag, packed-from items ready-made too. */
export const PURCHASE_TYPES = ['normal', 'bulk', 'packed'] as const;
export const isPurchasable = (t: string | null | undefined) => (PURCHASE_TYPES as readonly string[]).includes(String(t ?? ''));
/** The till never sells loose items; they are sold as packs. */
export const SALE_TYPES = ['normal', 'packed'] as const;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type PurchaseTarget = {
  id: string;
  name: string;
  unit_label: string;
  product_type: string;
  buy_unit: string | null;
  last_unit_cost_paisa: number | null;
  price_paisa: number;
  fixed_price: number;
  qty: number;
  /** Packed items folded into this bulk line. */
  from: Array<{ id: string; name: string; packets: number; kg_each: number }>;
};

/**
 * What to restock for a list of wanted items: normal / bulk stay as they are; a packed-from item becomes kg
 * of its loose source (packets × kg per pack), since the shop packs it. Same source twice is merged.
 * A packed-from item whose source is gone is bought ready-made.
 */
export function purchaseTargets(
  db: BetterSqlite3.Database,
  wanted: Array<{ id: string; qty?: number | null }>,
): { items: PurchaseTarget[]; skipped: Array<{ id: string; name: string; reason: string }> } {
  const q = db.prepare(
    `SELECT id, name, unit_label, product_type, buy_unit, last_unit_cost_paisa, price_paisa, fixed_price, repack_from_id, size_qty, active
     FROM products WHERE id = ?`,
  );
  type P = {
    id: string; name: string; unit_label: string; product_type: string; buy_unit: string | null; last_unit_cost_paisa: number | null;
    price_paisa: number; fixed_price: number; repack_from_id: string | null; size_qty: number | null; active: number;
  };
  const out = new Map<string, PurchaseTarget>();
  const skipped: Array<{ id: string; name: string; reason: string }> = [];
  const put = (p: P, qty: number, from?: PurchaseTarget['from'][number]) => {
    const t = out.get(p.id) ?? {
      id: p.id, name: p.name, unit_label: p.unit_label, product_type: p.product_type, buy_unit: p.buy_unit,
      last_unit_cost_paisa: p.last_unit_cost_paisa, price_paisa: p.price_paisa, fixed_price: p.fixed_price, qty: 0, from: [],
    };
    t.qty = r3(t.qty + qty);
    if (from) t.from.push(from);
    out.set(p.id, t);
  };
  for (const w of wanted) {
    const p = q.get(String(w.id ?? '')) as P | undefined;
    if (!p || p.active !== 1) continue;
    const n = Number(w.qty);
    const qty = Number.isFinite(n) && n > 0 ? n : 1;
    if (p.product_type !== 'packed') {
      put(p, qty);
      continue;
    }
    const b = p.repack_from_id ? (q.get(p.repack_from_id) as P | undefined) : undefined;
    const kg = Number(p.size_qty);
    if (!b || b.active !== 1 || b.product_type !== 'bulk' || !(kg > 0)) {
      put(p, qty);
      continue;
    }
    const packets = Math.max(1, Math.ceil(qty - 1e-9));
    put(b, r3(packets * kg), { id: p.id, name: p.name, packets, kg_each: kg });
  }
  return { items: [...out.values()], skipped };
}
