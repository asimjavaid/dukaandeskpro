#!/usr/bin/env node
/**
 * One-off catalog fixes (21 Oct 2026). Repeatable; every change is logged and can be undone.
 *   1. Barcodes of items merged by dedupe-names move onto their keeper as extra barcodes (needs migration 044).
 *   2. Shakar 500 g sell price -> Rs 135 (cost untouched).
 *   3. Lays range: existing Lays renamed to "Lays <Flavour> <size>", generic "Lays 50" becomes Classic Salted 30 g
 *      (the duplicate "Lays Salted 30 g" merges into it), every flavour x price is its own Normal product:
 *      Printed price on, sold by packet, bought by carton (pcs per carton where known), stock 0.
 *
 *   node scripts/catalog-fixes-oct21.cjs apply --db <sqlite> --dedupe-log <dedupe log.json> --log <out.json>
 *   node scripts/catalog-fixes-oct21.cjs undo  --db <sqlite> --log <out.json>
 * Run with cwd apps/api after the API build (uses dist/catalog/ean13.js).
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const api = path.join(__dirname, '..', 'apps', 'api');
const Database = require(require.resolve('better-sqlite3', { paths: [api, process.cwd()] }));
const { inStoreEan13 } = require(path.join(api, 'dist', 'catalog', 'ean13.js'));

const args = process.argv.slice(2);
const mode = args[0];
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!['apply', 'undo'].includes(mode) || !opt('db') || !opt('log')) {
  console.error('usage: catalog-fixes-oct21.cjs apply|undo --db <file> --log <file> [--dedupe-log <file>]');
  process.exit(2);
}

const SHAKAR = { name: 'Shakar 500 g', pricePaisa: 13500 };
/** Existing Lays -> new name. */
const LAYS_RENAME = {
  'Lays 50': 'Lays Classic Salted 30 g',
  'Lays Classic 21 g': 'Lays Classic Salted 21 g',
  'Lays Salted 72 g': 'Lays Classic Salted 72 g',
  'Lays Wavy BBQ 30 g': 'Lays Wavy Texas BBQ 30 g',
};
/** Merged into the renamed Lays 50 (same item: Classic Salted, Rs 50). */
const LAYS_MERGE = { loser: 'Lays Salted 30 g', keeper: 'Lays 50' };
/** Pieces per carton by printed price (wholesale carton listings); unknown = none. */
const CARTON = { 20: 80, 30: 48, 50: 24, 70: 16 };
/** New items: [flavour, grams, Rs]. Sizes per Naheed / retailer listings, Oct 2026. */
const LAYS_NEW = [
  ['Classic Salted', 45, 70], ['Classic Salted', 116, 150],
  ['Masala', 11, 20], ['Masala', 45, 70], ['Masala', 72, 100], ['Masala', 116, 150],
  ['French Cheese', 11, 20], ['French Cheese', 45, 70], ['French Cheese', 72, 100], ['French Cheese', 120, 150],
  ['Yogurt & Herb', 17, 30], ['Yogurt & Herb', 45, 70], ['Yogurt & Herb', 72, 100], ['Yogurt & Herb', 116, 150],
  ['Paprika', 18, 30], ['Paprika', 30, 50], ['Paprika', 51.8, 70], ['Paprika', 72, 100],
  ['Wavy Texas BBQ', 16, 30], ['Wavy Texas BBQ', 45, 70], ['Wavy Texas BBQ', 70, 100],
  ['Wavy Yogurt & Herb', 16, 30], ['Wavy Yogurt & Herb', 30, 50], ['Wavy Yogurt & Herb', 45, 70],
  ['Masala Twist', 17, 30], ['Masala Twist', 31, 50], ['Masala Twist', 45, 70],
  ['Maxx Signature Cheese', 36, 70], ['Maxx Signature Cheese', 56, 100],
  ['Maxx Spicy Kimchi', 36, 70], ['Maxx Spicy Kimchi', 56, 100],
  ['Maxx Smokey Barbecue', 36, 70], ['Maxx Smokey Barbecue', 56, 100],
];
/** Picture for a new size: reuse the shop's own picture of the same flavour (no new downloads). */
const FLAVOUR_PICTURE = {
  'Classic Salted': 'Lays Classic Salted 21 g',
  Masala: 'Lays Masala 21 g',
  'French Cheese': 'Lays French Cheese 30 g',
  'Yogurt & Herb': 'Lays Yogurt & Herb 30 g',
  'Wavy Texas BBQ': 'Lays Wavy Texas BBQ 30 g',
};

