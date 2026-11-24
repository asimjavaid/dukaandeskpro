#!/usr/bin/env node
/** Purchase orders: create, low-stock suggest by last supplier, send, partial + full receive via purchase bill,
 * new sale price, cancel, carton refused, activity, backup v9 round trip. SKIP_BUILD=1 node scripts/test-purchase-orders.mjs */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('po', Number(process.env.API_PORT ?? 3891));
const R = api.request;
const j = (r) => r.raw.slice(0, 300);
try {
  const s = await seed(api);
  const { owner, cashier, soap, daal, atta, stock } = s;
  const sup2 = (await R('POST', '/suppliers', { token: owner, body: { name: 'Walk-in Ali', phone: '0301-7654321' } })).json.supplier;
  ok(sup2?.id, 'quick supplier');
  const sj = (await R('GET', '/suppliers', { token: owner })).json;
  const sup1 = (sj.items ?? []).find((x) => x.name === 'Test Supplier');

  let r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup1.id, lines: [{ productId: soap.id, mode: 'carton', cartons: 1, unitsPerCarton: 12, cartonCostRs: 1000 }] } });
  ok(r.json?.error === 'carton_removed', `carton refused ${j(r)}`);

  // low stock: soap 100 on hand, level 120 → suggest 140; daal level 150 bought from sup2
  await R('PATCH', `/catalog/products/${soap.id}`, { token: owner, body: { reorderLevel: 120 } });
  await R('PATCH', `/catalog/products/${daal.id}`, { token: owner, body: { reorderLevel: 150 } });
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup2.id, lines: [{ productId: daal.id, mode: 'loose', pieces: 1, unitCostRs: 200 }] } });
  ok(r.json?.ok, `daal from sup2 ${j(r)}`);
  r = await R('GET', '/purchase-orders/suggest', { token: owner });
  const groups = r.json?.groups ?? [];
  const g1 = groups.find((g) => g.supplier_id === sup1.id);
  const g2 = groups.find((g) => g.supplier_id === sup2.id);
  ok(g1?.items.some((i) => i.product_id === soap.id && i.suggested_qty === 140), `soap under sup1 ${j(r)}`);
  ok(g2?.items.some((i) => i.product_id === daal.id), `daal under last supplier sup2 ${j(r)}`);

  r = await R('POST', '/purchase-orders/from-low-stock', { token: owner, body: { groups: groups.map((g) => ({ supplierId: g.supplier_id, lines: g.items.map((i) => ({ productId: i.product_id, qty: i.suggested_qty })) })) } });
  ok(r.json?.ok && r.json.orders.length === groups.length, `orders from low stock ${j(r)}`);
  r = await R('GET', '/purchase-orders/suggest', { token: owner });
  ok(!(r.json.groups ?? []).some((g) => g.items.some((i) => i.product_id === soap.id)), 'on-order items not suggested again');

  // manual order
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup1.id, lines: [{ productId: atta.id, qty: 10, expectedCostRs: 1300 }, { productId: soap.id, qty: 24 }] } });
  ok(r.json?.ok && r.json.order.status === 'draft' && r.json.lines.length === 2, `create order ${j(r)}`);
  const po = r.json.order;
  r = await R('POST', '/purchase-orders', { token: cashier, body: { supplierId: sup1.id, lines: [{ productId: atta.id, qty: 1 }] } });
  ok(r.status === 403, 'cashier cannot make orders');
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup1.id, lines: [{ productId: atta.id, qty: 1.5 }] } });
  ok(r.json?.error === 'invalid_qty', 'whole units only');
  r = await R('PATCH', `/purchase-orders/${po.id}`, { token: owner, body: { lines: [{ productId: atta.id, qty: 10, expectedCostRs: 1300 }, { productId: soap.id, qty: 20 }] } });
  ok(r.json?.ok && r.json.lines.find((l) => l.product_id === soap.id).qty_ordered === 20, 'edit draft');
  r = await R('POST', `/purchase-orders/${po.id}/sent`, { token: owner });
  ok(r.json?.order?.status === 'sent' && r.json.order.sent_at, 'sent');
  const lines = r.json.lines;
  const la = lines.find((l) => l.product_id === atta.id);
  const ls = lines.find((l) => l.product_id === soap.id);

  // partial receive: 6 atta at higher cost + new sale price, paid 5000
  const attaBefore = stock(atta.id);
  r = await R('POST', `/purchase-orders/${po.id}/receive`, { token: owner, body: { lines: [{ orderLineId: la.id, qty: 6, unitCostRs: 1400, newPriceRs: 1550 }], paidRs: 5000 } });
  ok(r.json?.ok && r.json.order.status === 'partial' && r.json.billId, `partial ${j(r)}`);
  ok(stock(atta.id) === attaBefore + 6, 'stock up 6');
  const bill = (await R('GET', `/purchases/${r.json.billId}`, { token: owner })).json;
  ok(bill.invoice.total_paisa === 840000 && bill.invoice.due_paisa === 340000 && bill.invoice.order_number === po.number, `bill ${JSON.stringify(bill.invoice)}`);
  const d = s.db();
  const p = d.prepare('SELECT price_paisa, last_unit_cost_paisa FROM products WHERE id = ?').get(atta.id);
  const ph = d.prepare('SELECT * FROM price_history WHERE product_id = ? ORDER BY changed_at DESC').get(atta.id);
  d.close();
  ok(p.price_paisa === 155000 && p.last_unit_cost_paisa === 140000, 'new price + cost');
  ok(ph && ph.new_price_paisa === 155000 && ph.changed_by, 'price history stamped');
  r = await R('PATCH', `/purchase-orders/${po.id}`, { token: owner, body: { lines: [{ productId: atta.id, qty: 1 }] } });
  ok(r.json?.error === 'order_locked', 'partial order locked for edit');

  // second delivery: rest of atta + soap + extra daal → received
  r = await R('POST', `/purchase-orders/${po.id}/receive`, { token: owner, body: { lines: [{ orderLineId: la.id, qty: 4, unitCostRs: 1400 }, { orderLineId: ls.id, qty: 20, unitCostRs: 100 }, { productId: daal.id, qty: 5, unitCostRs: 200 }] } });
  ok(r.json?.ok && r.json.order.status === 'received' && r.json.bills.length === 2, `received ${j(r)}`);
  r = await R('POST', `/purchase-orders/${po.id}/receive`, { token: owner, body: { lines: [{ orderLineId: la.id, qty: 1, unitCostRs: 1 }] } });
  ok(r.json?.error === 'order_locked', 'received locked');

  // short delivery then close
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup2.id, lines: [{ productId: daal.id, qty: 10 }] } });
  const po2 = r.json.order;
  const l2 = r.json.lines[0];
  r = await R('POST', `/purchase-orders/${po2.id}/receive`, { token: owner, body: { lines: [{ orderLineId: l2.id, qty: 7, unitCostRs: 210 }], close: true } });
  ok(r.json?.order?.status === 'received' && r.json.lines[0].qty_received === 7, 'short + close');
  // bad product inside receive rolls back
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup2.id, lines: [{ productId: daal.id, qty: 3 }] } });
  const po3 = r.json.order;
  const st0 = stock(daal.id);
  r = await R('POST', `/purchase-orders/${po3.id}/receive`, { token: owner, body: { lines: [{ orderLineId: r.json.lines[0].id, qty: 3, unitCostRs: 200 }, { productId: 'nope', qty: 1, unitCostRs: 1 }] } });
  ok(r.json?.ok === false && stock(daal.id) === st0, `rollback ${j(r)}`);
  r = await R('POST', `/purchase-orders/${po3.id}/cancel`, { token: owner });
  ok(r.json?.order?.status === 'cancelled', 'cancel');

  r = await R('GET', '/purchase-orders?status=open', { token: owner });
  ok(r.json?.ok && !r.json.items.some((o) => o.id === po3.id || o.id === po.id), 'open filter');

  r = await R('GET', '/activity?kind=purchase_order.receive', { token: owner });
  ok((r.json?.items ?? []).length >= 3, `activity ${j(r)}`);

  // backup v9 round trip
  const exp0 = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const exp = { json: exp0.json?.bundle ?? exp0.json, raw: exp0.raw };
  ok(exp.json?.header?.schema_version === 16 && exp.json.batch2?.orders?.orders?.length >= 3, `backup v9 ${exp.raw.slice(0, 120)}`);
  r = await R('POST', `/purchase-orders/${po3.id}/cancel`, { token: owner });
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: exp.json } });
  ok(r.json?.ok, `restore ${j(r)}`);
  const back = (await R('GET', `/purchase-orders/${po.id}`, { token: owner })).json;
  ok(back.ok && back.order.status === 'received' && back.bills.length === 2, `order back after restore ${JSON.stringify(back).slice(0, 200)}`);
  console.log(`purchase orders: ${c.passed} checks passed`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
