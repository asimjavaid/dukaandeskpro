#!/usr/bin/env node
/**
 * Merge duplicate products and tidy size wording in names. Repeatable; every change is logged and can be undone.
 *
 *   node scripts/dedupe-names.cjs plan  --db <sqlite> [--out plan.json]
 *   node scripts/dedupe-names.cjs apply --db <sqlite> --log <log.json>
 *   node scripts/dedupe-names.cjs undo  --db <sqlite> --log <log.json>
 *
 * Merge: keeper = more history (sales, bills, receives, repacks, orders), then a real barcode, then the better name.
 * Loser's stock moves into the keeper (stock_adjustments "merge" rows), its packs / supplier packs / open-order lines /
 * Packed-from link move over when safe, then it is marked inactive (never deleted). Keeper's price stays.
 * Rename: sizes only ("0.5 kg" → "500 g", "500g" → "500 g", "1.5 litre" → "1.5 L"). Prices, barcodes, stock, kg per pack untouched.
 * Run with cwd apps/api (better-sqlite3 lives there) after `pnpm --filter @dukaandeskpro/api build`.
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const api = path.join(__dirname, '..', 'apps', 'api');
const Database = require(require.resolve('better-sqlite3', { paths: [api, process.cwd()] }));
const { sizeName } = require(path.join(api, 'dist', 'catalog', 'size-names.js'));

const args = process.argv.slice(2);
const mode = args[0];
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!['plan', 'apply', 'undo'].includes(mode) || !opt('db')) {
  console.error('usage: dedupe-names.cjs plan|apply|undo --db <file> [--log <file>] [--out <file>]');
  process.exit(2);
}

const SPELL = { shakkar: 'shakar', chini: 'cheeni', daal: 'dal' };
/** Words that do not make a different product on their own. */
const SOFT = new Set(['cheese', 'washed']);
const PACKAGING = new Set(['pouch', 'tin', 'bottle', 'sachet', 'can', 'jar', 'box', 'family', 'pack', 'tray']);
/** Words that make a different variant (Lays Wavy / Masala Twist / Maxx are their own lines). */
const VARIANT = new Set(['wavy', 'twist', 'maxx', 'jumbo']);
/** Pairs confirmed as different products (scripts/dedupe-not-duplicates.json, or --not-dup <file>). */
function loadNotDup() {
  const f = opt('not-dup') ?? path.join(__dirname, 'dedupe-not-duplicates.json');
  if (!fs.existsSync(f)) return { pair: () => false, solo: () => false };
  const pairs = JSON.parse(fs.readFileSync(f, 'utf8')).pairs ?? [];
  const P = new Set(pairs.filter((x) => x.b).map((x) => [x.a.id, x.b.id].sort().join()));
  const S = new Set(pairs.filter((x) => !x.b).map((x) => x.a.id));
  return { pair: (a, b) => P.has([a, b].sort().join()), solo: (a) => S.has(a) };
}
const SIZE_RX = /(\d+(?:\.\d+)?) (g|kg|ml|L)\b/;