const db = new Database(opt('db'));
db.pragma('foreign_keys = ON');
const imgDir = path.join(path.dirname(path.resolve(opt('db'))), 'product-images');
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const owner = () =>
  one(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'owner' AND u.disabled_at IS NULL ORDER BY u.created_at LIMIT 1`)?.id ?? null;
const byName = (n) => one(`SELECT * FROM products WHERE name = ? AND active = 1 ORDER BY created_at LIMIT 1`, n);
const taken = (code) => !!one(`SELECT 1 FROM products WHERE barcode = ? UNION SELECT 1 FROM product_barcodes WHERE barcode = ? UNION SELECT 1 FROM product_packs WHERE barcode = ?`, code, code, code);
function allocate() {
  let max = 0;
  for (const r of all(`SELECT barcode FROM products WHERE barcode IS NOT NULL UNION SELECT barcode FROM product_barcodes`)) {
    const m = /^20(\d{10})\d$/.exec(r.barcode);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = Math.max(one(`SELECT next_n AS n FROM barcode_seq WHERE id = 1`)?.n ?? 1, max + 1);
  for (;;) {
    const code = inStoreEan13(n);
    n += 1;
    if (!taken(code)) {
      run(`UPDATE barcode_seq SET next_n = ? WHERE id = 1`, n);
      return code;
    }
  }
}
function copyPicture(fromFile, toId) {
  if (!fromFile) return null;
  const src = path.join(imgDir, fromFile);
  if (!fs.existsSync(src)) return null;
  const name = `${toId}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  fs.copyFileSync(src, path.join(imgDir, name));
  return name;
}
const fmtG = (g) => `${String(Number(g.toFixed(3)))} g`;

