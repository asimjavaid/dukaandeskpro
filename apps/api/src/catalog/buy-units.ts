import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import { parsePackName } from './product-types';

type Db = BetterSqlite3.Database;
export type BuyUnit = 'carton' | 'crate' | 'piece';
export const BUY_UNITS: BuyUnit[] = ['carton', 'crate', 'piece'];

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// Bottled soft drinks and water come in crates; cans come in cartons.
const BOTTLE_DRINK = /\b(coca[- ]?cola|coke|pepsi|7\s?up|sprite|fanta|mirinda|mountain dew|dew|sting|aquafina|pure life|gourmet cola|water)\b/i;
const GLASS_JUICE = /^shezan\s+(apple|mango|fruit punch|orange)\s+250\s*ml$/i;
const CAN = /\b(can|slim can|red bull|tiger energy)\b/i;
const BIG_BAG = /\b(\d+(?:\.\d+)?)\s*kg\b/i;
const SINGLE = /^(eggs?\b|.*\bbread\b)/i;
const CARTON_WORDS = new RegExp(
  '\\b(' + [
    // snacks, biscuits, confectionery
    'lays|kurkure|cheetos|slanty|chips|nimco|nimko|digestive|sandwich|dal moth|crisp|popcorn|potato sticks|biscuits?|cookies|rusk|wafers?|gluco|sooper|prince|oreo|candi|tuc|rio|marie|pik|zeera plus|nankhatai|wheatable|cake|cocomo|chocolatto|tiger|gala|cocomax',
    'cadbury|dairy milk|perk|snickers|mentos|candyland|jelly|marshmallow|bubble|lollipop|lolli|eclair|jubilee|chocolate|candy',
    // dairy and drinks in packs
    'milk|milkpak|olpers|haleeb|nurpur|omung|dahi|yogurt|raita|cheese|cheddar|butter|margarine|cream|whitener|tarang|juice|slice|fruita|fruitien|squash|rooh afza|jam-e-shirin|tang|red bull|energy|can',
    // toiletries, cleaning
    'soap|shampoo|hand wash|toothpaste|colgate|closeup|sensodyne|toothbrush|lotion|glow|hair oil|hair tonic|coconut oil|roll on|razor|blades|pads|always|butterfly|molfix|canbebe|wipes|tissue|toilet roll|johnson|dettol|lifebuoy|lux|safeguard|palmolive|dove|capri|tibet|sunsilk|pantene|clear men|vatika|parachute|dabur|vaseline|ponds',
    'surf|ariel|bonus|brite|express|detergent|washing|vim|lemon max|harpic|phenyle|bleach|robin|comfort|toilet cleaner|dishwash|kingtox|promaid|laundry',
    // spices, tea, cooking, sauces, pasta
    'masala|biryani|nihari|karahi|tikka|haleem|korma|chaat|powder|salt|namak|methi|zeera|turmeric|chilli|garlic|ginger|paste|cubes|stock',
    'tea|tapal|lipton|vital|danedar|brooke bond|tezdum|mixture',
    'oil|ghee|banaspati|canola',
    'ketchup|sauce|jam|pickle|vinegar|mayonnaise|spread|lemon juice|soy',
    'noodles|macaroni|spaghetti|vermicelli|indomie|shoop',
    'rice|basmati|sugar|flour|corn|firni|cerelac|everyday|nuggets|k&n',
    'duracell|energizer|eveready|battery|shezan|nestle',
  ].join('|') + ')\\b',
  'i',
);

/** Default purchase package for a normal product, from its name. sure=false goes on the "check" list. */
export function classifyBuyUnit(name: string, unitLabel?: string | null): { unit: BuyUnit; sure: boolean } {
  const n = name.trim();
  if (unitLabel === 'dozen' || SINGLE.test(n)) return { unit: 'piece', sure: true };
  if (GLASS_JUICE.test(n)) return { unit: 'crate', sure: false };
  if (BOTTLE_DRINK.test(n) && !CAN.test(n)) {
    if (/(^|\s)5\s*(l|ltr|litre)\b/i.test(n)) return { unit: 'carton', sure: false };
    return { unit: 'crate', sure: true };
  }
  const bag = BIG_BAG.exec(n);
  if (bag && Number(bag[1]) >= 5 && /\b(atta|rice|basmati|sugar|sella)\b/i.test(n)) return { unit: 'piece', sure: false };
  if (CARTON_WORDS.test(n)) return { unit: 'carton', sure: true };
  return { unit: 'carton', sure: false };
}

