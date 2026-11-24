#!/usr/bin/env node
/** Purchase shows loose and packed-from items (bought ready); low-stock
 * suggestions and restock prefill turn short packets into kg of their loose source; carton receive pre-fills the
 * product's own pieces-per-carton preset (sane sizes only). SKIP_BUILD=1 node scripts/test-purchase-loose-only.mjs */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('looseonly', Number(process.env.API_PORT ?? 3957));
const R = api.request;
const j = (r) => (r.raw ?? '').slice(0, 300);
try {
  const s = await seed(api);
  const { owner, stock } = s;
  const mk = async (name, priceRs, unitLabel = 'piece', extra = {}) => {
    const r = await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel, ...extra } });
    if (!r.json?.ok) throw new Error(`mk ${name} ${r.raw}`);
    return r.json.product;
  };
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items.find((x) => x.name === 'Test Supplier');
  const sugar = await mk('Cheeni Khula', 390, 'kg');
  const s1 = await mk('Cheeni Khula 1 kg', 400, 'packet', { productType: 'packed', bulkId: sugar.id, packKg: 1 });
  const s05 = await mk('Cheeni Khula 500 g', 200, 'packet', { productType: 'packed', bulkId: sugar.id, packKg: 0.5 });
  const chips = await mk('Crunch Rs 30', 30, 'packet', { buyUnit: 'carton' });
  const cola = await mk('Fizz 1.5 L', 180, 'piece', { buyUnit: 'crate' });
  const pk = async (productId, name, units) => R('POST', '/packs', { token: owner, body: { productId, name, units } });
  ok((await pk(chips.id, 'Carton', 10)).json?.ok, 'chips carton preset 10');
  ok((await pk(cola.id, 'Crate', 1000)).json?.ok, 'cola crate preset 1000 (typo)');
  const packBarcode = (await R('POST', '/packs', { token: owner, body: { productId: s1.id, name: 'Carton', units: 20, barcode: '7700000000017' } })).json;

  // 1. purchase shows loose and packed-from (bought ready); till never shows loose
  const names = async (q) => (await R('GET', `/catalog/products?q=${encodeURIComponent(q)}&page=1&pageSize=50&for=purchase`, { token: owner })).json.items.map((x) => x.name);
  const hits = await names('cheeni');
  ok(hits.includes('Cheeni Khula') && hits.includes('Cheeni Khula 1 kg'), `purchase search: loose + packed ${JSON.stringify(hits)}`);
  const sale = (await R('GET', `/catalog/products?q=cheeni&page=1&pageSize=50&for=sale`, { token: owner })).json.items.map((x) => x.name);
  ok(sale.includes('Cheeni Khula 1 kg') && sale.includes('Cheeni Khula 500 g') && !sale.includes('Cheeni Khula'), 'sell search: packets, no loose');
  let r = await R('GET', `/catalog/lookup?barcode=${s1.barcode}&for=purchase`, { token: owner });
  ok(r.json?.ok && r.json.product.id === s1.id, `scan packet in purchase ok ${j(r)}`);
  if (packBarcode?.ok) {
    r = await R('GET', '/packs/lookup?barcode=7700000000017', { token: owner });
    ok(r.json?.ok === true, `pack barcode of a packed item found ${j(r)}`);
  } else ok(true, 'packed item pack barcode not addable');

  // 2. restock prefill: packets -> kg of loose, merged; normal passes through
  r = await R('POST', '/purchase-orders/targets', { token: owner, body: { items: [{ id: s1.id, qty: 10 }, { id: s05.id, qty: 4 }, { id: chips.id, qty: 30 }, { id: sugar.id, qty: 5 }] } });
  const t = r.json?.items ?? [];
  const ts = t.find((x) => x.id === sugar.id);
  ok(t.length === 2 && ts && ts.qty === 17 && ts.unit_label === 'kg' && ts.product_type === 'bulk', `targets: 10x1 + 4x0.5 + 5 kg = 17 kg of loose ${j(r)}`);
  ok(ts.from.map((f) => `${f.packets}x${f.kg_each}`).join(',') === '10x1,4x0.5', 'targets list the packets folded in');
  ok(t.find((x) => x.id === chips.id)?.qty === 30, 'normal item passes through');
  ok(!t.some((x) => x.product_type === 'packed'), 'no packed target');

  // 3. low-stock suggest: packets roll up into the loose source, never listed themselves
  await R('PATCH', `/catalog/products/${s1.id}`, { token: owner, body: { reorderLevel: 5 } });
  await R('PATCH', `/catalog/products/${s05.id}`, { token: owner, body: { reorderLevel: 4 } });
  r = await R('GET', '/purchase-orders/suggest', { token: owner });
  let items = (r.json.groups ?? []).flatMap((g) => g.items);
  const sg = items.find((i) => i.product_id === sugar.id);
  ok(!items.some((i) => i.product_id === s1.id || i.product_id === s05.id), `packets never suggested ${j(r)}`);
  // 1 kg: 2x5-0 = 10 packets = 10 kg; 0.5 kg: 2x4 = 8 packets = 4 kg -> 14 kg, bulk 0 on hand
  ok(sg && sg.suggested_qty === 14 && sg.unit_label === 'kg' && sg.by_package === false, `loose suggested 14 kg ${JSON.stringify(sg)}`);
  ok(sg.for_packets.length === 2, 'suggestion says which packets');
  r = await R('POST', '/purchase-orders/from-low-stock', { token: owner, body: { groups: (r.json.groups ?? []).map((g) => ({ supplierId: g.supplier_id, lines: g.items.map((i) => ({ productId: i.product_id, qty: i.suggested_qty })) })) } });
  ok(r.json?.ok, `order from low stock ${j(r)}`);
  r = await R('GET', '/purchase-orders/suggest', { token: owner });
  items = (r.json.groups ?? []).flatMap((g) => g.items);
  ok(!items.some((i) => i.product_id === sugar.id), 'kg on order covers it: not suggested again');
  // loose on hand can make a packet -> repack, not buy
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: sugar.id, pieces: 20, unitCostRs: 150, lineTotalRs: 3000 }] } });
  ok(r.json?.ok && stock(sugar.id) === 20, 'bought 20 kg loose');

  // 4. carton: preset pre-fills pieces per carton; typo preset ignored
  r = await R('GET', `/purchase-orders/buy-info?supplierId=${sup.id}&ids=${chips.id},${cola.id}`, { token: owner });
  ok(r.json.byProduct[chips.id].buy_unit === 'carton' && r.json.byProduct[chips.id].last_pack_units === 10, `chips: carton, 10 pcs from preset ${j(r)}`);
  ok(r.json.byProduct[cola.id].buy_unit === 'crate' && r.json.byProduct[cola.id].last_pack_units == null, 'crate of 1000 not pre-filled');
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup.id, lines: [{ productId: chips.id, packages: 2 }] } });
  ok(r.json?.ok, `order 2 cartons ${j(r)}`);
  const po = r.json;
  r = await R('GET', `/purchase-orders/${po.order.id}`, { token: owner });
  const line = r.json.lines[0];
  ok(line.by_package === 1 && line.qty_ordered === 2 && line.last_pack_units === 10, `receive line: 2 cartons, 10 pcs each pre-filled ${JSON.stringify(line).slice(0, 300)}`);
  const c0 = stock(chips.id);
  r = await R('POST', `/purchase-orders/${po.order.id}/receive`, { token: owner, body: { lines: [{ orderLineId: line.id, packages: 2, packUnits: 10, packCostRs: 250 }] } });
  ok(r.json?.ok && stock(chips.id) - c0 === 20, `received 2 x 10 = 20 pcs (${stock(chips.id) - c0})`);
  r = await R('GET', `/purchase-orders/buy-info?supplierId=${sup.id}&ids=${chips.id}`, { token: owner });
  ok(r.json.byProduct[chips.id].last_pack_units === 10 && r.json.byProduct[chips.id].last_pack_cost_paisa === 25000, 'after a bill: last carton used');
} finally {
  api.stop();
}
console.log(`test-purchase-loose-only: ${c.passed} checks passed`);