function apply() {
  const log = { at: new Date().toISOString(), barcodes: [], shakar: null, renames: [], updates: [], merge: null, created: [], skipped: [], files: [] };
  const stockTotal = () => one(`SELECT ROUND(COALESCE(SUM(qty_on_hand), 0), 3) AS s FROM stock_balances`).s;
  log.stockBefore = stockTotal();
  const user = owner();
  db.transaction(() => {
    // 1. merged-in items' barcodes -> keeper extras
    const dl = opt('dedupe-log') ? JSON.parse(fs.readFileSync(opt('dedupe-log'), 'utf8')) : { merges: [] };
    for (const m of dl.merges ?? []) {
      if (!m.keeper || !m.loser) continue;
      const L = one(`SELECT id, name, barcode, active FROM products WHERE id = ?`, m.loser.id);
      const K = one(`SELECT id, name, barcode, active FROM products WHERE id = ?`, m.keeper.id);
      if (!L || !K || L.active === 1 || !L.barcode) continue;
      if (one(`SELECT 1 FROM product_barcodes WHERE barcode = ?`, L.barcode)) continue;
      run(`UPDATE products SET barcode = NULL, updated_at = datetime('now') WHERE id = ?`, L.id);
      run(`INSERT INTO product_barcodes (barcode, product_id) VALUES (?, ?)`, L.barcode, K.id);
      log.barcodes.push({ code: L.barcode, from: { id: L.id, name: L.name }, to: { id: K.id, name: K.name } });
    }
    // 2. Shakar price
    const sh = byName(SHAKAR.name);
    if (sh && sh.price_paisa !== SHAKAR.pricePaisa) {
      run(`UPDATE products SET price_paisa = ?, updated_at = datetime('now') WHERE id = ?`, SHAKAR.pricePaisa, sh.id);
      if (user) run(`UPDATE price_history SET changed_by = ? WHERE product_id = ? AND changed_by IS NULL`, user, sh.id);
      log.shakar = { id: sh.id, name: sh.name, before: sh.price_paisa, after: SHAKAR.pricePaisa };
    }
    // 3a. merge "Lays Salted 30 g" into "Lays 50" (before renaming)
    const K = byName(LAYS_MERGE.keeper);
    const L = byName(LAYS_MERGE.loser);
    if (K && L) {
      const e = { keeper: { id: K.id, name: K.name, image_file: K.image_file }, loser: { id: L.id, name: L.name, barcode: L.barcode }, stockMoved: 0 };
      const lq = one(`SELECT qty_on_hand AS q FROM stock_balances WHERE product_id = ?`, L.id)?.q ?? 0;
      if (lq !== 0) {
        const kq = one(`SELECT qty_on_hand AS q FROM stock_balances WHERE product_id = ?`, K.id)?.q ?? 0;
        run(`UPDATE stock_balances SET qty_on_hand = 0, updated_at = datetime('now') WHERE product_id = ?`, L.id);
        run(`INSERT INTO stock_balances (product_id, qty_on_hand, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(product_id) DO UPDATE SET qty_on_hand = excluded.qty_on_hand`, K.id, kq + lq);
        const ins = db.prepare(`INSERT INTO stock_adjustments (id, product_id, delta_pieces, qty_before, qty_after, reason, created_by, note) VALUES (?, ?, ?, ?, ?, 'merge', ?, ?)`);
        ins.run(crypto.randomUUID(), L.id, -lq, lq, 0, user, `Merged into ${LAYS_RENAME[K.name]}`);
        ins.run(crypto.randomUUID(), K.id, lq, kq, kq + lq, user, `Merged from ${L.name}`);
        e.stockMoved = lq;
      }
      run(`UPDATE products SET active = 0, barcode = NULL, updated_at = datetime('now') WHERE id = ?`, L.id);
      if (L.barcode) run(`INSERT INTO product_barcodes (barcode, product_id) VALUES (?, ?)`, L.barcode, K.id);
      if (!K.image_file && L.image_file) {
        const f = copyPicture(L.image_file, K.id);
        if (f) {
          run(`UPDATE products SET image_file = ? WHERE id = ?`, f, K.id);
          log.files.push(f);
          e.image = f;
        }
      }
      log.merge = e;
    }
    // 3b. rename + tidy existing Lays
    for (const [from, to] of Object.entries(LAYS_RENAME)) {
      const p = byName(from);
      if (!p || byName(to)) continue;
      run(`UPDATE products SET name = ?, updated_at = datetime('now') WHERE id = ?`, to, p.id);
      log.renames.push({ id: p.id, before: from, after: to });
    }
    for (const p of all(`SELECT id, name, unit_label, fixed_price, buy_unit, buy_unit_source, buy_measure FROM products WHERE active = 1 AND name LIKE 'Lays %'`)) {
      if (p.unit_label === 'packet' && p.fixed_price === 1 && p.buy_measure === 'carton' && p.buy_unit === 'carton') continue;
      run(`UPDATE products SET unit_label = 'packet', fixed_price = 1, buy_measure = 'carton', buy_unit = 'carton', buy_unit_source = COALESCE(buy_unit_source, 'manual'), updated_at = datetime('now') WHERE id = ?`, p.id);
      log.updates.push({ id: p.id, name: p.name, before: p });
    }
    // 3c. new flavour x price items
    for (const [flavour, g, rs] of LAYS_NEW) {
      const name = `Lays ${flavour} ${fmtG(g)}`;
      if (byName(name)) {
        log.skipped.push({ name, why: 'exists' });
        continue;
      }
      // Same flavour at the same printed price already stocked (older pack weight): do not add a twin.
      const rx = new RegExp(`^Lays ${flavour.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+(\\.\\d+)? g$`);
      const same = all(`SELECT name FROM products WHERE active = 1 AND price_paisa = ? AND name LIKE 'Lays %'`, rs * 100).find((r) => rx.test(r.name));
      if (same) {
        log.skipped.push({ name, why: `same flavour + price already: ${same.name}` });
        continue;
      }
      const id = crypto.randomUUID();
      const code = allocate();
      const units = CARTON[rs] ?? null;
      run(
        `INSERT INTO products (id, name, unit_label, price_paisa, pieces_per_carton, barcode, active, fixed_price, product_type, type_source, buy_unit, buy_unit_source, buy_measure)
         VALUES (?, ?, 'packet', ?, ?, ?, 1, 1, 'normal', 'manual', 'carton', 'manual', 'carton')`,
        id, name, rs * 100, units ?? 1, code,
      );
      run(`INSERT INTO stock_balances (product_id, qty_on_hand, updated_at) VALUES (?, 0, datetime('now'))`, id);
      if (units) run(`INSERT INTO product_packs (id, product_id, name, units, sort) VALUES (?, ?, 'Carton', ?, 0)`, crypto.randomUUID(), id, units);
      let image = null;
      const pic = FLAVOUR_PICTURE[flavour] ? byName(FLAVOUR_PICTURE[flavour]) : null;
      if (pic?.image_file) {
        image = copyPicture(pic.image_file, id);
        if (image) {
          run(`UPDATE products SET image_file = ? WHERE id = ?`, image, id);
          log.files.push(image);
        }
      }
      log.created.push({ id, name, flavour, grams: g, price_rs: rs, barcode: code, carton: units, image });
    }
    log.stockAfter = stockTotal();
    if (log.stockAfter !== log.stockBefore) throw new Error(`stock changed ${log.stockBefore} -> ${log.stockAfter}`);
  })();
  fs.writeFileSync(opt('log'), JSON.stringify(log, null, 2));
  return log;
}

