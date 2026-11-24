#!/usr/bin/env node
/** Product types step 3: PO/bill search = everything; till = Normal + Packed, never Bulk (loose);
 * barcode lookup per screen; packed-from items bought ready on bills and POs; bulk sale always refused.
 * SKIP_BUILD=1 node scripts/test-product-types-search.mjs */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('ptsearch', Number(process.env.API_PORT ?? 3897));
const R = api.request;
const j = (r) => r.raw.slice(0, 300);
try {
  const s = await seed(api);
  const { owner, cashier } = s;
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items[0];
  const mk = async (name, priceRs, unitLabel = 'piece', extra = {}) => {
    const r = await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel, ...extra } });
    if (!r.json?.ok) throw new Error(`mk ${name} ${r.raw}`);
    return r.json.product;
  };
  const sugarL = await mk('Sugar Loose', 160, 'kg', { productType: 'bulk' });
  const s1 = await mk('Sugar 1 kg', 170, 'piece', { productType: 'packed', bulkId: sugarL.id, packKg: 1, barcode: '2000000000101' });
  const s15 = await mk('Sugar 1.5 kg', 255, 'piece', { productType: 'packed', bulkId: sugarL.id, packKg: 1.5 });
  const s3 = await mk('Sugar 3 kg', 500, 'piece', { productType: 'packed', bulkId: sugarL.id, packKg: 3 });
  const brown = await mk('Country Brown Sugar 500 g', 180);
  await R('PATCH', `/catalog/products/${sugarL.id}`, { token: owner, body: { barcode: '2000000000200' } });
  const names = (r) => (r.json?.items ?? []).map((x) => x.name).sort();

  // PO / bill search: everything (loose and packed-from can both be bought)
  let r = await R('GET', '/catalog/products?q=sugar&for=purchase', { token: owner });
  ok(JSON.stringify(names(r)) === JSON.stringify(['Country Brown Sugar 500 g', 'Sugar 1 kg', 'Sugar 1.5 kg', 'Sugar 3 kg', 'Sugar Loose']), `PO search ${names(r)}`);
  ok(r.json.items.filter((x) => x.product_type === 'bulk').length === 1 && r.json.total === 5, 'PO search: one Bulk, total 5');
  // till search: never loose
  r = await R('GET', '/catalog/products?q=sugar&for=sale', { token: cashier });
  ok(JSON.stringify(names(r)) === JSON.stringify(['Country Brown Sugar 500 g', 'Sugar 1 kg', 'Sugar 1.5 kg', 'Sugar 3 kg']), `till search no loose ${names(r)}`);
  // plain catalog unchanged
  r = await R('GET', '/catalog/products?q=sugar', { token: owner });
  ok(r.json.items.length === 5, 'catalog shows all');
  r = await R('GET', '/catalog/products?q=sugar&types=packed', { token: owner });
  ok(r.json.items.length === 3 && r.json.total === 3, 'types filter');

  // barcode per screen
  r = await R('GET', '/catalog/lookup?barcode=2000000000101&for=purchase', { token: owner });
  ok(r.status === 200 && r.json.product.id === s1.id, `scan packed on PO ${j(r)}`);
  r = await R('GET', '/catalog/lookup?barcode=2000000000101&for=sale', { token: cashier });
  ok(r.status === 200 && r.json.product.id === s1.id, 'scan packed at till');
  r = await R('GET', '/catalog/lookup?barcode=2000000000200&for=purchase', { token: owner });
  ok(r.status === 200 && r.json.product.product_type === 'bulk', 'scan bulk on PO');
  r = await R('GET', '/catalog/lookup?barcode=2000000000200&for=sale', { token: cashier });
  ok(r.status === 400 && r.json?.error === 'bulk_not_sold_loose', 'scan bulk at till refused');

  // packed-from bought ready on bills and POs
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: s1.id, pieces: 10, unitCostRs: 150 }] } });
  ok(r.json?.ok && s.stock(s1.id) === 10, `bill packed ok ${j(r)}`);
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup.id, lines: [{ productId: s15.id, qty: 5 }] } });
  ok(r.json?.ok, `PO packed ok ${j(r)}`);
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: sugarL.id, pieces: 50, unitCostRs: 200 }, { productId: brown.id, pieces: 5, unitCostRs: 150 }] } });
  ok(r.json?.ok, `bill bulk + normal ok ${j(r)}`);

  // loose never sold, whatever the old setting says
  for (const on of [false, true]) {
    await R('POST', '/product-types/settings', { token: owner, body: { sell_bulk_loose: on } });
    r = await R('GET', '/catalog/products?q=sugar&for=sale', { token: cashier });
    ok(!names(r).includes('Sugar Loose'), `till search no loose (old setting ${on})`);
    r = await R('POST', '/sales', { token: cashier, body: { lines: [{ productId: sugarL.id, qty: 1.5 }], payment: { method: 'cash' } } });
    ok(r.json?.ok !== true && (r.json?.error ?? r.json?.message?.error) === 'bulk_not_sold_loose', `bulk sale refused ${j(r)}`);
  }
  ok(s.stock(sugarL.id) === 50, `bulk stock 50 ${s.stock(sugarL.id)}`);
  void s3;
} finally {
  api.stop();
}
console.log(`test-product-types-search: ${c.passed} checks passed`);
