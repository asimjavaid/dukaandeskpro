#!/usr/bin/env node
/** Product types step 4: buying by package. Acceptance: 7up crate, Lays carton, sugar bag Rs 200/kg;
 * Bag 50 default for bulk; units per pack remembered; live line summary wording.
 * SKIP_BUILD=1 node scripts/test-product-types-buying.mjs */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApi, seed, makeChecks, root } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;

// ---- line summary (web poText.ts, bundled with esbuild) ----
const out = path.join(os.tmpdir(), `poText-${Date.now()}.mjs`);
const esbuild = createRequire(path.join(root, 'apps/web/node_modules/vite/package.json'))('esbuild');
esbuild.buildSync({ entryPoints: [path.join(root, 'apps/web/src/features/purchases/poText.ts')], bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
const { lineSummary, pieceNoun } = await import(out);
fs.rmSync(out, { force: true });
const eq = (a, b, m) => ok(a === b, `${m}: got "${a}"`);
eq(lineSummary({ name: '7Up 345 ml', unit: 'piece', packName: 'Crate', packQty: 2, packUnits: 12, unitCostPaisa: 15000 }), '2 crates x 12 = 24 bottles, Rs 150 each', '7up summary');
eq(lineSummary({ name: 'Sugar Loose', unit: 'kg', packName: 'Bag', packQty: 1, packUnits: 50, unitCostPaisa: 20000 }), '1 bag x 50 kg = 50 kg, Rs 200/kg', 'sugar summary');
eq(lineSummary({ name: 'Lays Masala', unit: 'piece', packName: 'Carton', packQty: 2, packUnits: 10, unitCostPaisa: 2500 }), '2 cartons x 10 = 20 packets, Rs 25 each', 'lays summary');
eq(lineSummary({ name: 'Sugar Loose', unit: 'kg', qty: 20, unitCostPaisa: 30000 }), '20 kg, Rs 300/kg', 'loose kg');
eq(lineSummary({ name: 'Lux Soap', unit: 'piece', qty: 1, unitCostPaisa: 117000 }), '1 piece, Rs 1,170 each', 'single piece, comma');
eq(lineSummary({ name: 'Surf', unit: 'piece', packName: 'Box', packQty: 3, packUnits: 6, unitCostPaisa: null }), '3 boxes x 6 = 18 pieces', 'no cost, box plural');
eq(lineSummary({ name: 'Sugar Loose', unit: 'kg', packName: 'Bag', packQty: 0, packUnits: 50 }), null, 'zero qty -> none');
eq(pieceNoun('Coca Cola Can', 2), 'cans', 'can noun');

// ---- API acceptance ----
const api = await startApi('ptbuy', Number(process.env.API_PORT ?? 3898));
const R = api.request;
const j = (r) => r.raw.slice(0, 300);
try {
  const s = await seed(api);
  const { owner, cashier, stock } = s;
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items[0];
  const mk = async (name, priceRs, unitLabel = 'piece', extra = {}) =>
    (await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel, ...extra } })).json.product;
  const cost = async (id) => (await R('GET', `/catalog/products?q=${encodeURIComponent((await R('GET', '/catalog/products', { token: owner })).json.items.find((x) => x.id === id).name)}`, { token: owner })).json.items.find((x) => x.id === id).last_unit_cost_paisa;

  // 7up: 2 crates x 12 at Rs 1,800 -> +24 at Rs 150; scan 2 -> 22
  const up = await mk('7Up 345 ml', 180, 'piece', { barcode: '8964000000017' });
  let r = await R('POST', '/packs', { token: owner, body: { productId: up.id, name: 'Crate', units: 12 } });
  const crate = r.json.packs.find((p) => p.name === 'Crate');
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: up.id, packId: crate.id, packQty: 2, packCostRs: 1800 }] } });
  ok(r.json?.ok && r.json.invoice.total_paisa === 360000, `7up bill ${j(r)}`);
  ok(stock(up.id) === 24 && r.json.lines[0].unit_cost_paisa === 15000, `7up +24 at Rs 150 (${stock(up.id)}, ${r.json.lines[0].unit_cost_paisa})`);
  ok((await cost(up.id)) === 15000, '7up last cost Rs 150');
  r = await R('GET', '/catalog/lookup?barcode=8964000000017&for=sale', { token: cashier });
  ok(r.status === 200, 'scan 7up at till');
  r = await R('POST', '/sales', { token: cashier, body: { lines: [{ productId: up.id, qty: 2 }], payment: { method: 'cash' } } });
  ok(r.status === 201 && stock(up.id) === 22, `sold 2 -> 22 (${stock(up.id)})`);
  r = await R('GET', `/packs/hint?supplierId=${sup.id}&productId=${up.id}`, { token: owner });
  ok(r.json?.hint?.pack_id === crate.id && r.json.hint.pack_units === 12, `supplier remembers crate 12 ${j(r)}`);

  // Lays: 2 cartons x 10 -> +20
  const lays = await mk('Lays Masala', 30, 'piece', { fixedPrice: true });
  r = await R('POST', '/packs', { token: owner, body: { productId: lays.id, name: 'Carton', units: 10 } });
  const ctn = r.json.packs.find((p) => p.name === 'Carton');
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: lays.id, packId: ctn.id, packQty: 2, packCostRs: 250 }] } });
  ok(r.json?.ok && stock(lays.id) === 20 && r.json.lines[0].unit_cost_paisa === 2500, `lays +20 (${stock(lays.id)})`);

  // Sugar: new kg item is Bulk with Bag 50; 1 bag at Rs 10,000 -> 50 kg at Rs 200/kg
  const sugar = await mk('Sugar Loose', 230, 'kg');
  ok(sugar.product_type === 'bulk', 'sugar is Bulk');
  r = await R('GET', `/packs?productId=${sugar.id}`, { token: owner });
  const bag = (r.json.items ?? []).find((p) => p.name === 'Bag');
  ok(bag && bag.units === 50, `Bag 50 default ${j(r)}`);
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: sugar.id, packId: bag.id, packQty: 1, packCostRs: 10000 }] } });
  ok(r.json?.ok && r.json.invoice.total_paisa === 1000000, `sugar bill ${j(r)}`);
  ok(stock(sugar.id) === 50 && r.json.lines[0].unit_cost_paisa === 20000, `sugar 50 kg at Rs 200/kg (${stock(sugar.id)}, ${r.json.lines[0].unit_cost_paisa})`);
  // PO with a bag, then receive
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup.id, lines: [{ productId: sugar.id, packId: bag.id, packQty: 2 }] } });
  ok(r.json?.ok, `PO 2 bags ${j(r)}`);
  r = await R('GET', `/purchase-orders/${r.json.order?.id ?? r.json.id}`, { token: owner });
  const pl = r.json?.lines?.[0];
  ok(pl && pl.qty_ordered === 100 && pl.pack_name === 'Bag' && pl.pack_units === 50 && pl.pack_qty === 2, `PO line 2 bags = 100 kg ${JSON.stringify(pl)}`);
  // turning an existing kg item into Bulk also adds Bag 50 (only when it has no pack)
  const atta = await mk('Atta Loose', 120, 'kg', { productType: 'normal' });
  r = await R('GET', `/packs?productId=${atta.id}`, { token: owner });
  ok((r.json.items ?? []).length === 0, 'normal kg item: no bag');
  r = await R('PATCH', `/catalog/products/${atta.id}`, { token: owner, body: { productType: 'bulk' } });
  r = await R('GET', `/packs?productId=${atta.id}`, { token: owner });
  ok((r.json.items ?? []).some((p) => p.name === 'Bag' && p.units === 50), 'set Bulk -> Bag 50');
} finally {
  api.stop();
}
console.log(`test-product-types-buying: ${c.passed} checks passed`);