function undo() {
  const log = JSON.parse(fs.readFileSync(opt('log'), 'utf8'));
  const out = { removed: 0, deactivated: 0, renames: 0, barcodes: 0 };
  db.transaction(() => {
    for (const c of [...log.created].reverse()) {
      const used = one(`SELECT (SELECT COUNT(*) FROM sale_lines WHERE product_id = ?) + (SELECT COUNT(*) FROM purchase_lines WHERE product_id = ?) + (SELECT COUNT(*) FROM purchase_order_lines WHERE product_id = ?) + (SELECT COUNT(*) FROM stock_receives WHERE product_id = ?) AS n`, c.id, c.id, c.id, c.id).n;
      if (used) {
        run(`UPDATE products SET active = 0 WHERE id = ?`, c.id);
        out.deactivated += 1;
        continue;
      }
      for (const t of ['product_packs', 'product_barcodes', 'price_history', 'stock_adjustments', 'stock_balances', 'supplier_product_pack', 'product_type_review']) run(`DELETE FROM ${t} WHERE product_id = ?`, c.id);
      run(`DELETE FROM products WHERE id = ?`, c.id);
      if (c.image) fs.rmSync(path.join(imgDir, c.image), { force: true });
      out.removed += 1;
    }
    for (const u of [...log.updates].reverse())
      run(`UPDATE products SET unit_label = ?, fixed_price = ?, buy_unit = ?, buy_unit_source = ?, buy_measure = ? WHERE id = ?`, u.before.unit_label, u.before.fixed_price, u.before.buy_unit, u.before.buy_unit_source, u.before.buy_measure, u.id);
    for (const r of [...log.renames].reverse()) out.renames += run(`UPDATE products SET name = ? WHERE id = ? AND name = ?`, r.before, r.id, r.after).changes;
    const m = log.merge;
    if (m) {
      if (m.loser.barcode) run(`DELETE FROM product_barcodes WHERE barcode = ? AND product_id = ?`, m.loser.barcode, m.keeper.id);
      run(`UPDATE products SET active = 1, barcode = ? WHERE id = ?`, m.loser.barcode, m.loser.id);
      if (m.stockMoved) {
        run(`UPDATE stock_balances SET qty_on_hand = qty_on_hand - ? WHERE product_id = ?`, m.stockMoved, m.keeper.id);
        run(`UPDATE stock_balances SET qty_on_hand = qty_on_hand + ? WHERE product_id = ?`, m.stockMoved, m.loser.id);
      }
      if (m.image) {
        run(`UPDATE products SET image_file = ? WHERE id = ?`, m.keeper.image_file, m.keeper.id);
        fs.rmSync(path.join(imgDir, m.image), { force: true });
      }
    }
    if (log.shakar) run(`UPDATE products SET price_paisa = ? WHERE id = ?`, log.shakar.before, log.shakar.id);
    for (const b of [...log.barcodes].reverse()) {
      run(`DELETE FROM product_barcodes WHERE barcode = ? AND product_id = ?`, b.code, b.to.id);
      run(`UPDATE products SET barcode = ? WHERE id = ? AND barcode IS NULL`, b.code, b.from.id);
      out.barcodes += 1;
    }
  })();
  return out;
}

const res = mode === 'apply' ? apply() : undo();
console.log(
  JSON.stringify(
    mode === 'apply'
      ? { barcodes: res.barcodes.length, shakar: !!res.shakar, merged: !!res.merge, renamed: res.renames.length, updated: res.updates.length, created: res.created.length, skipped: res.skipped.length, stock: [res.stockBefore, res.stockAfter] }
      : res,
  ),
);
db.close();
