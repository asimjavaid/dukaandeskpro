#!/usr/bin/env node
/** Packs on bills/orders, last pack per supplier, low-stock pack rounding, repack (cost, wastage, override, undo),
 * repack skips PO suggestion, backup v10. SKIP_BUILD=1 node scripts/test-packs-repack.mjs */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('packs', Number(process.env.API_PORT ?? 3893));
const R = api.request;
const j = (r) => r.raw.slice(0, 300);
try {
  const s = await seed(api);
  const { owner, cashier, soap, stock } = s;
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items.find((x) => x.name === 'Test Supplier');
  const sup2 = (await R('POST', '/suppliers', { token: owner, body: { name: 'Lays Agency', phone: '03001234567' } })).json.supplier;
  const mk = async (name, priceRs, unit = 'piece') => (await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unit } })).json.product;
  const lays = await mk('Lays Rs 50', 50);

  // packs
  let r = await R('POST', '/packs', { token: owner, body: { productId: lays.id, name: 'Carton', units: 20, barcode: '8961234500011' } });
  ok(r.json?.ok && r.json.packs.length === 1, `add pack ${j(r)}`);
  const carton = r.json.packs[0];
  r = await R('POST', '/packs', { token: owner, body: { productId: lays.id, name: 'Box', units: 0 } });
  ok(r.json?.error === 'invalid_qty', 'zero units refused');
  r = await R('GET', '/packs/lookup?barcode=8961234500011', { token: owner });
  ok(r.json?.ok && r.json.item.pack_id === carton.id && r.json.item.id === lays.id, 'carton barcode lookup');

  // bill: 3 cartons @ Rs 800 → 60 pcs, unit cost 40
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup2.id, lines: [{ productId: lays.id, packId: carton.id, packQty: 3, packCostRs: 800 }] } });
  ok(r.json?.ok && r.json.invoice.total_paisa === 240000, `pack bill ${j(r)}`);
  ok(stock(lays.id) === 60, 'stock 60 pcs');
  const bl = r.json.lines[0];
  ok(bl.pack_name === 'Carton' && bl.pack_qty === 3 && bl.pack_units === 20 && bl.unit_cost_paisa === 4000, `line pack ${JSON.stringify(bl)}`);
  r = await R('GET', `/packs/hint?supplierId=${sup2.id}&productId=${lays.id}`, { token: owner });
  ok(r.json?.hint?.pack_id === carton.id && r.json.hint.last_cost_paisa === 80000, `hint ${j(r)}`);
  // supplier's carton has 24 this time
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup2.id, lines: [{ productId: lays.id, packId: carton.id, packQty: 1, packUnits: 24, packCostRs: 960 }] } });
  ok(r.json?.ok && stock(lays.id) === 84, 'override units 24');
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup2.id, lines: [{ productId: lays.id, packId: carton.id, packQty: 1.5, packCostRs: 800 }] } });
  ok(r.json?.error === 'invalid_qty', 'half carton refused');

  // PO with pack + WhatsApp-ready lines + receive
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup2.id, lines: [{ productId: lays.id, packId: carton.id, packQty: 3 }] } });
  ok(r.json?.ok && r.json.lines[0].qty_ordered === 60 && r.json.lines[0].pack_qty === 3 && r.json.lines[0].pack_name === 'Carton', `po pack ${j(r)}`);
  const po = r.json;
  r = await R('POST', `/purchase-orders/${po.order.id}/receive`, { token: owner, body: { lines: [{ orderLineId: po.lines[0].id, packId: carton.id, packQty: 2, packCostRs: 820 }] } });
  ok(r.json?.ok && r.json.order.status === 'partial' && r.json.lines[0].qty_received === 40, `po pack receive ${j(r)}`);
  ok(stock(lays.id) === 124, 'stock after pack receive');

  // low stock rounds to packs: level 200, on hand 124, on order 20 → need 256 → 13 cartons (remembered 24? last was 20 carton)
  await R('PATCH', `/catalog/products/${lays.id}`, { token: owner, body: { reorderLevel: 200 } });
  r = await R('GET', '/purchase-orders/suggest', { token: owner });
  const li = r.json.groups.flatMap((g) => g.items).find((i) => i.product_id === lays.id);
  ok(li && li.by_package === true && li.pack_name === 'Carton' && Number.isInteger(li.pack_qty) && li.suggested_qty === li.pack_qty * li.pack_units, `pack rounding ${JSON.stringify(li)}`);

  // repack: Sugar Loose kg bought by 40 kg bori at Rs 140/kg
  const loose = await mk('Sugar Loose', 160, 'kg');
  const s1 = await mk('Sugar 1 kg', 165);
  const s5 = await mk('Sugar 5 kg', 800);
  const sh = await mk('Sugar 0.5 kg', 85);
  r = await R('POST', '/packs', { token: owner, body: { productId: loose.id, name: 'Bori', units: 40 } });
  const bori = r.json.packs[0];
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: loose.id, packId: bori.id, packQty: 1, packCostRs: 5600 }] } });
  ok(r.json?.ok && stock(loose.id) === 40, `bori 40 kg ${j(r)}`);
  for (const [p, q] of [[s1, 1], [s5, 5], [sh, 0.5]]) {
    r = await R('POST', '/repack/link', { token: owner, body: { productId: p.id, bulkId: loose.id, qtyEach: q } });
    ok(r.json?.ok, `link ${p.name}`);
  }
  r = await R('POST', '/repack/link', { token: owner, body: { productId: loose.id, bulkId: s1.id, qtyEach: 1 } });
  ok(r.json?.error === 'invalid_bulk', 'no chain');
  r = await R('GET', '/repack/bulk', { token: owner });
  ok(r.json.items.length === 1 && r.json.items[0].packets.length === 3, 'bulk list');

  // 20×1 + 2×5 + 10×0.5 = 35 kg, used 35.5 (0.5 wastage), packing Rs 71 → total 35.5×140 + 71 = 5041 → per kg 144.03
  r = await R('POST', '/repack', { token: cashier, body: { bulkId: loose.id, lines: [{ productId: s1.id, packets: 1 }] } });
  ok(r.status === 403, 'cashier cannot repack');
  r = await R('POST', '/repack', { token: owner, body: { bulkId: loose.id, bulkUsed: 35.5, packingCostRs: 71, lines: [{ productId: s1.id, packets: 20 }, { productId: s5.id, packets: 2 }, { productId: sh.id, packets: 10 }] } });
  ok(r.json?.ok && r.json.repack.wastage_qty === 0.5 && r.json.repack.total_cost_paisa === 504100, `repack ${j(r)}`);
  const rp = r.json.repack;
  ok(stock(loose.id) === 4.5 && stock(s1.id) === 20 && stock(s5.id) === 2 && stock(sh.id) === 10, 'stocks moved');
  const d = s.db();
  const cost = (id) => d.prepare('SELECT last_unit_cost_paisa c FROM products WHERE id = ?').get(id).c;
  ok(cost(s1.id) === 14403 && cost(s5.id) === 72014 && cost(sh.id) === 7201, `packet costs ${cost(s1.id)} ${cost(s5.id)} ${cost(sh.id)}`);
  d.close();
  r = await R('POST', '/repack', { token: owner, body: { bulkId: loose.id, lines: [{ productId: s5.id, packets: 1 }] } });
  ok(r.json?.error === 'not_enough_bulk' && r.json.on_hand === 4.5, `blocked ${j(r)}`);
  r = await R('POST', '/repack', { token: owner, body: { bulkId: loose.id, override: true, lines: [{ productId: s5.id, packets: 1 }] } });
  ok(r.json?.error === 'not_enough_bulk' && stock(loose.id) === 4.5, `no owner override any more ${j(r)}`);
  r = await R('POST', '/repack', { token: owner, body: { bulkId: loose.id, wastage: 0.5, lines: [{ productId: s1.id, packets: 4 }] } });
  ok(r.json?.ok && stock(loose.id) === 0 && stock(s1.id) === 24, `repack to zero ${j(r)}`);
  const rp2 = r.json.repack;

  // sale of packet uses repack cost snapshot
  const sale = await s.sell(cashier, { paymentMethod: 'cash', lines: [{ productId: s1.id, qty: 1 }] });
  ok(sale, 'sold packet');

  // packets low + bulk available → repack hint, not in PO suggest
  await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: loose.id, packId: bori.id, packQty: 1, packCostRs: 5600 }] } });
  await R('PATCH', `/catalog/products/${s1.id}`, { token: owner, body: { reorderLevel: 30 } });
  r = await R('GET', '/stock/reorder', { token: owner });
  const ri = r.json.items.find((i) => i.id === s1.id);
  ok(ri?.repack?.can_make === 40 && ri.repack.bulk_id === loose.id, `repack hint ${JSON.stringify(ri)}`);
  r = await R('GET', '/purchase-orders/suggest', { token: owner });
  ok(!r.json.groups.some((g) => g.items.some((i) => i.product_id === s1.id)), 'packet skipped in PO suggest');

  // undo: rp2 (1 kg ×4 + 0.5 wastage) packets still there
  r = await R('POST', `/repack/${rp2.id}/undo`, { token: cashier });
  ok(r.status === 403, 'cashier cannot undo');
  const looseBefore = stock(loose.id);
  r = await R('POST', `/repack/${rp2.id}/undo`, { token: owner });
  ok(r.json?.ok && stock(s1.id) === 19 && stock(loose.id) === looseBefore + 4.5, `undo ${j(r)}`);
  r = await R('POST', `/repack/${rp2.id}/undo`, { token: owner });
  ok(r.json?.error === 'repack_already_undone', 'undo once');

  r = await R('GET', '/repack', { token: owner });
  ok(r.json.items.length === 2 && r.json.items.some((x) => x.voided_at), 'history');
  r = await R('GET', '/stock/write-offs', { token: owner });
  ok(r.json?.repack_wastage?.value_paisa === 7000, `wastage report ${j(r)}`);
  r = await R('GET', '/activity?kind=repack.create', { token: owner });
  ok((r.json?.items ?? []).length === 2, 'activity');

  // backup v10 round trip
  const ex = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const b = ex.json?.bundle ?? ex.json;
  ok(b.header.schema_version === 16 && b.batch2.repack.packs.length === 2 && b.batch2.repack.repacks.length === 2, 'backup v10');
  await R('POST', `/packs/${carton.id}/remove`, { token: owner });
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: b } });
  ok(r.json?.ok, `restore ${j(r)}`);
  r = await R('GET', `/packs?productId=${lays.id}`, { token: owner });
  ok(r.json.items.length === 1, 'pack back');
  r = await R('GET', '/repack/bulk', { token: owner });
  ok(r.json.items[0]?.packets.length === 3, 'links back');
  r = await R('GET', `/repack/${rp.id}`, { token: owner });
  ok(r.json?.ok && r.json.lines.length === 3, 'repack back');
  console.log(`packs+repack: ${c.passed} checks passed`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