function sizeOf(name) {
  const m = SIZE_RX.exec(sizeName(name));
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2];
  return u === 'g' ? { kind: 'w', v: n / 1000 } : u === 'kg' ? { kind: 'w', v: n } : u === 'ml' ? { kind: 'v', v: n / 1000 } : { kind: 'v', v: n };
}
function words(name) {
  return sizeName(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(SIZE_RX, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SPELL[w] ?? w);
}
function key(p) {
  const s = sizeOf(p.name);
  const w = words(p.name).filter((x) => !SOFT.has(x));
  return `${p.product_type === 'bulk' ? 'B' : 'S'}|${w.join(' ')}|${s ? `${s.kind}${+s.v.toFixed(4)}` : '-'}`;
}
const realBarcode = (b) => !!b && !/^20\d{11}$/.test(String(b));
const fraction = (u) => ['kg', 'litre', 'gram', 'ml'].includes(String(u ?? '').toLowerCase());

function load(db) {
  const has = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  const hist = [
    ['sale_lines', 'product_id'],
    ['purchase_lines', 'product_id'],
    ['stock_receives', 'product_id'],
    ['repack_lines', 'product_id'],
    ['repacks', 'bulk_product_id'],
    ['purchase_order_lines', 'product_id'],
    ['sale_return_lines', 'product_id'],
    ['supplier_return_lines', 'product_id'],
  ].filter(([t]) => has(t));
  const histSql = hist.map(([t, c]) => `(SELECT COUNT(*) FROM ${t} WHERE ${c} = p.id)`).join(' + ');
  return db
    .prepare(
      `SELECT p.id, p.name, p.unit_label, p.price_paisa, p.active, p.barcode, p.product_type, p.repack_from_id, p.size_qty, p.size_group_id,
              COALESCE(sb.qty_on_hand, 0) AS qty, ${histSql} AS hist
       FROM products p LEFT JOIN stock_balances sb ON sb.product_id = p.id ORDER BY p.name COLLATE NOCASE`,
    )
    .all();
}

function plan(db) {
  const all = load(db);
  const active = all.filter((p) => p.active === 1);
  const byId = new Map(all.map((p) => [p.id, p]));
  const groups = new Map();
  for (const p of active) {
    const k = key(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const merges = [];
  const review = [];
  const notDup = loadNotDup();
  const nameScore = (p) => (sizeName(p.name) === p.name ? 2 : 0) + (words(p.name).every((w, i) => w === sizeName(p.name).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(SIZE_RX, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)[i]) ? 1 : 0);
  for (const [k, ps] of groups) {
    if (ps.length < 2) continue;
    const sorted = [...ps].sort(
      (a, b) => b.hist - a.hist || Number(realBarcode(b.barcode)) - Number(realBarcode(a.barcode)) || nameScore(b) - nameScore(a) || b.qty - a.qty || a.name.localeCompare(b.name),
    );
    const keeper = sorted[0];
    for (const loser of sorted.slice(1)) {
      if (notDup.pair(keeper.id, loser.id)) continue;
      if (fraction(keeper.unit_label) !== fraction(loser.unit_label)) {
        review.push({ kind: 'units differ', a: keeper, b: loser, note: `${keeper.unit_label} vs ${loser.unit_label}; not merged` });
        continue;
      }
      const diff = keeper.price_paisa && loser.price_paisa ? Math.abs(keeper.price_paisa - loser.price_paisa) / Math.min(keeper.price_paisa, loser.price_paisa) : 0;
      merges.push({ key: k, keeper, loser, priceConflict: diff >= 0.15 });
    }
  }
  // Near matches: same size, one name's words inside the other's (or no size at all) → listed, never merged.
  const merged = new Set(merges.map((m) => m.loser.id));
  const pool = active.filter((p) => !merged.has(p.id) && p.product_type !== 'bulk');
  const seen = new Set();
  for (const a of pool) {
    const wa = words(a.name);
    const sa = sizeOf(a.name);
    for (const b of pool) {
      if (a.id >= b.id) continue;
      if (key(a) === key(b)) continue;
      const wb = words(b.name);
      const sb = sizeOf(b.name);
      const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
      if (small.length < 2 || !small.every((w) => big.includes(w))) continue;
      // Pouch vs bottle, tea bags vs loose tea, family packs: meant to be different.
      const extra = big.filter((w) => !small.includes(w));
      if (notDup.pair(a.id, b.id)) continue;
      if (extra.some((w) => PACKAGING.has(w) || VARIANT.has(w)) || /\b\d+ (pcs|bags)\b|\bbags?\b/i.test(a.name + ' ' + b.name)) continue;
      if (small[0] !== big[0] && !big.join(' ').includes(small.join(' '))) continue;
      let why = null;
      if (sa && sb && sa.kind === sb.kind && Math.abs(sa.v - sb.v) / Math.max(sa.v, sb.v) < 1e-6) why = 'same size, extra words';
      else if (sa && sb && sa.kind === sb.kind && Math.abs(sa.v - sb.v) / Math.max(sa.v, sb.v) <= 0.1) why = 'nearly same size';
      else if (!sa !== !sb && (a.hist > 0 || b.hist > 0)) why = 'one has no size';
      if (!why) continue;
      const id = [a.id, b.id].sort().join();
      if (seen.has(id)) continue;
      seen.add(id);
      review.push({ kind: why, a, b, note: '' });
    }
  }
  // Generic names with no size and no clear twin (e.g. "Lays 50").
  for (const p of active) {
    if (p.product_type === 'bulk' || sizeOf(p.name) || merged.has(p.id)) continue;
    if (/^lays \d+$/i.test(p.name.trim())) {
      if (p.qty === 0 && p.hist === 0) merges.push({ key: 'generic', keeper: null, loser: p, priceConflict: false, deactivateOnly: true });
      else review.push({ kind: 'generic name', a: p, b: null, note: `stock ${p.qty}, history ${p.hist}; kept active` });
      continue;
    }
    // No size in the name but sold / bought, and a sized item of the same brand + kind exists.
    if (notDup.solo(p.id)) continue;
    const w = words(p.name);
    if (p.hist === 0 || w.length < 2 || /\d+ (pcs|bags)|pads|\(\d+\)/i.test(p.name)) continue;
    const twins = active.filter((q) => q.id !== p.id && q.product_type !== 'bulk' && sizeOf(q.name) && words(q.name)[0] === w[0] && words(q.name).includes(w[w.length - 1]));
    if (twins.length) review.push({ kind: 'no size in name', a: p, b: twins[0], note: `also: ${twins.slice(1).map((q) => q.name).join(', ') || '-'}` });
  }
  // Barcode clashes with another product's pack barcode.
  for (const r of db
    .prepare(
      `SELECT p.id AS a, q.id AS b FROM products p JOIN product_packs pp ON pp.barcode = p.barcode AND pp.active = 1 JOIN products q ON q.id = pp.product_id
       WHERE p.active = 1 AND q.active = 1 AND p.id <> q.id`,
    )
    .all())
    review.push({ kind: 'same barcode (pack)', a: byId.get(r.a), b: byId.get(r.b), note: '' });

  const renames = [];
  for (const p of all) {
    const to = sizeName(p.name);
    if (to !== p.name) renames.push({ id: p.id, before: p.name, after: to, active: p.active });
  }
  return { merges, renames, review };
}

function ownerId(db) {
  const u = db.prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'owner' AND u.disabled_at IS NULL ORDER BY u.created_at LIMIT 1`).get() ?? db.prepare(`SELECT id FROM users ORDER BY created_at LIMIT 1`).get();
  if (!u) throw new Error('no user for stock_adjustments');
  return u.id;
}

function apply(db, logPath) {
  const p = plan(db);
  const log = { at: new Date().toISOString(), db: opt('db'), totals: {}, merges: [], renames: [], review: p.review.map(slimReview) };
  const totalStock = () => db.prepare(`SELECT COALESCE(SUM(qty_on_hand), 0) AS s FROM stock_balances sb JOIN products p ON p.id = sb.product_id`).get().s;
  const activeCount = () => db.prepare(`SELECT COUNT(*) AS n FROM products WHERE active = 1`).get().n;
  log.totals.before = { stock: totalStock(), active: activeCount() };
  const user = ownerId(db);
  const qtyOf = (id) => db.prepare(`SELECT qty_on_hand AS q FROM stock_balances WHERE product_id = ?`).get(id)?.q ?? 0;
  const setQty = (id, q) => {
    db.prepare(`INSERT INTO stock_balances (product_id, qty_on_hand, updated_at) VALUES (?, ?, datetime('now'))
                ON CONFLICT(product_id) DO UPDATE SET qty_on_hand = excluded.qty_on_hand, updated_at = excluded.updated_at`).run(id, q);
  };
  const adj = (id, before, after, note) => {
    if (before === after) return null;
    const aid = crypto.randomUUID();
    db.prepare(
      `INSERT INTO stock_adjustments (id, product_id, delta_pieces, qty_before, qty_after, reason, created_by, note, unit_cost_paisa)
       VALUES (?, ?, ?, ?, ?, 'merge', ?, ?, (SELECT last_unit_cost_paisa FROM products WHERE id = ?))`,
    ).run(aid, id, after - before, before, after, user, note, id);
    return aid;
  };
  const r3 = (n) => Math.round(n * 1000) / 1000;

  db.transaction(() => {
    for (const m of p.merges) {
      const L = m.loser;
      const e = { keeper: m.keeper && { id: m.keeper.id, name: m.keeper.name, price_paisa: m.keeper.price_paisa }, loser: { id: L.id, name: L.name, price_paisa: L.price_paisa }, priceConflict: m.priceConflict, deactivateOnly: !!m.deactivateOnly, ops: [] };
      if (m.keeper) {
        const K = m.keeper;
        const lq = qtyOf(L.id);
        const kq = qtyOf(K.id);
        e.stock = { keeperBefore: kq, loserBefore: lq };
        if (lq !== 0) {
          const kAfter = r3(kq + lq);
          if (kAfter < 0) throw new Error(`merge would make ${K.name} negative`);
          const a1 = adj(L.id, lq, 0, `Merged into ${K.name}`);
          setQty(L.id, 0);
          const a2 = adj(K.id, kq, kAfter, `Merged from ${L.name}`);
          setQty(K.id, kAfter);
          e.ops.push({ op: 'stock', loser: L.id, keeper: K.id, qty: lq, adjIds: [a1, a2].filter(Boolean) });
        }
        e.stock.keeperAfter = qtyOf(K.id);
        e.stock.loserAfter = qtyOf(L.id);
        // Packed-from link: keeper takes it when it has none and the pack size matches its name.
        const kRow = db.prepare(`SELECT product_type, type_source, repack_from_id, size_qty FROM products WHERE id = ?`).get(K.id);
        if (L.repack_from_id && !kRow.repack_from_id && kRow.product_type !== 'bulk') {
          const ks = sizeOf(K.name);
          const safe = !ks || (ks.kind === 'w' && Math.abs(ks.v - Number(L.size_qty)) < 1e-6);
          if (safe && Number(L.size_qty) > 0) {
            db.prepare(`UPDATE products SET product_type = 'packed', repack_from_id = ?, size_qty = ?, type_source = 'manual', updated_at = datetime('now') WHERE id = ?`).run(L.repack_from_id, L.size_qty, K.id);
            e.ops.push({ op: 'packedFrom', id: K.id, before: kRow, after: { product_type: 'packed', repack_from_id: L.repack_from_id, size_qty: L.size_qty } });
          } else e.ops.push({ op: 'note', text: 'Packed-from link not moved (size differs)' });
        }
        // Items packed from the loser (loser was loose) → packed from keeper.
        if (L.product_type === 'bulk' && K.product_type === 'bulk') {
          const kids = db.prepare(`SELECT id FROM products WHERE repack_from_id = ?`).all(L.id).map((r) => r.id);
          for (const id of kids) db.prepare(`UPDATE products SET repack_from_id = ? WHERE id = ?`).run(K.id, id);
          if (kids.length) e.ops.push({ op: 'children', ids: kids, from: L.id, to: K.id });
        }
        // Packs: move unless the keeper already has one with that name.
        for (const pk of db.prepare(`SELECT id, name FROM product_packs WHERE product_id = ?`).all(L.id)) {
          const dup = db.prepare(`SELECT 1 FROM product_packs WHERE product_id = ? AND lower(name) = lower(?) AND active = 1`).get(K.id, pk.name);
          if (dup) continue;
          db.prepare(`UPDATE product_packs SET product_id = ? WHERE id = ?`).run(K.id, pk.id);
          e.ops.push({ op: 'pack', id: pk.id, from: L.id, to: K.id });
        }
        // Supplier remembered packs.
        for (const sp of db.prepare(`SELECT * FROM supplier_product_pack WHERE product_id = ?`).all(L.id)) {
          if (db.prepare(`SELECT 1 FROM supplier_product_pack WHERE product_id = ? AND supplier_id = ?`).get(K.id, sp.supplier_id)) continue;
          db.prepare(`UPDATE supplier_product_pack SET product_id = ? WHERE product_id = ? AND supplier_id = ?`).run(K.id, L.id, sp.supplier_id);
          e.ops.push({ op: 'supplierPack', supplier: sp.supplier_id, from: L.id, to: K.id });
        }
        // Lines on orders not yet received.
        for (const ol of db
          .prepare(`SELECT l.id, l.order_id FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.order_id WHERE l.product_id = ? AND o.status IN ('draft', 'sent', 'partial')`)
          .all(L.id)) {
          if (db.prepare(`SELECT 1 FROM purchase_order_lines WHERE order_id = ? AND product_id = ?`).get(ol.order_id, K.id)) {
            e.ops.push({ op: 'note', text: `open order ${ol.order_id} has both; line left on ${L.name}` });
            continue;
          }
          db.prepare(`UPDATE purchase_order_lines SET product_id = ? WHERE id = ?`).run(K.id, ol.id);
          e.ops.push({ op: 'orderLine', id: ol.id, from: L.id, to: K.id });
        }
        if (realBarcode(L.barcode)) e.ops.push({ op: 'note', text: `loser barcode ${L.barcode} stays on the inactive item (no extra-barcode field)` });
      }
      db.prepare(`UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?`).run(L.id);
      e.ops.push({ op: 'deactivate', id: L.id });
      log.merges.push(e);
    }
    for (const r of p.renames) {
      db.prepare(`UPDATE products SET name = ?, updated_at = datetime('now') WHERE id = ? AND name = ?`).run(r.after, r.id, r.before);
      log.renames.push(r);
    }
    log.totals.after = { stock: totalStock(), active: activeCount() };
    if (Math.abs(log.totals.after.stock - log.totals.before.stock) > 1e-6) throw new Error(`total stock changed ${log.totals.before.stock} → ${log.totals.after.stock}`);
  })();
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  return log;
}

function undo(db, logPath) {
  const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  const out = { renames: 0, reactivated: 0, stockBack: 0 };
  db.transaction(() => {
    for (const r of [...log.renames].reverse()) out.renames += db.prepare(`UPDATE products SET name = ?, updated_at = datetime('now') WHERE id = ? AND name = ?`).run(r.before, r.id, r.after).changes;
    for (const e of [...log.merges].reverse()) {
      for (const o of [...e.ops].reverse()) {
        if (o.op === 'deactivate') out.reactivated += db.prepare(`UPDATE products SET active = 1, updated_at = datetime('now') WHERE id = ?`).run(o.id).changes;
        else if (o.op === 'stock') {
          const kq = db.prepare(`SELECT qty_on_hand AS q FROM stock_balances WHERE product_id = ?`).get(o.keeper)?.q ?? 0;
          const back = Math.round((kq - o.qty) * 1000) / 1000;
          if (back < 0) throw new Error(`cannot move ${o.qty} back from ${e.keeper.name}: only ${kq} left`);
          db.prepare(`UPDATE stock_balances SET qty_on_hand = ?, updated_at = datetime('now') WHERE product_id = ?`).run(back, o.keeper);
          db.prepare(`UPDATE stock_balances SET qty_on_hand = qty_on_hand + ?, updated_at = datetime('now') WHERE product_id = ?`).run(o.qty, o.loser);
          const user = ownerId(db);
          const ins = db.prepare(`INSERT INTO stock_adjustments (id, product_id, delta_pieces, qty_before, qty_after, reason, created_by, note) VALUES (?, ?, ?, ?, ?, 'merge_undo', ?, ?)`);
          ins.run(crypto.randomUUID(), o.keeper, -o.qty, kq, back, user, `Undo merge of ${e.loser.name}`);
          const lq = db.prepare(`SELECT qty_on_hand AS q FROM stock_balances WHERE product_id = ?`).get(o.loser).q;
          ins.run(crypto.randomUUID(), o.loser, o.qty, lq - o.qty, lq, user, `Undo merge into ${e.keeper.name}`);
          out.stockBack += 1;
        } else if (o.op === 'packedFrom')
          db.prepare(`UPDATE products SET product_type = ?, repack_from_id = ?, size_qty = ?, type_source = ? WHERE id = ?`).run(o.before.product_type, o.before.repack_from_id, o.before.size_qty, o.before.type_source, o.id);
        else if (o.op === 'children') for (const id of o.ids) db.prepare(`UPDATE products SET repack_from_id = ? WHERE id = ?`).run(o.from, id);
        else if (o.op === 'pack') db.prepare(`UPDATE product_packs SET product_id = ? WHERE id = ?`).run(o.from, o.id);
        else if (o.op === 'supplierPack') db.prepare(`UPDATE supplier_product_pack SET product_id = ? WHERE product_id = ? AND supplier_id = ?`).run(o.from, o.to, o.supplier);
        else if (o.op === 'orderLine') db.prepare(`UPDATE purchase_order_lines SET product_id = ? WHERE id = ?`).run(o.from, o.id);
      }
    }
  })();
  return out;
}

const slim = (p) => p && { id: p.id, name: p.name, unit: p.unit_label, price_rs: p.price_paisa / 100, stock: p.qty, history: p.hist, barcode: p.barcode, type: p.product_type };
const slimReview = (r) => ({ kind: r.kind, a: slim(r.a), b: slim(r.b), note: r.note });

const db = new Database(opt('db'), { readonly: mode === 'plan' });
db.pragma('foreign_keys = ON');
if (mode === 'plan') {
  const p = plan(db);
  const o = {
    merges: p.merges.map((m) => ({ keeper: slim(m.keeper), loser: slim(m.loser), priceConflict: m.priceConflict, deactivateOnly: !!m.deactivateOnly })),
    renames: p.renames,
    review: p.review.map(slimReview),
  };
  if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(o, null, 2));
  console.log(JSON.stringify({ merges: o.merges.length, renames: o.renames.length, review: o.review.length }));
} else if (mode === 'apply') {
  if (!opt('log')) throw new Error('--log required');
  const l = apply(db, opt('log'));
  console.log(JSON.stringify({ merges: l.merges.length, renames: l.renames.length, review: l.review.length, totals: l.totals }));
} else {
  if (!opt('log')) throw new Error('--log required');
  console.log(JSON.stringify(undo(db, opt('log'))));
}
db.close();
