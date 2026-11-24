#!/usr/bin/env node
/** Product types step 7: bulk stock report (kg in hand, kg in packs by size, wastage) and backup v12
 * (types, review list, sorter runs, loose selling, packing per pack). Older copies restore as Normal.
 * SKIP_BUILD=1 node scripts/test-product-types-report.mjs */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('ptreport', Number(process.env.API_PORT ?? 3900));
const R = api.request;
const j = (r) => r.raw.slice(0, 400);
try {
  const s = await seed(api);
  const { owner, stock } = s;
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items[0];
  const mk = async (name, priceRs, unitLabel = 'piece', extra = {}) => {
    const r = await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel, ...extra } });
    if (!r.json?.ok) throw new Error(`mk ${r.raw}`);
    return r.json.product;
  };
  const sugar = await mk('Sugar Loose', 230, 'kg');
  const p1 = await mk('Sugar 1 kg', 240, 'piece', { productType: 'packed', bulkId: sugar.id, packKg: 1 });
  const p3 = await mk('Sugar 3 kg', 700, 'piece', { productType: 'packed', bulkId: sugar.id, packKg: 3 });
  const daal = await mk('Daal Chana Loose', 300, 'kg');
  const d05 = await mk('Daal Chana 500 g', 160, 'piece', { productType: 'packed', bulkId: daal.id, packKg: 0.5 });
  await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: sugar.id, pieces: 60, unitCostRs: 200 }, { productId: daal.id, pieces: 10, unitCostRs: 280 }] } });
  let r = await R('POST', '/repack', { token: owner, body: { bulkId: sugar.id, wastage: 0.4, packingPerPackRs: 5, lines: [{ productId: p1.id, packets: 20 }, { productId: p3.id, packets: 5 }] } });
  ok(r.json?.ok, `repack sugar ${j(r)}`);
  r = await R('POST', '/repack', { token: owner, body: { bulkId: daal.id, wastage: 0.25, lines: [{ productId: d05.id, packets: 8 }] } });
  ok(r.json?.ok, 'repack daal');
  await s.sell(s.cashier, { paymentMethod: 'cash', lines: [{ productId: p1.id, qty: 2 }] });
  // 60 - 35.4 = 24.6 kg sugar in hand; packs 18 x 1 + 5 x 3 = 33 kg; daal 10 - 4.25 = 5.75 + 8 x 0.5 = 4 kg
  r = await R('GET', '/repack/report', { token: owner });
  const sg = r.json.items.find((x) => x.id === sugar.id);
  ok(sg.kg_in_hand === 24.6 && sg.kg_in_packs === 33 && sg.kg_total === 57.6, `sugar kg ${JSON.stringify(sg)}`);
  ok(sg.packs.find((p) => p.id === p1.id).kg === 18 && sg.packs.find((p) => p.id === p3.id).kg === 15, 'by size: 18 kg in 1 kg, 15 kg in 3 kg');
  ok(sg.wastage_kg === 0.4 && sg.wastage_cost_paisa === 8000 && sg.repacked_kg === 35, `sugar wastage 0.4 kg Rs 80 ${JSON.stringify(sg)}`);
  const dl = r.json.items.find((x) => x.id === daal.id);
  ok(dl.kg_in_hand === 5.75 && dl.kg_in_packs === 4 && dl.wastage_kg === 0.25 && dl.wastage_cost_paisa === 7000, `daal ${JSON.stringify(dl)}`);
  ok(r.json.totals.wastage_kg === 0.65 && r.json.totals.kg_in_hand === 30.35 && r.json.totals.kg_in_packs === 37, `totals ${JSON.stringify(r.json.totals)}`);
  r = await R('GET', '/repack/report?from=2000-01-01&to=2000-01-02', { token: owner });
  ok(r.json.totals.wastage_kg === 0 && r.json.items.find((x) => x.id === sugar.id).kg_in_hand === 24.6, 'period filter: wastage only in range, stock is now');
  // data entry: kg yes, cost no; cashier no
  r = await R('POST', '/owner/staff', { token: owner, body: { name: 'Sana DEO', role: 'data_entry', pin: '4321' } });
  const deo = (await R('POST', '/auth/login', { body: { userId: r.json.staff.id, pin: '4321' } })).json.sessionToken;
  r = await R('GET', '/repack/report', { token: deo });
  ok(r.status === 200 && r.json.items[0].wastage_cost_paisa === undefined && r.json.items[0].stock_cost_paisa === undefined && r.json.totals.wastage_kg === 0.65, 'data entry: kg only');
  r = await R('GET', '/repack/report', { token: s.cashier });
  ok(r.status === 403, 'cashier no report');

  // ---- backup v12 ----
  await R('POST', '/product-types/settings', { token: owner, body: { sell_bulk_loose: false } });
  const plain = await mk('Sella Rice 5 kg', 1300);
  const sella = await mk('Sella Rice Loose', 260, 'kg');
  r = await R('POST', '/product-types/run', { token: owner });
  ok(r.json?.ok, 'sorter run for backup');
  const d = s.db();
  const before = Object.fromEntries(d.prepare('SELECT id, product_type, type_source, repack_from_id, size_qty FROM products').all().map((x) => [x.id, x]));
  const reviewN = d.prepare('SELECT COUNT(*) n FROM product_type_review').get().n;
  d.close();
  const ex = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const b = ex.json?.bundle ?? ex.json;
  ok(b.header.schema_version === 16 && b.batch2.types.products.length >= 6 && b.batch2.types.runs.length === 1 && b.batch2.types.store.sell_bulk_loose === 0, `bundle v12 ${JSON.stringify(b.batch2.types).slice(0, 200)}`);
  ok(b.batch2.types.repack_packing.length === 1 && b.batch2.types.repack_packing[0].packing_per_pack_paisa === 500, 'packing per pack in bundle');
  // mess things up, then restore
  await R('PATCH', `/catalog/products/${p1.id}`, { token: owner, body: { productType: 'normal' } });
  await R('POST', '/product-types/settings', { token: owner, body: { sell_bulk_loose: true } });
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: b } });
  ok(r.json?.ok, `restore v12 ${j(r)}`);
  const d2 = s.db();
  const after = Object.fromEntries(d2.prepare('SELECT id, product_type, type_source, repack_from_id, size_qty FROM products').all().map((x) => [x.id, x]));
  ok(Object.keys(before).every((id) => JSON.stringify(before[id]) === JSON.stringify(after[id])), 'types + links back exactly');
  ok(d2.prepare('SELECT COUNT(*) n FROM product_type_review').get().n === reviewN && d2.prepare('SELECT COUNT(*) n FROM product_type_runs').get().n === 1, 'review + runs back');
  ok(d2.prepare('SELECT sell_bulk_loose v FROM store').get().v === 0, 'loose setting back');
  ok(d2.prepare('SELECT COUNT(*) n FROM repacks WHERE packing_per_pack_paisa = 500').get().n === 1, 'packing per pack back');
  d2.close();
  ok(stock(p1.id) === 18 && stock(sugar.id) === 24.6, 'stock back');
  // v11 copy: no types section -> all Normal, loose on, links kept
  const old = JSON.parse(JSON.stringify(b));
  delete old.batch2.types;
  old.header.schema_version = 11;
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: old } });
  ok(r.json?.ok, `restore v11 ${j(r)}`);
  const d3 = s.db();
  ok(d3.prepare(`SELECT COUNT(*) n FROM products WHERE product_type != 'normal'`).get().n === 0, 'v11 copy -> all Normal');
  ok(d3.prepare('SELECT repack_from_id b FROM products WHERE id = ?').get(p1.id).b === sugar.id, 'v11 copy keeps packet links');
  ok(d3.prepare('SELECT sell_bulk_loose v FROM store').get().v === 1 && d3.prepare('SELECT COUNT(*) n FROM product_type_runs').get().n === 0, 'loose on, no runs (sorter will run on next start)');
  d3.close();
  void plain; void sella;
} finally {
  api.stop();
}
console.log(`test-product-types-report: ${c.passed} checks passed`);
