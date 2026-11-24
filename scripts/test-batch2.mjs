#!/usr/bin/env node
/**
 * Batch 2 API: digital payments, bill discount + cashier limit, rounding,
 * credit limits, supplier returns, expiry batches, write-off,
 * reorder list, product profit, price history, activity feed, import,
 * return undo, session revoke on PIN change, persistent PIN throttle, backup v7.
 * Run: SKIP_BUILD=1 node scripts/test-batch2.mjs
 */
import { startApi, seed, makeChecks, Database } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('batch2', Number(process.env.API_PORT ?? 3886));
const R = api.request;
const j = (r) => r.raw.slice(0, 220);

try {
  const s = await seed(api, { cashierRefunds: true });
  const { owner, cashier, soap, daal, atta, rashid, stock } = s;
  const sj = (await R('GET', '/suppliers', { token: owner })).json;
  const sup = (sj.items ?? sj.suppliers ?? sj)[0];

  // rules
  let r = await R('POST', '/settings/rules', { token: owner, body: { round_to_paisa: 500, cashier_discount_max_bp: 500, credit_limit_mode: 'block', drawer_kick: true, expiry_alert_days: 30 } });
  ok(r.json?.ok, `save rules ${j(r)}`);
  r = await R('POST', '/settings/rules', { token: cashier, body: { round_to_paisa: 0 } });
  ok(r.status === 403, 'cashier cannot change rules');
  const st = (await R('GET', '/auth/status', { token: cashier })).json;
  ok(JSON.stringify(st).includes('"round_to_paisa":500'), 'rules in /auth/status');

  // digital payment
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', digitalPaisa: 25000, digitalMethod: 'jazzcash', digitalRef: 'TX123', lines: [{ productId: daal.id, qty: 1 }] } });
  ok(r.json?.ok && r.json.sale.digitalPaisa === 25000, `jazzcash sale ${j(r)}`);
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', digitalPaisa: 25000, digitalMethod: 'paypal', lines: [{ productId: daal.id, qty: 1 }] } });
  ok(r.json?.error === 'invalid_digital_method', 'bad method refused');
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', digitalPaisa: 99999, digitalMethod: 'bank', lines: [{ productId: daal.id, qty: 1 }] } });
  ok(r.json?.error === 'invalid_digital_amount', 'digital > total refused');

  // discount + rounding: soap 120 x3 = 360, 5% = 18 → 342 → round 5 → 340
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', discount: { kind: 'percent', value: 5 }, lines: [{ productId: soap.id, qty: 3 }] } });
  ok(r.json?.ok && r.json.sale.totalPaisa === 34000, `5% + round to 5 = 340 ${j(r)}`);
  const discSale = r.json?.sale;
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', discount: { kind: 'percent', value: 10 }, lines: [{ productId: soap.id, qty: 3 }] } });
  ok(r.json?.error === 'discount_over_limit', 'cashier 10% refused');
  r = await R('POST', '/sales', { token: owner, body: { paymentMethod: 'cash', discount: { kind: 'amount', value: 60 }, lines: [{ productId: soap.id, qty: 3 }] } });
  ok(r.json?.ok && r.json.sale.totalPaisa === 30000, `owner Rs 60 off ${j(r)}`);

  // return shares discount: 1 of 3 soaps from 342/360 bill → 114
  const dd = (await R('GET', `/sales/${discSale.id}`, { token: owner })).json;
  const dl = (dd.sale?.lines ?? dd.lines)[0];
  r = await R('POST', '/returns', { token: cashier, body: { saleId: discSale.id, lines: [{ saleLineId: dl.id, qty: 1 }], reason: 'kharab' } });
  ok(r.json?.ok && Math.abs(r.json.return.total_paisa - 11333) <= 100, `return share of discount ${j(r)}`);
  const ret = r.json?.return;
  const before = stock(soap.id);
  r = await R('POST', `/returns/${ret?.id}/undo`, { token: cashier });
  ok(r.status === 403, 'cashier cannot undo');
  r = await R('POST', `/returns/${ret?.id}/undo`, { token: owner });
  ok(r.json?.ok && stock(soap.id) === before - 1, `owner undo same day ${j(r)}`);

  // pack selling removed: sizes are separate products
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 1, unit: 'dozen' }] } });
  ok(r.json?.ok !== true && r.json?.error === 'invalid_unit', `dozen refused ${j(r)}`);
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 1, unit: 'carton' }] } });
  ok(r.json?.ok !== true && r.json?.error === 'invalid_unit', `carton refused ${j(r)}`);

  // credit limit
  r = await R('POST', `/parties/${rashid.id}/credit-limit`, { token: owner, body: { limitRs: 2000 } });
  ok(r.json?.ok, `set limit ${j(r)}`);
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'udhaar', partyId: rashid.id, lines: [{ productId: atta.id, qty: 2 }] } });
  ok(r.json?.error === 'credit_limit_exceeded', `block over limit ${j(r)}`);
  r = await R('POST', '/sales', { token: owner, body: { paymentMethod: 'udhaar', partyId: rashid.id, overrideCreditLimit: true, lines: [{ productId: atta.id, qty: 2 }] } });
  ok(r.json?.ok, 'owner override');

  // purchases with expiry, expiring, write-off, reorder
  const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: daal.id, mode: 'loose', pieces: 10, unitCostRs: 200, expiryDate: soon, batchNo: 'B7' }], paidRs: 0 } });
  ok(r.json?.ok, `purchase with expiry ${j(r)}`);
  r = await R('GET', '/stock/expiring', { token: owner });
  const ex = (r.json?.items ?? [])[0];
  ok(ex && JSON.stringify(ex).includes('B7'), `near-expiry alert ${j(r)}`);
  r = await R('POST', '/stock/write-off', { token: owner, body: { productId: daal.id, qty: 2, reason: 'expired', batchLineId: ex?.batch_line_id } });
  ok(r.json?.ok, `write-off ${j(r)}`);
  r = await R('GET', '/stock/write-offs', { token: owner });
  ok((r.json?.items ?? r.json?.rows ?? []).length >= 1, `write-off report ${j(r)}`);
  r = await R('PATCH', `/catalog/products/${daal.id}`, { token: owner, body: { reorderLevel: 500, priceRs: 260 } });
  ok(r.json?.ok !== false, `reorder level + price ${j(r)}`);
  r = await R('GET', '/stock/reorder', { token: owner });
  ok((r.json?.items ?? []).some((x) => x.id === daal.id || x.product_id === daal.id), `reorder list ${j(r)}`);
  r = await R('GET', `/catalog/products/${daal.id}/price-history`, { token: owner });
  ok(JSON.stringify(r.json).includes('26000'), `price history ${j(r)}`);

  // supplier return
  const sb = stock(atta.id);
  r = await R('POST', `/suppliers/${sup.id}/returns`, { token: owner, body: { lines: [{ productId: atta.id, qty: 2, unitCostRs: 1300 }], note: 'phata bag' } });
  ok(r.json?.ok && stock(atta.id) === sb - 2, `supplier return ${j(r)}`);

  // analytics, profit, activity
  r = await R('GET', '/analytics', { token: owner });
  ok(JSON.stringify(r.json).includes('jazzcash'), `analytics digital ${j(r)}`);
  const today = new Date(Date.now() + 5 * 36e5).toISOString().slice(0, 10);
  r = await R('GET', `/analytics/product-profit?from=${today}&to=${today}`, { token: owner });
  ok(r.json?.ok !== false && (r.json?.items ?? r.json?.rows ?? []).length >= 2, `product profit ${j(r)}`);
  r = await R('GET', '/activity', { token: owner });
  ok((r.json?.items ?? []).length >= 5, `activity feed ${j(r)}`);
  r = await R('GET', '/activity', { token: cashier });
  ok(r.status === 403, 'cashier no activity');

  // import
  const rows = [
    { name: 'Tapal Danedar 95g', price: '180', barcode: '8964000000017', stock: '24', cost: '150', reorder: '6' },
    { name: 'Lux Soap', price: '120' },
    { name: 'Cheeni loose', price: '160', unit: 'kg', stock: '12.5' },
    { name: '', price: '5' },
  ];
  r = await R('POST', '/catalog/import', { token: owner, body: { rows, dryRun: true } });
  ok(r.json?.to_add === 2 && r.json.skipped === 1 && r.json.errors === 1, `import dry run ${j(r)}`);
  r = await R('POST', '/catalog/import', { token: owner, body: { rows, dryRun: false } });
  ok(r.json?.added === 2, `import ${j(r)}`);
  r = await R('POST', '/catalog/import', { token: cashier, body: { rows, dryRun: true } });
  ok(r.status === 403, 'cashier cannot import');

  // backup v7 round trip keeps batch2 data
  r = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const bundle = r.json?.bundle ?? r.json;
  ok(bundle?.header?.schema_version === 16 && bundle.batch2?.supplier_returns?.length === 1, `backup v7 ${j(r)}`);

  // PIN throttle + session revoke
  const users = (await R('GET', '/auth/status')).json;
  const cashierId = (users.users ?? users.cashiers ?? []).find((u) => /Bilal/.test(u.displayName ?? u.display_name ?? ''))?.id;
  for (let i = 0; i < 5; i++) await R('POST', '/auth/login', { body: { userId: cashierId, pin: '0000' } });
  r = await R('POST', '/auth/login', { body: { userId: cashierId, pin: '5678' } });
  ok(r.json?.error === 'too_many_attempts' || r.json?.code === 'too_many_attempts', `throttled ${j(r)}`);
  const d = new Database(api.dbPath, { readonly: true });
  ok(d.prepare('SELECT COUNT(*) c FROM auth_throttle').get().c >= 1, 'throttle persisted');
  d.close();
  r = await R('POST', '/settings/pin', { token: owner, body: { currentPin: '2468', newPin: '8642' } });
  const fresh = r.json?.sessionToken;
  ok(r.json?.ok && fresh, `own PIN change re-signs ${j(r)}`);
  
  r = await R('GET', '/activity', { token: owner });
  ok(r.status === 401, `old session revoked (${r.status})`);
  r = await R('GET', '/activity', { token: fresh });
  ok(r.status === 200, 'new session works');
  console.log('batch2: all checks passed');
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
