#!/usr/bin/env node
/** Buying units (migration 041): bulk by kg only; normal items by carton / crate / piece; package count on the order,
 * units per package on receive / bill. Acceptance: sugar 20 kg; Adams 2 carton -> receive 12 each = +24; 7up 3 crate -> 6 each = +18.
 * Also: loose staples run (create / rename / link / review), idempotent, undo, backup v13, PC catalog copy + down 041.
 * SKIP_BUILD=1 node scripts/test-buy-units.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { startApi, seed, makeChecks, root, Database } from './lib/sales-harness.mjs';

const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));
const { down } = require(path.join(root, 'packages/db/src/down.js'));
const c = makeChecks();
const { ok } = c;
const j = (r) => (r.raw ?? JSON.stringify(r)).slice(0, 300);

// ---- WhatsApp text (web poText.ts) ----
const out = path.join(os.tmpdir(), `poText-bu-${Date.now()}.mjs`);
const esbuild = createRequire(path.join(root, 'apps/web/node_modules/vite/package.json'))('esbuild');
esbuild.buildSync({ entryPoints: [path.join(root, 'apps/web/src/features/purchases/poText.ts')], bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
const { poMessage, poLineText, shopYmd } = await import(out);
fs.rmSync(out, { force: true });

const api = await startApi('buyunits', Number(process.env.API_PORT ?? 3931));
const R = api.request;
try {
  const s = await seed(api);
  const { owner, stock } = s;
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items[0];
  const mk = async (name, priceRs, unitLabel = 'piece', extra = {}) => {
    const r = await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel, ...extra } });
    if (!r.json?.ok) throw new Error(`mk ${name} ${r.raw}`);
    return r.json.product;
  };
  const prod = (id) => {
    const d = s.db();
    const v = d.prepare('SELECT * FROM products WHERE id = ?').get(id);
    d.close();
    return v;
  };

  // ---- 1. package type on create / edit ----
  const sugar = await mk('Sugar (Cheeni) Loose', 230, 'kg');
  const adams = await mk('Adams Cheddar 200 g', 450);
  const up = await mk('7up 1.5 L', 180);
  const bread = await mk('Aroma Bread Plain Large', 200);
  const can = await mk('Pepsi Slim Can 250 ml', 100);
  ok(sugar.product_type === 'bulk' && prod(sugar.id).buy_unit === null, 'kg item is bulk, no package');
  ok(adams.buy_unit === 'carton' && up.buy_unit === 'crate' && bread.buy_unit === 'piece' && can.buy_unit === 'carton', `auto package: ${adams.buy_unit} ${up.buy_unit} ${bread.buy_unit} ${can.buy_unit}`);
  let r = await R('PATCH', `/catalog/products/${bread.id}`, { token: owner, body: { buyUnit: 'carton' } });
  ok(r.json?.ok && r.json.product.buy_unit === 'carton' && prod(bread.id).buy_unit_source === 'manual', 'edit package in catalog (manual)');
  r = await R('PATCH', `/catalog/products/${bread.id}`, { token: owner, body: { buyUnit: 'box' } });
  ok(r.status === 400 && /invalid_buy_unit/.test(r.raw), 'bad package refused');
  await R('PATCH', `/catalog/products/${bread.id}`, { token: owner, body: { buyUnit: 'piece' } });
  const made = await mk('Olpers Milk 1 L', 300, 'piece', { buyUnit: 'crate' });
  ok(made.buy_unit === 'crate' && prod(made.id).buy_unit_source === 'manual', 'package given on create');

  // ---- 2. order: sugar kg only, Adams 2 carton, 7up 3 crate ----
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup.id, lines: [{ productId: sugar.id, packages: 1 }] } });
  ok(r.json?.ok === false && r.json.error === 'bulk_buys_by_kg', 'bulk cannot be ordered by package');
  r = await R('POST', '/purchase-orders', {
    token: owner,
    body: { supplierId: sup.id, lines: [{ productId: sugar.id, qty: 20 }, { productId: adams.id, packages: 2 }, { productId: up.id, packages: 3 }] },
  });
  ok(r.json?.ok, `order made ${j(r)}`);
  const po = r.json;
  const L = (id) => po.lines.find((l) => l.product_id === id);
  ok(L(sugar.id).qty_ordered === 20 && !L(sugar.id).by_package && L(sugar.id).pack_name === null && L(sugar.id).buy_unit === 'kg', 'sugar: 20 kg, no pack');
  ok(L(adams.id).by_package === 1 && L(adams.id).qty_ordered === 2 && L(adams.id).pack_name === 'Carton' && L(adams.id).pack_units === null, 'Adams: 2 carton, units not asked');
  ok(L(up.id).by_package === 1 && L(up.id).qty_ordered === 3 && L(up.id).pack_name === 'Crate', '7up: 3 crate');
  const wa = poMessage(sup.name, 'Shop', po.order.number, po.order.created_at, po.lines.map((l) =>
    l.by_package ? { name: l.product_name, qty: l.qty_ordered, unit: l.pack_name, pack: true } : { name: l.product_name, qty: l.qty_ordered, unit: l.unit_label }));
  ok(wa.includes('Sugar (Cheeni) Loose 20 kg') && wa.includes('Adams Cheddar 200 g x 2 carton') && wa.includes('7up 1.5 L x 3 crate'), `WhatsApp text:\n${wa}`);
  ok(poLineText({ name: '7up 1.5 L', qty: 3, unit: 'Crate', pack: true }) === '7up 1.5 L x 3 crate', 'line text crate');
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup.id, lines: [{ productId: adams.id, packages: 1.5 }] } });
  ok(r.json?.ok === false && r.json.error === 'invalid_qty', 'package count is whole');

  // ---- 3. receive: units per package + cost ----
  r = await R('POST', `/purchase-orders/${po.order.id}/receive`, {
    token: owner,
    body: { lines: [{ orderLineId: L(adams.id).id, packages: 2, packCostRs: 3000 }] },
  });
  ok(r.json?.ok === false && r.json.error === 'pack_units_required', 'units per carton needed on receive');
  r = await R('POST', `/purchase-orders/${po.order.id}/receive`, {
    token: owner,
    body: {
      lines: [
        { orderLineId: L(sugar.id).id, qty: 20, unitCostRs: 200 },
        { orderLineId: L(adams.id).id, packages: 2, packUnits: 12, packCostRs: 3000 },
        { orderLineId: L(up.id).id, packages: 3, packUnits: 6, lineTotalRs: 1800 },
      ],
    },
  });
  ok(r.json?.ok, `received ${j(r)}`);
  ok(stock(sugar.id) === 20 && stock(adams.id) === 24 && stock(up.id) === 18, `stock +20 kg / +24 / +18: ${stock(sugar.id)} ${stock(adams.id)} ${stock(up.id)}`);
  ok(prod(adams.id).last_unit_cost_paisa === 25000 && prod(up.id).last_unit_cost_paisa === 10000 && prod(sugar.id).last_unit_cost_paisa === 20000, 'cost per piece: Rs 250 / Rs 100; sugar Rs 200/kg');
  const got = r.json.lines;
  ok(r.json.order.status === 'received' && got.find((l) => l.product_id === adams.id).qty_received === 2 && got.find((l) => l.product_id === up.id).qty_received === 3, 'order received in packages');
  const bill = (await R('GET', `/purchases/${r.json.billId}`, { token: owner })).json;
  const bl = bill.lines.find((l) => l.product_id === adams.id);
  ok(bl.pack_name === 'Carton' && bl.pack_qty === 2 && bl.pack_units === 12 && bl.pieces === 24, 'bill line: 2 Carton x 12');

  // ---- 4. next time: units prefilled from last bill ----
  r = await R('GET', `/purchase-orders/buy-info?supplierId=${sup.id}&ids=${adams.id},${up.id},${sugar.id},${bread.id}`, { token: owner });
  const bi = r.json.byProduct;
  ok(bi[adams.id].last_pack_units === 12 && bi[adams.id].last_pack_cost_paisa === 300000 && bi[up.id].last_pack_units === 6 && bi[up.id].last_pack_cost_paisa === 60000, `prefill units/cost ${j(r)}`);
  ok(bi[sugar.id].buy_unit === 'kg' && bi[sugar.id].pack_name === null && bi[bread.id].buy_unit === 'piece', 'kg / piece have no package');
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup.id, lines: [{ productId: adams.id, packages: 1 }] } });
  const po2 = r.json;
  ok(po2.lines[0].last_pack_units === 12 && po2.lines[0].pack_units === 12, 'new order line knows 12 per carton');
  r = await R('POST', `/purchase-orders/${po2.order.id}/receive`, { token: owner, body: { lines: [{ orderLineId: po2.lines[0].id, packages: 1, packUnits: 10, packCostRs: 2600 }] } });
  ok(r.json?.ok && stock(adams.id) === 34 && prod(adams.id).last_unit_cost_paisa === 26000, 'supplier carton changed to 10: +10, Rs 260 each');

  // ---- 5. walk-in bill: count + units + cost ----
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: up.id, packages: 2, packCostRs: 600 }] } });
  ok(r.json?.ok === false && r.json.error === 'pack_units_required', 'bill needs units per crate');
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: up.id, packages: 2, packUnits: 6, packCostRs: 600 }, { productId: sugar.id, pieces: 5.5, unitCostRs: 210 }] } });
  ok(r.json?.ok && stock(up.id) === 30 && stock(sugar.id) === 25.5, `bill: +12 bottles, +5.5 kg ${j(r)}`);
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: sugar.id, packages: 1, packUnits: 50, packCostRs: 10000 }] } });
  ok(r.json?.ok === false && r.json.error === 'bulk_buys_by_kg', 'bulk not by package on bill');
  const packs = (await R('GET', `/packs?productId=${up.id}`, { token: owner })).json.items;
  ok(packs.filter((p) => p.name === 'Crate').length === 1 && packs.find((p) => p.name === 'Crate').units === 6, 'one Crate pack kept, 6 each');

  // ---- 6. low-stock suggestion counts packages ----
  await R('PATCH', `/catalog/products/${up.id}`, { token: owner, body: { reorderLevel: 40 } });
  r = await R('GET', '/purchase-orders/suggest', { token: owner });
  const sg = r.json.groups.flatMap((g) => g.items).find((i) => i.product_id === up.id);
  ok(sg && sg.by_package === true && sg.pack_name === 'Crate' && sg.pack_qty === 9 && sg.suggested_qty === 54, `suggest 9 crates ${JSON.stringify(sg)}`);

  // ---- 6b. the money box is the LINE TOTAL: rice 50 kg for Rs 15,000 -> Rs 300/kg; 7up 3 crates x 6 for Rs 5,400 -> Rs 300 each ----
  const rice = await mk('Basmati Rice Loose', 380, 'kg');
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup.id, lines: [{ productId: rice.id, qty: 50 }, { productId: up.id, packages: 3 }] } });
  const po3 = r.json;
  const L3 = (id) => po3.lines.find((l) => l.product_id === id);
  const upBefore = stock(up.id);
  // what the receive screen sends when only "Total (Rs)" is typed: cost per unit is derived, line total kept
  r = await R('POST', `/purchase-orders/${po3.order.id}/receive`, {
    token: owner,
    body: {
      lines: [
        { orderLineId: L3(rice.id).id, qty: 50, unitCostRs: 15000 / 50, lineTotalRs: 15000 },
        { orderLineId: L3(up.id).id, packages: 3, packUnits: 6, packName: 'Crate', packCostRs: 5400 / 3, lineTotalRs: 5400 },
      ],
    },
  });
  ok(r.json?.ok, `receive by totals ${j(r)}`);
  ok(stock(rice.id) === 50 && prod(rice.id).last_unit_cost_paisa === 30000, `rice 50 kg total Rs 15,000 -> Rs 300/kg (${prod(rice.id).last_unit_cost_paisa})`);
  ok(stock(up.id) === upBefore + 18 && prod(up.id).last_unit_cost_paisa === 30000, `7up 3 crates x 6 total Rs 5,400 -> Rs 300 each (${prod(up.id).last_unit_cost_paisa})`);
  {
    const bill3 = (await R('GET', `/purchases/${r.json.billId}`, { token: owner })).json;
    const rl = bill3.lines.find((l) => l.product_id === rice.id);
    const ul = bill3.lines.find((l) => l.product_id === up.id);
    ok(rl.line_total_paisa === 1500000 && rl.unit_cost_paisa === 30000 && ul.line_total_paisa === 540000 && ul.pack_qty === 3 && ul.pack_units === 6, `bill keeps supplier totals ${JSON.stringify([rl, ul].map((x) => [x.line_total_paisa, x.unit_cost_paisa]))}`);
    ok(bill3.invoice.total_paisa === 2040000 || bill3.invoice.subtotal_paisa === 2040000, `bill total Rs 20,400 ${JSON.stringify(bill3.invoice).slice(0, 200)}`);
  }
  // walk-in bill by total too
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: rice.id, pieces: 50, unitCostRs: 300, lineTotalRs: 15000 }] } });
  ok(r.json?.ok && stock(rice.id) === 100 && prod(rice.id).last_unit_cost_paisa === 30000, `bill: rice 50 kg total 15000 -> Rs 300/kg ${j(r)}`);

  ok(shopYmd('2026-10-15 21:55:00') === '2026-10-16' && shopYmd('2026-10-15 10:00:00') === '2026-10-15', 'order date shown in PKT (02:55 PKT is 16 Oct)');

  // ---- 7. loose staples run ----
  const atta = await mk('Atta', 0, 'kg');
  const m1 = await mk('Maida 1 kg', 160);
  const m5 = await mk('Maida 500 g', 85);
  const big = await mk('Atta Special 10 kg', 1500);
  r = await R('POST', '/product-types/buy-units/run', { token: owner });
  ok(r.json?.ok && r.json.renamed.some((x) => x.before === 'Atta' && x.after === 'Atta Loose'), `Atta -> Atta Loose ${j(r)}`);
  ok(r.json.created.includes('Maida Loose') && r.json.created.includes('Besan Loose') && r.json.linked.includes('Maida 1 kg') && r.json.linked.includes('Maida 500 g'), 'Maida Loose made, packets linked');
  const runId = r.json.id;
  const ml = (() => { const d = s.db(); const v = d.prepare(`SELECT * FROM products WHERE name = 'Maida Loose'`).get(); d.close(); return v; })();
  ok(ml.unit_label === 'kg' && ml.product_type === 'bulk' && ml.price_paisa === 16000 && prod(m1.id).repack_from_id === ml.id && prod(m5.id).size_qty === 0.5, 'Maida Loose kg bulk Rs 160/kg; packets 1 / 0.5 kg');
  ok(prod(big.id).product_type === 'normal' && prod(big.id).buy_unit === 'piece', 'Atta Special 10 kg stays normal, bought singly');
  r = await R('GET', '/product-types/review', { token: owner });
  ok(r.json.items.some((x) => x.name === 'Maida Loose' && x.reason === 'new_bulk_price'), 'new loose item waits in review for price');
  r = await R('POST', '/product-types/buy-units/run', { token: owner });
  ok(r.json?.ok && r.json.created.length === 0 && r.json.linked.length === 0 && r.json.changed === 0 && r.json.renamed.length === 0, `second run changes nothing ${j(r)}`);
  r = await R('POST', `/product-types/buy-units/runs/${runId}/undo`, { token: owner });
  ok(r.json?.ok && prod(atta.id).name === 'Atta' && prod(m1.id).product_type === 'normal' && prod(m1.id).repack_from_id === null && prod(ml.id).active === 0, 'undo: name, links, new item off');

  // ---- 8. backup v13 ----
  const ex = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const b = ex.json?.bundle ?? ex.json;
  ok(b.header.schema_version === 16 && b.batch2.buying.products.length >= 5 && b.batch2.buying.order_lines.length >= 3 && b.batch2.buying.runs.length === 2, `bundle v13 buying ${JSON.stringify(b.batch2.buying).slice(0, 160)}`);
  await R('PATCH', `/catalog/products/${adams.id}`, { token: owner, body: { buyUnit: 'piece' } });
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: b } });
  ok(r.json?.ok, `restore ${j(r)}`);
  const d = s.db();
  const pa = d.prepare('SELECT buy_unit, buy_unit_source FROM products WHERE id = ?').get(adams.id);
  const pl = d.prepare('SELECT by_package FROM purchase_order_lines WHERE id = ?').get(L(up.id).id);
  d.close();
  ok(pa.buy_unit === 'carton' && pl.by_package === 1, 'restore brings packages back');
} finally {
  api.stop();
}

// ---- B. Shop catalog copy (PC, 16 Oct): migrate twice, first start sorts once, undo, down 041 ----
const pcSrc = '/workspace/pu/pc-final.sqlite';
// Lite/PostgreSQL: P1 .sqlite upgrade + SQLite down-migrations do not apply (P1 migrations are squashed into
// baseline.sql); upgrading a P1 shop copy is covered by scripts/test-import-p1.mjs instead.
const IS_PG = process.env.DD_DB === 'pg' || !!process.env.DATABASE_URL;
if (IS_PG) console.log('skip pc part on PostgreSQL (covered by test-import-p1)');
else if (fs.existsSync(pcSrc)) {
  const dbPath = path.join(os.tmpdir(), `dd-bu-pc-${Date.now()}.sqlite`);
  fs.copyFileSync(pcSrc, dbPath);
  const snap = () => {
    const d = new Database(dbPath, { readonly: true });
    const rows = d.prepare(`SELECT p.id, p.barcode, p.price_paisa, p.active, COALESCE(s.qty_on_hand,0) q FROM products p LEFT JOIN stock_balances s ON s.product_id = p.id`).all();
    d.close();
    return new Map(rows.map((x) => [x.id, x]));
  };
  const before = snap();
  migrate(dbPath);
  migrate(dbPath);
  let d = new Database(dbPath);
  ok(d.prepare(`SELECT COUNT(*) n FROM schema_migrations WHERE id = '041_buy_units.sql'`).get().n === 1, 'pc: 041 applied once');
  d.close();
  const boot = async (port) => {
    const child = spawn('node', [path.join(root, 'apps/api/dist/main.js')], {
      cwd: path.join(root, 'apps/api'),
      env: { ...process.env, API_PORT: String(port), SQLITE_PATH: dbPath, SESSION_SECRET: 'bu', TAX_PROCESS_INTERVAL_MS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const health = () => new Promise((res) => http.get({ host: '127.0.0.1', port, path: '/health' }, (x) => { x.resume(); res(x.statusCode); }).on('error', () => res(0)));
    for (let i = 0; i < 240 && (await health()) !== 200; i++) await new Promise((x) => setTimeout(x, 250));
    await new Promise((x) => setTimeout(x, 500));
    child.kill('SIGTERM');
    await new Promise((x) => child.on('exit', x));
  };
  await boot(3932);
  await boot(3932); // second start: no second run
  d = new Database(dbPath);
  const runs = d.prepare(`SELECT id, changes_json FROM buy_unit_runs`).all();
  ok(runs.length === 1, `pc: sorted once (${runs.length})`);
  const log = JSON.parse(runs[0].changes_json);
  const name = (id) => d.prepare('SELECT name FROM products WHERE id = ?').get(id).name;
  const created = log.created.map(name);
  console.log('pc created', created.join(', '));
  console.log('pc linked', log.linked.map((l) => name(l.id)).join(', '));
  const counts = Object.fromEntries(d.prepare(`SELECT COALESCE(buy_unit, product_type) u, COUNT(*) n FROM products WHERE active = 1 GROUP BY 1`).all().map((x) => [x.u, x.n]));
  console.log('pc counts', JSON.stringify(counts), 'uncertain', log.uncertain.length);
  ok(['Maida Loose', 'Sabudana Loose', 'Khaand Loose', 'Shakar Loose'].every((n) => created.includes(n)), 'pc: Maida / Sabudana / Khaand / Shakar Loose added');
  ok(d.prepare(`SELECT product_type t, unit_label u FROM products WHERE name = 'Atta Loose' AND active = 1`).get()?.t === 'bulk' && !d.prepare(`SELECT 1 FROM products WHERE name = 'Atta' AND active = 1`).get(), 'pc: Atta renamed Atta Loose');
  const linkOf = (n) => d.prepare(`SELECT b.name FROM products p JOIN products b ON b.id = p.repack_from_id WHERE p.name = ? AND p.active = 1`).get(n)?.name;
  ok(linkOf('Maida 1 kg') === 'Maida Loose' && linkOf('Shakkar 500g') === 'Shakar Loose' && linkOf('Khaand (Muscovado Sugar) 800 g') === 'Khaand Loose' && linkOf('Sabudana 1 kg') === 'Sabudana Loose', 'pc: packets linked to new loose items');
  ok(d.prepare(`SELECT COUNT(*) n FROM products WHERE active = 1 AND product_type = 'normal' AND buy_unit IS NULL`).get().n === 0, 'pc: every normal item has a package');
  const bu = (n) => d.prepare('SELECT buy_unit FROM products WHERE name = ? AND active = 1').get(n)?.buy_unit;
  ok(bu('Adams Cheddar 200 g') === 'carton' && bu('7Up 1.5 L') === 'crate' && bu('Aroma Bread Plain Large') === 'piece' && bu('Coca-Cola Can 250 ml') === 'carton' && bu('Nestle Pure Life 500 ml') === 'crate', 'pc: Adams carton, 7up crate, bread piece, can carton, water crate');
  const open = d.prepare(`SELECT p.name FROM product_type_review r JOIN products p ON p.id = r.product_id WHERE r.resolved_at IS NULL AND p.active = 1`).all().map((x) => x.name);
  ok(!open.includes('Maida 1 kg') && !open.includes('Atta Special 10 kg') && open.includes('Daal Mash 500 g'), `pc: review settled where sure (${open.length} open)`);
  const after = snap();
  let changed = 0;
  for (const [id, x] of before) {
    const a = after.get(id);
    if (!a || a.barcode !== x.barcode || a.price_paisa !== x.price_paisa || a.q !== x.q || a.active !== x.active) changed++;
  }
  ok(changed === 0, `pc: barcode / price / stock unchanged for every existing item (${changed})`);
  d.close();
  // undo + down + re-migrate
  const { undoBuyUnits } = require(path.join(root, 'apps/api/dist/catalog/buy-units.js'));
  d = new Database(dbPath);
  const u = undoBuyUnits(d, runs[0].id);
  ok(u.ok && d.prepare(`SELECT COUNT(*) n FROM products WHERE active = 1 AND name = 'Maida Loose'`).get().n === 0 && d.prepare(`SELECT 1 FROM products WHERE name = 'Atta' AND active = 1`).get(), 'pc: undo run');
  d.close();
  const dn = down(dbPath, '041_buy_units');
  ok(dn.ok && !dn.skipped, 'pc: down 041');
  d = new Database(dbPath);
  ok(!d.prepare(`SELECT 1 FROM pragma_table_info('products') WHERE name = 'buy_unit'`).get() && !d.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'buy_unit_runs'`).get() && !d.prepare(`SELECT 1 FROM pragma_table_info('purchase_order_lines') WHERE name = 'by_package'`).get(), 'pc: schema reversed');
  d.close();
  migrate(dbPath);
  d = new Database(dbPath);
  ok(d.prepare(`SELECT 1 FROM pragma_table_info('products') WHERE name = 'buy_unit'`).get() && d.prepare(`PRAGMA integrity_check`).get().integrity_check === 'ok', 'pc: re-migrate ok');
  d.close();
  fs.rmSync(dbPath, { force: true });
} else console.log('skip pc part (no copy)');

console.log(`test-buy-units: ${c.passed} checks passed`);
