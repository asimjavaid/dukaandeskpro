#!/usr/bin/env node
/** Product types step 5: repack. Acceptance: 50 kg sugar at Rs 200/kg -> 20 x 1 kg + 10 x 1.5 kg + 5 x 3 kg,
 * bulk 0, costs Rs 200/300/600, 35 packets; 0.4 kg wastage share; packing per pack; hard block, never negative;
 * same roles as purchasing; history record.
 * SKIP_BUILD=1 node scripts/test-product-types-repack.mjs */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('ptrepack', Number(process.env.API_PORT ?? 3899));
const R = api.request;
const j = (r) => r.raw.slice(0, 400);
try {
  const s = await seed(api);
  const { owner, cashier, stock } = s;
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items[0];
  const mk = async (name, priceRs, unitLabel = 'piece', extra = {}) => {
    const r = await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel, ...extra } });
    if (!r.json?.ok) throw new Error(`mk ${r.raw}`);
    return r.json.product;
  };
  const cost = (id) => {
    const d = s.db();
    const v = d.prepare('SELECT last_unit_cost_paisa c FROM products WHERE id = ?').get(id).c;
    d.close();
    return v;
  };
  const sugar = await mk('Sugar Loose', 230, 'kg');
  const p1 = await mk('Sugar 1 kg', 240, 'piece', { productType: 'packed', bulkId: sugar.id, packKg: 1 });
  const p15 = await mk('Sugar 1.5 kg', 355, 'piece', { productType: 'packed', bulkId: sugar.id, packKg: 1.5 });
  const p3 = await mk('Sugar 3 kg', 700, 'piece', { productType: 'packed', bulkId: sugar.id, packKg: 3 });
  // a refused packed product leaves no row behind (not even an inactive one)
  const rows = (name) => { const d = s.db(); const n = d.prepare('SELECT COUNT(*) n FROM products WHERE name = ?').get(name).n; d.close(); return n; };
  for (const [extra, err] of [[{ bulkId: sugar.id }, 'packed_needs_kg'], [{ bulkId: sugar.id, packKg: 0 }, 'packed_needs_kg'], [{ packKg: 5 }, 'packed_needs_bulk'], [{ bulkId: 'nope', packKg: 5 }, 'packed_needs_bulk']]) {
    const bad = await R('POST', '/catalog/products', { token: owner, body: { name: 'Sugar 5 kg bad', priceRs: 1000, unitLabel: 'packet', productType: 'packed', ...extra } });
    ok(bad.status === 400 && bad.json?.error === err && rows('Sugar 5 kg bad') === 0, `refused packed (${err}) leaves no product: ${bad.status} ${bad.json?.error} rows=${rows('Sugar 5 kg bad')}`);
  }
  const kgPacked = await R('POST', '/catalog/products', { token: owner, body: { name: 'Sugar kg bad', priceRs: 1000, unitLabel: 'kg', productType: 'packed', bulkId: sugar.id, packKg: 5 } });
  ok(kgPacked.json?.error === 'packed_is_pieces' && rows('Sugar kg bad') === 0, `packed sold by kg refused, no row: ${kgPacked.json?.error}`);
  const bag = (await R('GET', `/packs?productId=${sugar.id}`, { token: owner })).json.items.find((p) => p.name === 'Bag');
  let r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: sugar.id, packId: bag.id, packQty: 1, packCostRs: 10000 }] } });
  ok(r.json?.ok && stock(sugar.id) === 50 && cost(sugar.id) === 20000, 'bought 1 bag = 50 kg at Rs 200/kg');

  r = await R('GET', '/repack/bulk', { token: owner });
  const b = r.json.items.find((x) => x.id === sugar.id);
  ok(b && b.qty_on_hand === 50 && b.packets.length === 3, `bulk shows kg stock + packets ${j(r)}`);

  // roles: cashier no, data entry yes (same as purchasing)
  r = await R('POST', '/repack', { token: cashier, body: { bulkId: sugar.id, lines: [{ productId: p1.id, packets: 1 }] } });
  ok(r.status === 403, 'cashier cannot repack');
  r = await R('POST', '/owner/staff', { token: owner, body: { name: 'Sana DEO', role: 'data_entry', pin: '4321' } });
  const deo = (await R('POST', '/auth/login', { body: { userId: r.json.staff.id, pin: '4321' } })).json.sessionToken;
  r = await R('GET', '/repack/bulk', { token: deo });
  ok(r.status === 200, 'data entry can open repack');

  // hard block: over stock (wastage counts), no override
  r = await R('POST', '/repack', { token: owner, body: { bulkId: sugar.id, wastage: 0.5, lines: [{ productId: p1.id, packets: 20 }, { productId: p15.id, packets: 10 }, { productId: p3.id, packets: 5 }] } });
  ok(r.json?.error === 'not_enough_bulk' && r.json.on_hand === 50 && r.json.needed === 50.5, `blocked 50.5 > 50 ${j(r)}`);
  r = await R('POST', '/repack', { token: owner, body: { bulkId: sugar.id, override: true, lines: [{ productId: p3.id, packets: 17 }] } });
  ok(r.json?.error === 'not_enough_bulk' && stock(sugar.id) === 50, 'override ignored');
  r = await R('POST', '/repack', { token: owner, body: { bulkId: sugar.id, wastage: -1, lines: [{ productId: p1.id, packets: 1 }] } });
  ok(r.json?.error === 'invalid_wastage', 'negative wastage refused');

  // acceptance: 20 x 1 + 10 x 1.5 + 5 x 3 = 50 kg
  r = await R('POST', '/repack', { token: deo, body: { bulkId: sugar.id, lines: [{ productId: p1.id, packets: 20 }, { productId: p15.id, packets: 10 }, { productId: p3.id, packets: 5 }] } });
  ok(r.json?.ok, `repack ${j(r)}`);
  ok(stock(sugar.id) === 0 && stock(p1.id) === 20 && stock(p15.id) === 10 && stock(p3.id) === 5, 'bulk 0; 20/10/5 packs');
  ok(cost(p1.id) === 20000 && cost(p15.id) === 30000 && cost(p3.id) === 60000, `costs 200/300/600: ${cost(p1.id)} ${cost(p15.id)} ${cost(p3.id)}`);
  const lines = r.json.lines;
  ok(lines.reduce((a, l) => a + l.packets, 0) === 35, '35 packets (labels)');
  ok(lines.every((l) => l.barcode && l.price_paisa > 0 && l.qty_each > 0), 'lines carry barcode, price, weight for labels');
  ok(r.json.repack.total_cost_paisa === undefined, 'data entry sees no cost');
  const rp1 = (await R('GET', `/repack/${r.json.repack.id}`, { token: owner })).json;
  ok(rp1.repack.wastage_qty === 0 && rp1.repack.total_cost_paisa === 1000000, `history: no wastage, Rs 10,000 ${JSON.stringify(rp1.repack)}`);
  r = await R('POST', '/repack', { token: owner, body: { bulkId: sugar.id, lines: [{ productId: p1.id, packets: 1 }] } });
  ok(r.json?.error === 'not_enough_bulk' && stock(sugar.id) === 0, 'empty bulk blocked, stays 0');

  // 0.4 kg wastage share: buy 50.4 kg, same packs + 0.4 kg wastage
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: sugar.id, pieces: 50.4, unitCostRs: 200 }] } });
  ok(r.json?.ok && stock(sugar.id) === 50.4, 'bought 50.4 kg');
  r = await R('POST', '/repack', { token: owner, body: { bulkId: sugar.id, wastage: 0.4, lines: [{ productId: p1.id, packets: 20 }, { productId: p15.id, packets: 10 }, { productId: p3.id, packets: 5 }] } });
  ok(r.json?.ok && r.json.repack.wastage_qty === 0.4 && r.json.repack.bulk_qty_used === 50.4, `wastage repack ${j(r)}`);
  ok(stock(sugar.id) === 0, 'bulk 0 again');
  // each kg carries 0.4/50 kg extra: 1 kg = Rs 201.60, 1.5 kg = Rs 302.40, 3 kg = Rs 604.80
  ok(cost(p1.id) === 20160 && cost(p15.id) === 30240 && cost(p3.id) === 60480, `wastage share ${cost(p1.id)} ${cost(p15.id)} ${cost(p3.id)}`);
  ok(r.json.repack.wastage_value_paisa === 8000, `wastage value Rs 80 ${r.json.repack.wastage_value_paisa}`);

  // packing per pack Rs 5
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: sugar.id, pieces: 10, unitCostRs: 200 }] } });
  r = await R('POST', '/repack', { token: owner, body: { bulkId: sugar.id, packingPerPackRs: 5, lines: [{ productId: p1.id, packets: 4 }, { productId: p3.id, packets: 2 }] } });
  ok(r.json?.ok && cost(p1.id) === 20500 && cost(p3.id) === 60500, `packing per pack ${cost(p1.id)} ${cost(p3.id)}`);
  ok(r.json.repack.packing_per_pack_paisa === 500 && r.json.repack.packing_cost_paisa === 3000, 'history keeps per-pack and total packing');
  ok(stock(sugar.id) === 0, 'exactly used up');

  // history
  r = await R('GET', '/repack', { token: owner });
  ok(r.json.items.length === 3 && r.json.items.some((h) => h.wastage_qty === 0.4), 'history lists 3 repacks');
  const neg = s.db();
  ok(neg.prepare('SELECT COUNT(*) n FROM stock_balances WHERE qty_on_hand < 0').get().n === 0, 'no negative stock anywhere');
  neg.close();
} finally {
  api.stop();
}
console.log(`test-product-types-repack: ${c.passed} checks passed`);
