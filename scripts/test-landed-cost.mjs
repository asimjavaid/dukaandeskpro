#!/usr/bin/env node
/** Landed cost (migration 042): price per carton / crate, delivery / extra charges split by line value.
 * Acceptance: Adams 2 ctn x 12 @ Rs 1,200 + 7up 3 crates x 6 @ Rs 1,800, delivery Rs 300 ->
 * Rs 92.31 to Adams (Rs 103.85/pc), Rs 207.69 to 7up (Rs 311.54/btl); rice 50 kg total 15000 in another case.
 * SKIP_BUILD=1 node scripts/test-landed-cost.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startApi, seed, makeChecks, root, Database } from './lib/sales-harness.mjs';

const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));
const { down } = require(path.join(root, 'packages/db/src/down.js'));
const { extraShares } = require(path.join(root, 'apps/api/dist/purchases/purchases.service.js'));
const c = makeChecks();
const { ok } = c;
const j = (r) => (r.raw ?? JSON.stringify(r)).slice(0, 300);

// ---- web allocation (same rule as API) ----
const out = path.join(os.tmpdir(), `landed-${Date.now()}.mjs`);
const esbuild = createRequire(path.join(root, 'apps/web/node_modules/vite/package.json'))('esbuild');
esbuild.buildSync({ entryPoints: [path.join(root, 'apps/web/src/features/purchases/landed.ts')], bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
const web = await import(out);
fs.rmSync(out, { force: true });

ok(JSON.stringify(extraShares([240000, 540000], 30000)) === '[9231,20769]', `API split 9231 / 20769: ${extraShares([240000, 540000], 30000)}`);
ok(JSON.stringify(web.splitExtras([240000, 540000], 30000)) === '[9231,20769]', 'web split matches');
for (const [vals, x] of [[[100, 100, 100], 100], [[1, 2, 3, 4], 999], [[0, 0], 50], [[333333, 1, 777], 10001]]) {
  const a = extraShares(vals, x), b = web.splitExtras(vals, x);
  ok(a.reduce((s, v) => s + v, 0) === x && JSON.stringify(a) === JSON.stringify(b), `shares sum exactly ${x}: ${a}`);
}
ok(web.landedEach(240000, 9231, 24) === 10385 && web.landedEach(540000, 20769, 18) === 31154, 'web landed 103.85 / 311.54');

const api = await startApi('landed', Number(process.env.API_PORT ?? 3941));
const R = api.request;
try {
  const s = await seed(api);
  const { owner } = s;
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items[0];
  const mk = async (name, priceRs, unitLabel = 'piece') => {
    const r = await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel } });
    if (!r.json?.ok) throw new Error(`mk ${name} ${r.raw}`);
    return r.json.product;
  };
  const q = (sql, ...a) => { const d = s.db(); const v = d.prepare(sql).get(...a); d.close(); return v; };
  const cost = (id) => q('SELECT last_unit_cost_paisa c FROM products WHERE id = ?', id).c;
  const due = () => (R('GET', '/suppliers', { token: owner })).then((r) => r.json.items.find((x) => x.id === sup.id).due_paisa);

  const adams = await mk('Adams Cheddar 200 g', 100);
  const up = await mk('7up 1.5 L', 360);
  const rice = await mk('Basmati Rice Loose', 380, 'kg');

  // ---- 1. PO receive: price per carton, delivery owed to supplier ----
  let r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup.id, lines: [{ productId: adams.id, packages: 2 }, { productId: up.id, packages: 3 }] } });
  const po = r.json;
  const L = (id) => po.lines.find((l) => l.product_id === id);
  const due0 = await due();
  r = await R('POST', `/purchase-orders/${po.order.id}/receive`, {
    token: owner,
    body: {
      lines: [
        { orderLineId: L(adams.id).id, packages: 2, packUnits: 12, packCostRs: 1200 },
        { orderLineId: L(up.id).id, packages: 3, packUnits: 6, packCostRs: 1800 },
      ],
      extras: [{ label: 'Delivery', amountRs: 300 }],
    },
  });
  ok(r.json?.ok, `received with delivery ${j(r)}`);
  let bill = (await R('GET', `/purchases/${r.json.billId}`, { token: owner })).json;
  const bl = (id) => bill.lines.find((l) => l.product_id === id);
  ok(bl(adams.id).extra_share_paisa === 9231 && bl(up.id).extra_share_paisa === 20769, `shares Rs 92.31 / Rs 207.69: ${bl(adams.id).extra_share_paisa} ${bl(up.id).extra_share_paisa}`);
  ok(bl(adams.id).unit_cost_paisa === 10385 && bl(up.id).unit_cost_paisa === 31154, `landed Rs 103.85/pc, Rs 311.54/btl: ${bl(adams.id).unit_cost_paisa} ${bl(up.id).unit_cost_paisa}`);
  ok(cost(adams.id) === 10385 && cost(up.id) === 31154, 'product last cost = landed');
  ok(bill.invoice.subtotal_paisa === 780000 && bill.invoice.extras_paisa === 30000 && bill.invoice.extras_owed_paisa === 30000 && bill.invoice.total_paisa === 810000 && bill.invoice.due_paisa === 810000, `bill Rs 7,800 + Rs 300 = Rs 8,100 ${JSON.stringify(bill.invoice).slice(0, 260)}`);
  ok(bill.invoice.extras.length === 1 && bill.invoice.extras[0].label === 'Delivery' && bill.invoice.extras[0].amount_paisa === 30000 && bill.invoice.extras[0].paid_separately === 0, 'extra row stored');
  ok((await due()) - due0 === 810000, 'supplier owed Rs 8,100');
  ok(bl(adams.id).line_amount_paisa === 240000 && bl(up.id).line_amount_paisa === 540000, 'line totals = cartons x price');
  const pc = r.json.price_check ?? [];
  const pcA = pc.find((x) => (x.product_id ?? x.productId) === adams.id);
  ok(pcA && pcA.cost_paisa === 10385 && pcA.suggested_paisa > 10385, `price suggestion from landed cost ${JSON.stringify(pc)}`);
  r = await R('GET', `/purchase-orders/buy-info?supplierId=${sup.id}&ids=${adams.id},${up.id}`, { token: owner });
  ok(r.json.byProduct[adams.id].last_pack_cost_paisa === 120000 && r.json.byProduct[adams.id].last_pack_units === 12 && r.json.byProduct[up.id].last_pack_cost_paisa === 180000, `prefill supplier price/ctn (no extras) ${j(r)}`);

  // ---- 2. walk-in bill: paid separately + rice by total ----
  const due1 = await due();
  r = await R('POST', '/purchases', {
    token: owner,
    body: {
      supplierId: sup.id,
      lines: [{ productId: rice.id, pieces: 50, unitCostRs: 300, lineTotalRs: 15000 }, { productId: adams.id, packages: 2, packUnits: 12, packCostRs: 1200 }],
      extras: [{ label: 'Rickshaw', amountRs: 200, paidSeparately: true }, { label: 'Loading', amountRs: 100 }],
      paidRs: 1000,
    },
  });
  ok(r.json?.ok, `bill with rice + extras ${j(r)}`);
  bill = r.json;
  // value 15000 + 2400 = 17400; extras 300 -> rice round(30000*1500000/1740000)=25862, adams 4138
  ok(bl(rice.id).extra_share_paisa === 25862 && bl(adams.id).extra_share_paisa === 4138, `rice / Adams shares ${bl(rice.id).extra_share_paisa} ${bl(adams.id).extra_share_paisa}`);
  ok(bl(rice.id).unit_cost_paisa === 30517 && bl(adams.id).unit_cost_paisa === 10172, `rice landed Rs 305.17/kg, Adams Rs 101.72: ${bl(rice.id).unit_cost_paisa} ${bl(adams.id).unit_cost_paisa}`);
  ok(bill.invoice.extras_paisa === 30000 && bill.invoice.extras_owed_paisa === 10000 && bill.invoice.total_paisa === 1750000 && bill.invoice.due_paisa === 1650000, `paid separately not owed: total Rs 17,500 due Rs 16,500 ${JSON.stringify(bill.invoice).slice(0, 240)}`);
  ok(bill.invoice.extras.map((x) => `${x.label}:${x.paid_separately}`).join(',') === 'Rickshaw:1,Loading:0', 'both rows stored in order');
  ok((await due()) - due1 === 1650000, 'supplier due excludes paid-separately');
  ok(cost(rice.id) === 30517, 'rice last cost landed');

  // ---- 3. no extras: unchanged behaviour ----
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: rice.id, pieces: 50, unitCostRs: 300, lineTotalRs: 15000 }] } });
  ok(r.json?.ok && r.json.invoice.extras_paisa === 0 && r.json.invoice.extras.length === 0 && r.json.lines[0].unit_cost_paisa === 30000, 'rice 50 kg total 15000 -> Rs 300/kg, no extras');
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: rice.id, pieces: 1, unitCostRs: 300 }], extras: [{ amountRs: 0 }, { amountRs: 50 }] } });
  ok(r.json?.ok && r.json.invoice.extras.length === 1 && r.json.invoice.extras[0].label === 'Delivery' && r.json.lines[0].unit_cost_paisa === 35000, 'empty box skipped; default label; single line takes all');
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: rice.id, pieces: 1, unitCostRs: 300 }], extras: [{ amountRs: -5 }] } });
  ok(r.json?.ok === false, `negative extra refused ${j(r)}`);
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: rice.id, pieces: 1, unitCostRs: 300 }], extras: [{ amountRs: 100 }], paidRs: 400 } });
  ok(r.json?.ok && r.json.invoice.due_paisa === 0, 'pay incl. delivery');

  // ---- 4. backup v14 ----
  const ex = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const b = ex.json?.bundle ?? ex.json;
  ok(b.header.schema_version === 16 && b.batch2.landed.extras.length === 5 && b.batch2.landed.lines.some((l) => l.extra_share_paisa === 9231), `bundle v14 landed ${JSON.stringify(b.batch2.landed).slice(0, 200)}`);
  { const d = new Database(api.dbPath); d.pragma('busy_timeout = 3000'); d.prepare('DELETE FROM purchase_extras').run(); d.prepare('UPDATE purchase_invoices SET extras_paisa = 0, extras_owed_paisa = 0').run(); d.prepare('UPDATE purchase_lines SET extra_share_paisa = 0').run(); d.close(); }
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: b } });
  ok(r.json?.ok, `restore ${j(r)}`);
  ok(q('SELECT COUNT(*) n FROM purchase_extras').n === 5 && q('SELECT SUM(extras_paisa) s FROM purchase_invoices').s === 30000 + 30000 + 5000 + 10000 && q('SELECT COUNT(*) n FROM purchase_lines WHERE extra_share_paisa = 20769').n === 1, 'restore brings extras back');
  ok(q('PRAGMA foreign_key_check') === undefined, 'no orphan extras');
  const old = JSON.parse(JSON.stringify(b));
  old.header.schema_version = 13;
  delete old.batch2.landed;
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: old } });
  ok(r.json?.ok && q('SELECT COUNT(*) n FROM purchase_extras').n === 0, `v13 copy restores, no extras ${j(r)}`);
} finally {
  api.stop();
}

// ---- 5. migration 042 down / up (SQLite only: on PostgreSQL 042 is part of baseline.sql) ----
const IS_PG = process.env.DD_DB === 'pg' || !!process.env.DATABASE_URL;
if (IS_PG) console.log('skip 042 down/up on PostgreSQL (squashed into baseline)');
else {
  const dbPath = path.join(os.tmpdir(), `dd-lc-${Date.now()}.sqlite`);
  migrate(dbPath);
  let d = new Database(dbPath);
  ok(d.prepare(`SELECT 1 FROM schema_migrations WHERE id = '042_landed_cost.sql'`).get() && d.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'purchase_extras'`).get(), '042 applied');
  d.close();
  const dn = down(dbPath, '042_landed_cost');
  d = new Database(dbPath);
  ok(dn.ok && !dn.skipped && !d.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'purchase_extras'`).get() && !d.prepare(`SELECT 1 FROM pragma_table_info('purchase_invoices') WHERE name = 'extras_paisa'`).get() && !d.prepare(`SELECT 1 FROM pragma_table_info('purchase_lines') WHERE name = 'extra_share_paisa'`).get(), 'down 042 reverses schema');
  d.close();
  migrate(dbPath);
  d = new Database(dbPath);
  ok(d.prepare(`SELECT 1 FROM pragma_table_info('purchase_lines') WHERE name = 'extra_share_paisa'`).get() && d.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 're-migrate ok');
  d.close();
  fs.rmSync(dbPath, { force: true });
}
console.log(`test-landed-cost: ${c.passed} checks passed`);