/** Loose kg items every kiryana keeps. match = names that already count as this item; packets = packet names to link. */
export const LOOSE_STAPLES: Array<{ name: string; match: string[]; packets?: RegExp; renameFrom?: string }> = [
  { name: 'Atta Loose', match: ['Atta Loose', 'Atta (Flour) Loose', 'Chakki Atta Loose'], renameFrom: 'Atta' },
  { name: 'Maida Loose', match: ['Maida Loose', 'Maida'], packets: /^maida$/i },
  { name: 'Sabudana Loose', match: ['Sabudana Loose', 'Sabudana'], packets: /^sabudana$/i },
  { name: 'Khaand Loose', match: ['Khaand Loose', 'Khaand'], packets: /^khaand(\s*\(.*\))?$/i },
  { name: 'Shakar Loose', match: ['Shakar Loose', 'Shakkar Loose', 'Shakar', 'Shakkar'], packets: /^shakk?ar$/i },
  { name: 'Besan Loose', match: ['Besan Loose', 'Besan'], packets: /^besan$/i },
  { name: 'Suji Loose', match: ['Suji Loose', 'Sooji Loose', 'Suji', 'Sooji'], packets: /^(suji|sooji)$/i },
  { name: 'Dalia Loose', match: ['Dalia Loose', 'Daliya Loose', 'Dalia'], packets: /^dal(i|iy)a$/i },
  { name: 'Safaid Zeera Loose', match: ['Safaid Zeera Loose', 'Zeera Loose'], packets: /^safaid zeera$/i },
  { name: 'Lal Mirch Powder Loose', match: ['Lal Mirch Powder Loose', 'Lal Mirch Loose'], packets: /^lal mirch( powder)?$/i },
  { name: 'Haldi Powder Loose', match: ['Haldi Powder Loose', 'Haldi Loose'], packets: /^haldi( powder)?$/i },
  { name: 'Dhania Powder Loose', match: ['Dhania Powder Loose', 'Dhania Loose'], packets: /^dhania( powder)?$/i },
];

type P = {
  id: string;
  name: string;
  unit_label: string;
  price_paisa: number;
  product_type: string;
  type_source: string | null;
  repack_from_id: string | null;
  size_qty: number | null;
  size_group_id: string | null;
  buy_unit: string | null;
  buy_unit_source: string | null;
};

export type BuyRunLog = {
  renamed: Array<{ id: string; before: string; after: string }>;
  created: string[];
  linked: Array<{ id: string; before: Pick<P, 'product_type' | 'type_source' | 'repack_from_id' | 'size_qty' | 'size_group_id' | 'buy_unit' | 'buy_unit_source'> }>;
  resolved: string[];
  review_added: string[];
  prices: Array<{ id: string; before: number; after: number }>;
  buy: Array<{ id: string; before: string | null; before_source: string | null; after: string | null }>;
  uncertain: Array<{ id: string; name: string; unit: BuyUnit }>;
};

/**
 * One pass: loose staples (create / rename / link packets / settle review), then a purchase package
 * for every normal product. Repeatable: a second run changes nothing. createProduct makes a kg bulk item.
 */
