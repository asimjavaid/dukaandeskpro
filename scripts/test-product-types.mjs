#!/usr/bin/env node
/** Product types (step 1): migration 040, sorter run / idempotent / undo, review, manual type, real-catalog migration + down.
 * SKIP_BUILD=1 node scripts/test-product-types.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { startApi, seed, makeChecks, root, Database } from './lib/sales-harness.mjs';

const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));
const { down } = require(path.join(root, 'packages/db/src/down.js'));
const c = makeChecks();
const { ok } = c;
const j = (r) => (r.raw ?? JSON.stringify(r)).slice(0, 300);

// ---------- A. API on a small catalog shaped like the shop's ----------
const api = await startApi('ptypes', Number(process.env.API_PORT ?? 3895));
const R = api.request;
try {
  const s = await seed(api);
  const { owner, cashier, stock } = s;
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items[0];
  const mk = async (name, priceRs, unitLabel = 'piece', extra = {}) => {
    const r = await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel, ...extra } });
    if (!r.json?.ok) throw new Error(`mk ${name} ${r.raw}`);
    return r.json.product;
  };
  const recv = async (p, qty, costRs) => {
    const r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: p.id, pieces: qty, unitCostRs: costRs }] } });
    if (!r.json?.ok) throw new Error(`recv ${r.raw}`);
  };
  const sugarL = await mk('Sugar (Cheeni) Loose', 160, 'kg');
  const sugar1 = await mk('Sugar 1 kg', 170, 'piece', { barcode: '8961000000011' });
  const sugar5 = await mk('Sugar 5 kg', 820);
  const sella = await mk('Sella Rice Loose', 260, 'kg');
  const sella05 = await mk('Sella Rice 500 g', 135);
  const mashW = await mk('Daal Mash Washed', 590, 'kg');
  const mash05 = await mk('Daal Mash 500 g', 300);
  const country = await mk('Country Sugar 5 kg', 900);
  const up = await mk('7Up 345 ml', 60);
  const up5 = await mk('7Up 5 L', 400);
  const lays = await mk('Lays Masala', 30, 'piece', { fixedPrice: true });
  const laysF = await mk('Lays Family Pack', 150);
  const eggs = await mk('Eggs 1 Dozen', 400);
  await recv(sugarL, 50, 150);
  await recv(sugar1, 7, 150);
  await recv(mash05, 22, 250);

  ok(sugar1.product_type === 'normal', `new product normal ${sugar1.product_type}`);
  ok(sugarL.product_type === 'bulk', 'new kg item is Bulk by default');
  {
    // make the fixture look like a catalog from before 040 (all normal, no packs)
    const d = new Database(api.dbPath);
    d.prepare(`UPDATE products SET product_type = 'normal', type_source = NULL`).run();
    d.prepare(`DELETE FROM product_packs`).run();
    d.close();
  }
  const snap = () => {
    const d = new Database(api.dbPath, { readonly: true });
    const rows = d.prepare(`SELECT p.id, p.name, p.barcode, p.price_paisa, p.active, COALESCE(s.qty_on_hand,0) q FROM products p LEFT JOIN stock_balances s ON s.product_id = p.id`).all();
    d.close();
    return new Map(rows.map((r) => [r.id, r]));
  };
  const q = (sql, ...a) => {
    const d = new Database(api.dbPath, { readonly: true });
    const r = d.prepare(sql).all(...a);
    d.close();
    return r;
  };
  const type = (p) => q(`SELECT product_type t, type_source src, repack_from_id b, size_qty k FROM products WHERE id = ?`, p.id)[0];
  const packsOf = (p) => q(`SELECT name, units FROM product_packs WHERE product_id = ? AND active = 1`, p.id);
  const before = snap();

  // plan (dry run) changes nothing
  let r = await R('GET', '/product-types/plan', { token: owner });
  ok(r.json?.ok && r.json.counts.packed === 3 && r.json.createStaples.includes('Atta'), `plan ${JSON.stringify(r.json?.counts)} ${r.json?.createStaples}`);
  ok(type(sugar1).t === 'normal', 'plan is read-only');
  r = await R('POST', '/product-types/run', { token: cashier });
  ok(r.status === 403, `cashier cannot run ${r.status}`);

  // run 1
  r = await R('POST', '/product-types/run', { token: owner });
  ok(r.json?.ok && r.json.counts.packed === 3, `run1 ${j(r)}`);
  const run1 = r.json.id;
  const created1 = r.json.counts.created;
  ok(created1 === 5, `staples created (Basmati, Chana, Masoor, Moong, Atta) ${created1}`);
  ok(type(sugarL).t === 'bulk' && type(sella).t === 'bulk' && type(mashW).t === 'bulk', 'kg items are Bulk');
  ok(type(sugar1).t === 'packed' && type(sugar1).b === sugarL.id && type(sugar1).k === 1, `Sugar 1 kg packed ${JSON.stringify(type(sugar1))}`);
  ok(type(sugar5).k === 5 && type(sella05).b === sella.id && type(sella05).k === 0.5, 'Sugar 5 kg + Sella 500 g packed');
  ok(type(country).t === 'normal' && type(mash05).t === 'normal' && type(eggs).t === 'normal', 'branded / unsure stay normal');
  ok(packsOf(sugarL).some((p) => p.name === 'Bag' && p.units === 50), 'bulk default Bag 50');
  ok(packsOf(up).some((p) => p.name === 'Crate' && p.units === 12) && packsOf(up5).length === 0, '7Up crate 12, 5 L none');
  ok(packsOf(lays).some((p) => p.name === 'Carton' && p.units === 24) && packsOf(laysF).length === 0, 'Lays carton 24, family none');
  const after = snap();
  let same = true;
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a || a.barcode !== b.barcode || a.price_paisa !== b.price_paisa || a.q !== b.q || a.active !== b.active) same = false;
  }
  ok(same && stock(sugar1.id) === 7 && stock(sugarL.id) === 50, 'barcode, price, stock unchanged; nothing deleted');

  // review list
  r = await R('GET', '/product-types/review', { token: owner });
  const rv = r.json?.items ?? [];
  const mashR = rv.find((x) => x.product_id === mash05.id);
  ok(mashR && mashR.reason === 'pick_bulk' && mashR.kg === 0.5 && mashR.candidates[0].name === 'Daal Mash Washed', `review Daal Mash 500 g ${JSON.stringify(mashR)}`);
  ok(rv.some((x) => x.name === 'Sunny Atta 5 kg') && rv.filter((x) => x.reason === 'new_bulk_price').length === 5, `review atta + new bulks ${rv.map((x) => x.name)}`);
  ok((r.json.bulks ?? []).some((b) => b.name === 'Sugar (Cheeni) Loose'), 'review gives bulk list');
  r = await R('GET', '/product-types/review', { token: cashier });
  ok(r.status === 403, 'cashier no review');

  // idempotent
  r = await R('POST', '/product-types/run', { token: owner });
  const cn = r.json?.counts ?? {};
  ok(r.json?.ok && cn.changed === 0 && cn.created === 0 && cn.packs === 0 && cn.review === 0, `run2 no changes ${j(r)}`);
  const run2 = r.json.id;
  r = await R('GET', '/product-types/runs', { token: owner });
  ok(r.json?.items?.length === 2, 'runs listed');

  // undo run 1 (run 2 empty first)
  r = await R('POST', `/product-types/runs/${run2}/undo`, { token: owner });
  ok(r.json?.ok && r.json.restored === 0, 'undo empty run');
  r = await R('POST', `/product-types/runs/${run1}/undo`, { token: cashier });
  ok(r.status === 403, 'cashier cannot undo');
  r = await R('POST', `/product-types/runs/${run1}/undo`, { token: owner });
  ok(r.json?.ok && r.json.restored > 0, `undo run1 ${j(r)}`);
  r = await R('POST', `/product-types/runs/${run1}/undo`, { token: owner });
  ok(r.status === 400 && r.json?.error === 'already_undone', 'undo twice refused');
  ok(type(sugar1).t === 'normal' && type(sugar1).b === null && type(sugarL).t === 'normal' && type(sugarL).src === null, 'types restored');
  ok(packsOf(sugarL).length === 0 && packsOf(up).length === 0, 'created packs off');
  ok(q(`SELECT COUNT(*) n FROM products WHERE type_source = 'auto' AND active = 1`)[0].n === 0, 'created staples off');
  ok(q(`SELECT COUNT(*) n FROM product_type_review WHERE resolved_at IS NULL`)[0].n === 0, 'review cleared');
  const undone = snap();
  ok([...before].every(([id, b]) => undone.get(id).barcode === b.barcode && undone.get(id).price_paisa === b.price_paisa && undone.get(id).q === b.q), 'undo keeps barcode/price/stock');

  // run 3 = same result as run 1
  r = await R('POST', '/product-types/run', { token: owner });
  ok(r.json?.ok && r.json.counts.packed === 3 && r.json.counts.review === rv.length, `run3 again ${j(r)}`);

  // resolve review: Daal Mash 500 g -> packed of Daal Mash Washed 0.5
  r = await R('POST', `/product-types/review/${mash05.id}`, { token: owner, body: { type: 'packed', bulkId: mashW.id, kg: 0.5 } });
  ok(r.json?.ok && type(mash05).t === 'packed' && type(mash05).k === 0.5 && type(mash05).src === 'manual', `resolve ${j(r)}`);
  ok(stock(mash05.id) === 22, 'resolve keeps stock');
  r = await R('POST', `/product-types/review/${eggs.id}`, { token: owner, body: { type: 'packed', kg: 1 } });
  ok(r.status === 400 && r.json?.error === 'packed_needs_bulk', 'packed needs bulk');

  // catalog: type on read + edit + validation
  r = await R('GET', '/catalog/products?q=Sugar%201', { token: owner });
  ok(r.json.items.find((x) => x.id === sugar1.id)?.product_type === 'packed', 'catalog shows type');
  r = await R('PATCH', `/catalog/products/${eggs.id}`, { token: owner, body: { productType: 'packed', bulkId: sugarL.id } });
  ok(r.status === 400 && r.json?.error === 'packed_needs_kg', `packed needs kg ${j(r)}`);
  r = await R('PATCH', `/catalog/products/${eggs.id}`, { token: owner, body: { productType: 'bulk' } });
  ok(r.status === 400 && r.json?.error === 'bulk_needs_kg', 'bulk needs kg');
  r = await R('PATCH', `/catalog/products/${sella.id}`, { token: owner, body: { productType: 'packed', bulkId: sugarL.id, packKg: 1 } });
  ok(r.status === 400 && r.json?.error === 'bulk_has_packets', `bulk with packets ${j(r)}`);
  r = await R('PATCH', `/catalog/products/${sugar1.id}`, { token: owner, body: { productType: 'packed', bulkId: sugarL.id, packKg: '1.2345' } });
  ok(r.json?.ok && r.json.product.product_type === 'packed' && type(sugar1).k === 1.235 && type(sugar1).src === 'manual', `kg 3 dp ${JSON.stringify(type(sugar1))}`);
  r = await R('PATCH', `/catalog/products/${sugar1.id}`, { token: owner, body: { productType: 'normal' } });
  ok(r.json?.ok && type(sugar1).t === 'normal' && type(sugar1).b === null, 'set back to normal');
  r = await R('POST', '/product-types/run', { token: owner });
  ok(r.json?.counts?.changed === 0 && type(sugar1).t === 'normal', 'sorter leaves manual choices');
  const nb = await mk('Moong Sabut Loose', 300, 'kg', { productType: 'bulk' });
  ok(nb.product_type === 'bulk', 'create as bulk');
  const np = await mk('Moong Sabut 1 kg', 320, 'piece', { productType: 'packed', bulkId: nb.id, packKg: 1 });
  ok(np.product_type === 'packed' && type(np).b === nb.id && type(np).k === 1, 'create as packed');
  r = await R('POST', '/catalog/products', { token: owner, body: { name: 'Bad Pack', priceRs: 10, productType: 'packed', packKg: 1 } });
  ok(r.status === 400 && r.json?.error === 'packed_needs_bulk', 'create packed without bulk refused');

  // step 2: settings (loose selling) + runs list for Settings
  r = await R('GET', '/product-types/settings', { token: owner });
  ok(r.json?.settings?.sell_bulk_loose === true, 'loose selling default ON');
  r = await R('POST', '/product-types/settings', { token: cashier, body: { sell_bulk_loose: false } });
  ok(r.status === 403, 'cashier cannot change loose setting');
  r = await R('POST', '/product-types/settings', { token: owner, body: { sell_bulk_loose: 'no' } });
  ok(r.status === 400, 'bad setting refused');
  r = await R('POST', '/product-types/settings', { token: owner, body: { sell_bulk_loose: false } });
  ok(r.json?.ok && r.json.settings.sell_bulk_loose === false, 'loose off');
  r = await R('POST', '/product-types/settings', { token: owner, body: { sell_bulk_loose: true } });
  r = await R('GET', '/product-types/runs', { token: owner });
  const lastRun = r.json.items.find((x) => !x.undone_at && x.changed > 0);
  ok(lastRun && lastRun.packed === 3 && lastRun.bulk === 8 && lastRun.review > 0, `runs counts ${JSON.stringify(lastRun)}`);
  // review: new bulk gets a price then marked done (as the review screen does)
  r = await R('GET', '/product-types/review', { token: owner });
  const atta = r.json.items.find((x) => x.reason === 'new_bulk_price' && x.name === 'Atta');
  ok(atta && atta.price_paisa === 0, 'Atta created at Rs 0 for review');
  r = await R('PATCH', `/catalog/products/${atta.product_id}`, { token: owner, body: { pricePaisa: 13000 } });
  ok(r.json?.ok && r.json.product.price_paisa === 13000 && r.json.product.name === 'Atta', `price only patch ${j(r)}`);
  r = await R('POST', `/product-types/review/${atta.product_id}`, { token: owner, body: { type: 'bulk' } });
  ok(r.json?.ok, 'atta done');
  r = await R('GET', '/product-types/review', { token: owner });
  ok(!r.json.items.some((x) => x.product_id === atta.product_id), 'atta off the list');
  r = await R('GET', '/product-types/review?all=1', { token: owner });
  ok(r.json.items.some((x) => x.product_id === atta.product_id && x.resolved_at), 'resolved kept in history');

  // repack link keeps types in step
  r = await R('POST', '/repack/link', { token: owner, body: { productId: eggs.id, bulkId: null } });
  r = await R('POST', '/repack/link', { token: owner, body: { productId: sugar1.id, bulkId: sugarL.id, qtyEach: 1 } });
  ok(r.json?.ok && type(sugar1).t === 'packed', `link sets packed ${j(r)}`);
  r = await R('POST', '/repack/link', { token: owner, body: { productId: sugar1.id, bulkId: null } });
  ok(r.json?.ok && type(sugar1).t === 'normal', 'unlink sets normal');
} finally {
  api.stop();
}

// ---------- B. The shop's real catalog (copy of PC DB, 16 Oct) ----------
const pcSrc = '/workspace/pc-db-20261016.sqlite';
// Lite/PostgreSQL: P1 .sqlite upgrade + SQLite down-migrations do not apply (P1 migrations are squashed into
// baseline.sql); upgrading a P1 shop copy is covered by scripts/test-import-p1.mjs instead.
const IS_PG = process.env.DD_DB === 'pg' || !!process.env.DATABASE_URL;
if (IS_PG) console.log('skip pc catalog part on PostgreSQL (covered by test-import-p1)');
else if (fs.existsSync(pcSrc)) {
  const dbPath = path.join(os.tmpdir(), `dd-ptypes-pc-${Date.now()}.sqlite`);
  fs.copyFileSync(pcSrc, dbPath);
  const read = () => {
    const d = new Database(dbPath, { readonly: true });
    const rows = d.prepare(`SELECT p.id, p.barcode, p.price_paisa, p.active, p.repack_from_id, p.size_qty, COALESCE(s.qty_on_hand,0) q FROM products p LEFT JOIN stock_balances s ON s.product_id = p.id`).all();
    d.close();
    return new Map(rows.map((r) => [r.id, r]));
  };
  const before = read();
  migrate(dbPath);
  migrate(dbPath); // second apply is a no-op
  let d = new Database(dbPath);
  ok(d.prepare(`SELECT COUNT(*) n FROM schema_migrations WHERE id = '040_product_types.sql'`).get().n === 1, 'pc: 040 applied once');
  d.close();
  // boot the API on it: first start sorts once
  const port = 3896;
  const child = spawn('node', [path.join(root, 'apps/api/dist/main.js')], {
    cwd: path.join(root, 'apps/api'),
    env: { ...process.env, API_PORT: String(port), SQLITE_PATH: dbPath, SESSION_SECRET: 'pt', TAX_PROCESS_INTERVAL_MS: '0', DD_SKIP_BUY_UNITS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const health = () => new Promise((res) => http.get({ host: '127.0.0.1', port, path: '/health' }, (r) => { r.resume(); res(r.statusCode); }).on('error', () => res(0)));
  for (let i = 0; i < 240 && (await health()) !== 200; i++) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 500));
  child.kill('SIGTERM');
  await new Promise((r) => child.on('exit', r));
  d = new Database(dbPath);
  const runs = d.prepare(`SELECT id, changes_json FROM product_type_runs`).all();
  ok(runs.length === 1, `pc: auto-sorted once (${runs.length})`);
  const counts = Object.fromEntries(d.prepare(`SELECT product_type t, COUNT(*) n FROM products WHERE active = 1 GROUP BY product_type`).all().map((x) => [x.t, x.n]));
  const reviewN = d.prepare(`SELECT COUNT(*) n FROM product_type_review WHERE resolved_at IS NULL`).get().n;
  console.log('pc counts', JSON.stringify(counts), 'review', reviewN);
  ok(counts.bulk >= 21 && counts.packed >= 25 && reviewN >= 10, 'pc: bulk/packed/review counts');
  for (const n of ['Sugar (Cheeni) Loose', 'Sella Rice Loose', 'Basmati Rice Loose', 'Daal Mash Washed', 'Daal Chana', 'Daal Masoor', 'Daal Moong Washed']) {
    ok(d.prepare(`SELECT product_type t FROM products WHERE name = ? AND active = 1`).get(n)?.t === 'bulk', `pc: staple ${n} bulk`);
  }
  ok(d.prepare(`SELECT COUNT(*) n FROM products WHERE name = 'Atta' AND product_type = 'bulk' AND active = 1`).get().n === 1, 'pc: Atta bulk created');
  d.close();
  const after = read();
  let same = true, gone = 0;
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a) { gone++; continue; }
    if (a.barcode !== b.barcode || a.price_paisa !== b.price_paisa || a.q !== b.q || a.active !== b.active) same = false;
  }
  ok(same && gone === 0, 'pc: every barcode/price/stock unchanged, nothing deleted');
  // undo, then the down migration
  const { undoRun } = require(path.join(root, 'apps/api/dist/catalog/product-types.js'));
  d = new Database(dbPath);
  const u = undoRun(d, runs[0].id);
  ok(u.ok && u.restored > 0, 'pc: undo run');
  ok(d.prepare(`SELECT COUNT(*) n FROM products WHERE product_type != 'normal' AND active = 1`).get().n === 0, 'pc: all back to normal');
  d.close();
  const undone = read();
  ok([...before].every(([id, b]) => { const a = undone.get(id); return a.repack_from_id === b.repack_from_id && a.size_qty === b.size_qty && a.price_paisa === b.price_paisa && a.q === b.q; }), 'pc: links back as before');
  const dn = down(dbPath, '040_product_types');
  ok(dn.ok && !dn.skipped, 'pc: down 040');
  d = new Database(dbPath);
  ok(!d.prepare(`SELECT 1 FROM pragma_table_info('products') WHERE name = 'product_type'`).get() && !d.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'product_type_runs'`).get(), 'pc: schema reversed');
  d.close();
  migrate(dbPath);
  d = new Database(dbPath);
  ok(d.prepare(`SELECT 1 FROM pragma_table_info('products') WHERE name = 'product_type'`).get(), 'pc: re-migrate ok');
  d.close();
  for (const sfx of ['', '-wal', '-shm']) fs.rmSync(dbPath + sfx, { force: true });
} else console.log('skip pc catalog part (no copy)');

console.log(`test-product-types: ${c.passed} checks passed`);
