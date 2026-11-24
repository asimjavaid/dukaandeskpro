#!/usr/bin/env node
/** Purchase measures: carton × pcs per adds pieces, loose kg then repack, ready-made packed-from items, dozen / gram / bag,
 * unit stored on bills and orders, loose items never sold. SKIP_BUILD=1 node scripts/test-purchase-measures.mjs */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('measures', Number(process.env.API_PORT ?? 3961));
const R = api.request;
const j = (r) => (r.raw ?? '').slice(0, 300);
try {
  const s = await seed(api);
  const { owner, cashier, stock } = s;
  const mk = async (name, priceRs, unitLabel = 'piece', extra = {}) => {
    const r = await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel, ...extra } });
    if (!r.json?.ok) throw new Error(`mk ${name} ${r.raw}`);
    return r.json.product;
  };
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items.find((x) => x.name === 'Test Supplier');
  const bill = (lines, extra = {}) => R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines, ...extra } });

  // product form: bought loose / bought by / packed from
  const sugar = await mk('Sugar (Cheeni) Loose', 150, 'kg', { productType: 'bulk', buyMeasure: 'kg' });
  ok(sugar.product_type === 'bulk' && sugar.buy_measure === 'kg', `bought loose -> bulk, kg ${sugar.product_type}/${sugar.buy_measure}`);
  const sugar5 = await mk('Sugar (Cheeni) 5 kg', 1950, 'packet', { productType: 'packed', bulkId: sugar.id, packKg: 5 });
  const lays = await mk('Lays Classic 21 g', 30, 'packet', { buyMeasure: 'carton' });
  ok(lays.buy_measure === 'carton' && lays.buy_unit === 'carton', 'bought by carton');
  const oil = await mk('Dalda Oil 1 L', 600, 'piece', { buyMeasure: 'bottle' });
  ok(oil.buy_measure === 'bottle' && oil.buy_unit === 'piece', `bought by bottle, legacy piece ${oil.buy_unit}`);
  const eggs = await mk('Eggs', 30, 'piece', { buyMeasure: 'dozen' });
  const daalL = await mk('Daal Mash Washed', 520, 'kg', { productType: 'bulk' });
  const mash = await mk('Daal Mash 500 g', 280, 'packet', { buyMeasure: 'packet' });
  ok(mash.product_type === 'normal', 'Daal Mash 500 g starts ready-made');
  let r = await R('PATCH', `/catalog/products/${mash.id}`, { token: owner, body: { productType: 'packed', bulkId: daalL.id, packKg: 0.5, buyMeasure: 'packet' } });
  ok(r.json?.ok && r.json.product.product_type === 'packed' && r.json.product.repack_from_id === daalL.id, `packed from loose daal ${j(r)}`);
  r = await R('PATCH', `/catalog/products/${lays.id}`, { token: owner, body: { buyMeasure: 'kg' } });
  ok(r.status === 400 && (r.json?.error ?? r.json?.message?.error) === 'invalid_buy_measure', `kg refused for a packet item ${j(r)}`);
  r = await R('PATCH', `/catalog/products/${sugar.id}`, { token: owner, body: { buyMeasure: 'carton' } });
  ok(r.status === 400, 'loose item cannot be bought by carton');

  // Carton 1 x 10 Lays adds 10
  r = await bill([{ productId: lays.id, unit: 'carton', packages: 1, packUnits: 10, lineTotalRs: 250 }]);
  ok(r.json?.ok && stock(lays.id) === 10, `carton 1 x 10 -> 10 in stock (${stock(lays.id)}) ${j(r)}`);
  let det = (await R('GET', `/purchases/${r.json.invoice.id}`, { token: owner })).json;
  ok(det.lines[0].unit === 'carton' && det.lines[0].pack_units === 10 && det.lines[0].unit_cost_paisa === 2500, `line: carton, 10 pcs, Rs 25 each ${JSON.stringify(det.lines[0])}`);
  // bottle (single) adds qty directly; dozen = 12
  r = await bill([{ productId: oil.id, unit: 'bottle', pieces: 6, lineTotalRs: 3300 }, { productId: eggs.id, unit: 'dozen', packages: 2, lineTotalRs: 600 }]);
  ok(r.json?.ok && stock(oil.id) === 6 && stock(eggs.id) === 24, `6 bottles, 2 dozen = 24 (${stock(oil.id)}, ${stock(eggs.id)}) ${j(r)}`);
  det = (await R('GET', `/purchases/${r.json.invoice.id}`, { token: owner })).json;
  ok(det.lines.map((l) => l.unit).sort().join(',') === 'bottle,dozen', 'units stored');
  r = await bill([{ productId: oil.id, unit: 'kg', pieces: 2, lineTotalRs: 100 }]);
  ok(r.json?.ok === false && (r.json?.error ?? r.json?.message?.error) === 'invalid_buy_measure', `kg for a bottle item refused ${j(r)}`);

  // 30 kg sugar loose, then repack 6 x 5 kg
  r = await bill([{ productId: sugar.id, unit: 'kg', pieces: 30, lineTotalRs: 4200 }]);
  ok(r.json?.ok && stock(sugar.id) === 30, `30 kg loose ${j(r)}`);
  r = await R('POST', '/repack', { token: owner, body: { bulkId: sugar.id, lines: [{ productId: sugar5.id, packets: 6 }] } });
  ok(r.json?.ok && stock(sugar.id) === 0 && stock(sugar5.id) === 6, `repack 6 x 5 kg (${stock(sugar.id)} kg, ${stock(sugar5.id)} packs) ${j(r)}`);
  // bag of 50 kg and grams
  r = await bill([{ productId: sugar.id, unit: 'bag', packages: 1, packUnits: 50, lineTotalRs: 7000 }]);
  ok(r.json?.ok && stock(sugar.id) === 50, `1 bag x 50 kg -> 50 kg ${j(r)}`);
  r = await bill([{ productId: sugar.id, unit: 'gram', pieces: 500, lineTotalRs: 75 }]);
  ok(r.json?.ok && stock(sugar.id) === 50.5, `500 g -> 0.5 kg (${stock(sugar.id)}) ${j(r)}`);

  // Daal Mash 500 g bought ready, and repacked from loose daal
  r = await bill([{ productId: mash.id, unit: 'packet', pieces: 12, lineTotalRs: 3000 }, { productId: daalL.id, unit: 'kg', pieces: 5, lineTotalRs: 2400 }]);
  ok(r.json?.ok && stock(mash.id) === 12 && stock(daalL.id) === 5, `12 packets ready + 5 kg loose ${j(r)}`);
  const bulks = (await R('GET', '/repack/bulk', { token: owner })).json;
  const dl = (bulks.items ?? bulks).find((b) => b.id === daalL.id);
  ok(dl && dl.packets.some((p) => p.id === mash.id), 'Repack lists Daal Mash 500 g under the loose daal');
  r = await R('POST', '/repack', { token: owner, body: { bulkId: daalL.id, lines: [{ productId: mash.id, packets: 4 }] } });
  ok(r.json?.ok && stock(mash.id) === 16 && stock(daalL.id) === 3, `repack 4 x 0.5 kg (${stock(mash.id)}, ${stock(daalL.id)}) ${j(r)}`);

  // purchase search shows everything
  const pnames = (await R('GET', `/catalog/products?q=sugar&page=1&pageSize=50&for=purchase`, { token: owner })).json.items.map((x) => x.name);
  ok(pnames.includes('Sugar (Cheeni) Loose') && pnames.includes('Sugar (Cheeni) 5 kg'), `purchase search: loose + packed ${JSON.stringify(pnames)}`);
  r = await R('GET', `/catalog/lookup?barcode=${sugar5.barcode}&for=purchase`, { token: owner });
  ok(r.json?.ok, 'scan packed item in purchase ok');

  // loose absent from Sell
  const snames = (await R('GET', `/catalog/products?q=sugar&page=1&pageSize=50&for=sale`, { token: cashier })).json.items.map((x) => x.name);
  ok(!snames.includes('Sugar (Cheeni) Loose') && snames.includes('Sugar (Cheeni) 5 kg'), `sell search: no loose ${JSON.stringify(snames)}`);
  r = await R('GET', `/catalog/lookup?barcode=${sugar.barcode}&for=sale`, { token: cashier });
  ok(r.status === 400 && (r.json?.error ?? r.json?.message?.error) === 'bulk_not_sold_loose', `scan loose at till refused ${j(r)}`);
  await R('PATCH', '/product-types/settings', { token: owner, body: { sell_bulk_loose: true } });
  r = await R('POST', '/sales', { token: cashier, body: { lines: [{ productId: sugar.id, qty: 1 }], payment: { method: 'cash' } } });
  ok(r.json?.ok !== true && (r.json?.error ?? r.json?.message?.error) === 'bulk_not_sold_loose', `loose sale refused even with old setting on ${j(r)}`);
  r = await R('POST', '/sales', { token: cashier, body: { lines: [{ productId: sugar5.id, qty: 1 }], payment: { method: 'cash' } } });
  ok(r.json?.ok, 'packed sells');

  // orders keep the unit; receive by carton adds pieces
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup.id, lines: [
    { productId: lays.id, unit: 'carton', packages: 3 }, { productId: sugar.id, unit: 'kg', qty: 25 }, { productId: oil.id, unit: 'bottle', qty: 12 }, { productId: mash.id, unit: 'packet', qty: 10 } ] } });
  ok(r.json?.ok, `order with units ${j(r)}`);
  const o = r.json;
  const ol = (pid) => o.lines.find((l) => l.product_id === pid);
  ok(ol(lays.id).unit === 'carton' && ol(lays.id).qty_ordered === 3 && ol(lays.id).last_pack_units === 10, `order carton line, 10 pcs remembered ${JSON.stringify(ol(lays.id))}`);
  ok(ol(sugar.id).unit === 'kg' && ol(oil.id).unit === 'bottle' && ol(mash.id).unit === 'packet', 'order units');
  const before = stock(lays.id);
  r = await R('POST', `/purchase-orders/${o.order.id}/receive`, { token: owner, body: { lines: [
    { orderLineId: ol(lays.id).id, unit: 'carton', packages: 2, packUnits: 12, lineTotalRs: 600 },
    { orderLineId: ol(oil.id).id, unit: 'bottle', qty: 12, lineTotalRs: 6600 } ] } });
  ok(r.json?.ok && stock(lays.id) === before + 24, `receive 2 cartons x 12 -> +24 (${stock(lays.id) - before}) ${j(r)}`);
  const o2 = (await R('GET', `/purchase-orders/${o.order.id}`, { token: owner })).json;
  ok(o2.lines.find((l) => l.product_id === lays.id).qty_received === 2, 'order counts 2 cartons received');
  r = await R('GET', `/purchase-orders/buy-info?supplierId=${sup.id}&ids=${lays.id},${sugar.id},${eggs.id}`, { token: owner });
  const bi = r.json.byProduct;
  ok(bi[lays.id].last_unit === 'carton' && bi[lays.id].pack_units.carton === 12, `buy-info: last carton of 12 ${JSON.stringify(bi[lays.id])}`);
  ok(bi[sugar.id].units.join(',') === 'kg,gram,bag' && bi[sugar.id].pack_units.bag === 50, `loose: kg/gram/bag, bag of 50 ${JSON.stringify(bi[sugar.id])}`);
  ok(bi[eggs.id].buy_measure === 'dozen' && bi[eggs.id].pack_units.dozen === 12, 'eggs by dozen');

  // restock: packed-from item short -> kg of loose; ready-made items as they are
  r = await R('POST', '/purchase-orders/targets', { token: owner, body: { items: [{ id: sugar5.id, qty: 2 }, { id: lays.id, qty: 20 }] } });
  const t = r.json?.items ?? [];
  ok(t.find((x) => x.id === sugar.id)?.qty === 10 && t.find((x) => x.id === lays.id)?.qty === 20, `targets: 2 x 5 kg -> 10 kg loose, lays 20 ${j(r)}`);
} catch (e) {
  ok(false, `crashed: ${e.stack}`);
} finally {
  api.stop();
}
console.log(`\n${c.passed} passed`);