export function runBuyUnits(db: Db, userId: string | null, createProduct: (name: string) => string) {
  return db.transaction(() => {
    const log: BuyRunLog = { renamed: [], created: [], linked: [], resolved: [], review_added: [], prices: [], buy: [], uncertain: [] };
    const all = () =>
      db
        .prepare(
          `SELECT id, name, unit_label, price_paisa, product_type, type_source, repack_from_id, size_qty, size_group_id, buy_unit, buy_unit_source
           FROM products WHERE active = 1 ORDER BY name COLLATE NOCASE`,
        )
        .all() as P[];
    let rows = all();
    const byLower = () => new Map(rows.map((r) => [r.name.toLowerCase(), r]));
    const isBulkish = (r: P | undefined) => !!r && (r.product_type === 'bulk' || r.unit_label === 'kg');
    const addReview = db.prepare(
      `INSERT INTO product_type_review (product_id, reason, kg, candidates_json) VALUES (?, 'new_bulk_price', NULL, NULL)
       ON CONFLICT(product_id) DO NOTHING`,
    );

    // 1. loose staples
    for (const s of LOOSE_STAPLES) {
      const names = byLower();
      let bulk = s.match.map((m) => names.get(m.toLowerCase())).find(isBulkish);
      if (!bulk && s.renameFrom) {
        const old = names.get(s.renameFrom.toLowerCase());
        if (old && old.product_type === 'bulk' && !names.has(s.name.toLowerCase())) {
          db.prepare(`UPDATE products SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(s.name, old.id);
          log.renamed.push({ id: old.id, before: old.name, after: s.name });
          rows = all();
          bulk = rows.find((r) => r.id === old.id);
        }
      }
      if (!bulk) {
        const id = createProduct(s.name);
        db.prepare(`UPDATE products SET product_type = 'bulk', type_source = 'auto', buy_unit = NULL, buy_unit_source = 'auto' WHERE id = ?`).run(id);
        log.created.push(id);
        if (addReview.run(id).changes) log.review_added.push(id);
        rows = all();
        bulk = rows.find((r) => r.id === id);
      }
      if (!bulk || !s.packets) continue;
      if (bulk.product_type !== 'bulk') continue;
      for (const r of rows) {
        if (r.id === bulk.id || r.product_type !== 'normal' || r.type_source === 'manual' || r.repack_from_id) continue;
        const p = parsePackName(r.name);
        if (!p || !s.packets.test(p.base.trim())) continue;
        log.linked.push({
          id: r.id,
          before: {
            product_type: r.product_type,
            type_source: r.type_source,
            repack_from_id: r.repack_from_id,
            size_qty: r.size_qty,
            size_group_id: r.size_group_id,
            buy_unit: r.buy_unit,
            buy_unit_source: r.buy_unit_source,
          },
        });
        db.prepare(
          `UPDATE products SET product_type = 'packed', type_source = 'auto', repack_from_id = ?, size_qty = ?, size_group_id = NULL,
             buy_unit = NULL, buy_unit_source = 'auto', updated_at = datetime('now') WHERE id = ?`,
        ).run(bulk.id, r3(p.kg), r.id);
        const open = db.prepare(`UPDATE product_type_review SET resolved_at = datetime('now'), resolved_by = 'buy-units' WHERE product_id = ? AND resolved_at IS NULL`).run(r.id);
        if (open.changes) log.resolved.push(r.id);
      }
      // new loose item: start the per-kg price from its cheapest-per-kg packet (owner confirms in the review list)
      if (log.created.includes(bulk.id) && bulk.price_paisa === 0) {
        const per = db
          .prepare(`SELECT MIN(ROUND(price_paisa / size_qty / 100.0) * 100) AS p FROM products WHERE repack_from_id = ? AND active = 1 AND size_qty > 0 AND price_paisa > 0`)
          .get(bulk.id) as { p: number | null };
        if (per.p && per.p > 0) {
          db.prepare(`UPDATE products SET price_paisa = ?, updated_at = datetime('now') WHERE id = ?`).run(per.p, bulk.id);
          log.prices.push({ id: bulk.id, before: 0, after: per.p });
        }
      }
      rows = all();
    }

    // 2. review rows we can settle: big branded bags (5 kg+) stay normal
    const big = db
      .prepare(`SELECT r.product_id FROM product_type_review r JOIN products p ON p.id = r.product_id
                WHERE r.resolved_at IS NULL AND r.reason = 'pick_bulk' AND r.kg >= 5 AND p.product_type = 'normal' AND p.active = 1`)
      .all() as Array<{ product_id: string }>;
    for (const b of big) {
      db.prepare(`UPDATE product_type_review SET resolved_at = datetime('now'), resolved_by = 'buy-units' WHERE product_id = ?`).run(b.product_id);
      log.resolved.push(b.product_id);
    }

    // 3. purchase package for every product (manual choices kept)
    const setBuy = db.prepare(`UPDATE products SET buy_unit = ?, buy_unit_source = ?, updated_at = datetime('now') WHERE id = ?`);
    for (const r of all()) {
      if (r.buy_unit_source === 'manual') continue;
      if (r.product_type !== 'normal') {
        if (r.buy_unit != null) {
          setBuy.run(null, 'auto', r.id);
          log.buy.push({ id: r.id, before: r.buy_unit, before_source: r.buy_unit_source, after: null });
        }
        continue;
      }
      const c = classifyBuyUnit(r.name, r.unit_label);
      if (!c.sure) log.uncertain.push({ id: r.id, name: r.name, unit: c.unit });
      if (r.buy_unit === c.unit && r.buy_unit_source === 'auto') continue;
      if (r.buy_unit != null && r.buy_unit_source === 'auto') continue; // set by an earlier run: leave it
      setBuy.run(c.unit, 'auto', r.id);
      log.buy.push({ id: r.id, before: r.buy_unit, before_source: r.buy_unit_source, after: c.unit });
    }

    const id = randomUUID();
    db.prepare(`INSERT INTO buy_unit_runs (id, user_id, changes_json) VALUES (?, ?, ?)`).run(id, userId, JSON.stringify(log));
    return { id, log };
  })();
}

/** Put back what a buy-units run changed. Created loose items with no stock movement are switched off. */
export function undoBuyUnits(db: Db, runId: string): { ok: true } | { ok: false; error: string } {
  const run = db.prepare(`SELECT changes_json, undone_at FROM buy_unit_runs WHERE id = ?`).get(runId) as { changes_json: string; undone_at: string | null } | undefined;
  if (!run) return { ok: false, error: 'run_not_found' };
  if (run.undone_at) return { ok: false, error: 'already_undone' };
  const log = JSON.parse(run.changes_json) as BuyRunLog;
  return db.transaction(() => {
    const setBuy = db.prepare(`UPDATE products SET buy_unit = ?, buy_unit_source = ? WHERE id = ?`);
    for (const b of [...log.buy].reverse()) setBuy.run(b.before, b.before_source, b.id);
    const upL = db.prepare(
      `UPDATE products SET product_type = ?, type_source = ?, repack_from_id = ?, size_qty = ?, size_group_id = ?, buy_unit = ?, buy_unit_source = ? WHERE id = ?`,
    );
    for (const l of log.linked) {
      const b = l.before;
      upL.run(b.product_type, b.type_source, b.repack_from_id, b.size_qty, b.size_group_id, b.buy_unit, b.buy_unit_source, l.id);
    }
    const reopen = db.prepare(`UPDATE product_type_review SET resolved_at = NULL, resolved_by = NULL WHERE product_id = ? AND resolved_by = 'buy-units'`);
    for (const id of log.resolved) reopen.run(id);
    for (const p of log.prices) db.prepare(`UPDATE products SET price_paisa = ? WHERE id = ? AND price_paisa = ?`).run(p.before, p.id, p.after);
    for (const id of log.created) {
      const moved =
        db.prepare(`SELECT 1 FROM stock_receives WHERE product_id = ? UNION SELECT 1 FROM sale_lines WHERE product_id = ? LIMIT 1`).get(id, id) ||
        Number((db.prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`).get(id) as { qty_on_hand: number } | undefined)?.qty_on_hand ?? 0) !== 0;
      if (!moved) db.prepare(`UPDATE products SET active = 0 WHERE id = ?`).run(id);
      db.prepare(`DELETE FROM product_type_review WHERE product_id = ? AND resolved_at IS NULL`).run(id);
    }
    for (const r of log.renamed) db.prepare(`UPDATE products SET name = ? WHERE id = ? AND name = ?`).run(r.before, r.id, r.after);
    db.prepare(`UPDATE buy_unit_runs SET undone_at = datetime('now') WHERE id = ?`).run(runId);
    return { ok: true as const };
  })();
}

/** Purchase package shown on orders and bills: kg for bulk, nothing for packed, else carton / crate / piece. */
export function effectiveBuyUnit(p: { product_type?: string | null; buy_unit?: string | null }): 'kg' | BuyUnit | null {
  if (p.product_type === 'bulk') return 'kg';
  if (p.product_type === 'packed') return null;
  return (BUY_UNITS as string[]).includes(String(p.buy_unit)) ? (p.buy_unit as BuyUnit) : 'piece';
}

export const packNameFor = (u: string) => (u === 'crate' ? 'Crate' : 'Carton');

/** Set by hand in Catalog. */
export function setBuyUnit(db: Db, productId: string, unit: unknown): { ok: true } | { ok: false; error: string } {
  const u = String(unit ?? '');
  if (!(BUY_UNITS as string[]).includes(u)) return { ok: false, error: 'invalid_buy_unit' };
  const r = db.prepare(`UPDATE products SET buy_unit = ?, buy_unit_source = 'manual', updated_at = datetime('now') WHERE id = ? AND active = 1`).run(u, productId);
  return r.changes ? { ok: true } : { ok: false, error: 'product_not_found' };
}
