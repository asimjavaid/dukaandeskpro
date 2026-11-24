#!/usr/bin/env node
/**
 * Batch 3 API: loyalty points (earn, redeem, void / return / edit give back), rules, backup.
 * Run: SKIP_BUILD=1 node scripts/test-batch3.mjs
 */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('batch3', Number(process.env.API_PORT ?? 3887));
const R = api.request;
const j = (r) => r.raw.slice(0, 240);

try {
  const s = await seed(api, { cashierRefunds: true });
  const { owner, cashier, soap, rashid } = s;
  const pts = async () => {
    const l = (await R('GET', '/parties', { token: owner })).json;
    return (l.parties ?? l.items ?? l).find((p) => p.id === rashid.id)?.loyalty_points;
  };

  let r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', partyId: rashid.id, loyaltyRedeemPoints: 1, lines: [{ productId: soap.id, qty: 1 }] } });
  ok(r.json?.error === 'loyalty_off', `redeem refused when off ${j(r)}`);
  r = await R('POST', '/settings/rules', { token: owner, body: { loyalty_enabled: true, loyalty_rs_per_point: 100, loyalty_point_value_paisa: 100 } });
  ok(r.json?.ok && r.json.rules.loyalty_enabled === true, `enable loyalty ${j(r)}`);
  r = await R('POST', '/settings/rules', { token: owner, body: { loyalty_rs_per_point: 0 } });
  ok(r.json?.ok === false || r.status >= 400, 'bad rate refused');
  const st = (await R('GET', '/auth/status', { token: cashier })).json;
  ok(JSON.stringify(st).includes('"loyalty_enabled":true'), 'loyalty in /auth/status');

  // earn: Rs 1200 → 12 points
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', partyId: rashid.id, lines: [{ productId: soap.id, qty: 10 }] } });
  ok(r.json?.ok && r.json.sale.loyaltyEarnedPoints === 12 && r.json.sale.loyaltyBalance === 12, `earn 12 ${j(r)}`);
  const big = r.json.sale;
  ok((await pts()) === 12, 'party list shows 12');
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 1 }] } });
  ok(r.json?.ok && r.json.sale.loyaltyEarnedPoints === 0, 'walk-in earns nothing');

  // redeem 5 on Rs 120 → Rs 115, earns 1
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', partyId: rashid.id, loyaltyRedeemPoints: 5, lines: [{ productId: soap.id, qty: 1 }] } });
  ok(r.json?.ok && r.json.sale.totalPaisa === 11500 && r.json.sale.discountPaisa === 500 && r.json.sale.loyaltyBalance === 8, `redeem 5 ${j(r)}`);
  const red = r.json.sale;
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', partyId: rashid.id, loyaltyRedeemPoints: 100, lines: [{ productId: soap.id, qty: 1 }] } });
  ok(r.json?.error === 'loyalty_not_enough', 'too many points refused');
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', loyaltyRedeemPoints: 1, lines: [{ productId: soap.id, qty: 1 }] } });
  ok(r.json?.error === 'loyalty_needs_customer', 'walk-in redeem refused');

  // edit (replace) the redeem bill with 3 points instead → balance 12 - 3 + 1 = 10
  r = await R('POST', `/sales/${red.id}/replace`, { token: owner, body: { paymentMethod: 'cash', partyId: rashid.id, loyaltyRedeemPoints: 3, lines: [{ productId: soap.id, qty: 1 }] } });
  ok(r.json?.ok && r.json.sale.loyaltyBalance === 10, `edit gives back and re-spends ${j(r)}`);
  const ed = r.json.sale;
  const det = (await R('GET', `/sales/${ed.id}`, { token: owner })).json;
  const ds = det.sale ?? det;
  ok(ds.loyalty_redeem_points === 3 && ds.discount_paisa === 300, `detail carries points ${JSON.stringify(ds).slice(0, 200)}`);

  // void → points back: 10 + 3 - 1 = 12
  r = await R('POST', `/sales/${ed.id}/void`, { token: owner, body: { reason: 'test' } });
  ok(r.json?.ok, `void ${j(r)}`);
  ok((await pts()) === 12, 'void gives points back');

  // return half of the big bill → -6, undo → +6
  const bd = (await R('GET', `/sales/${big.id}`, { token: owner })).json;
  const bl = (bd.sale?.lines ?? bd.lines)[0];
  r = await R('POST', '/returns', { token: cashier, body: { saleId: big.id, lines: [{ saleLineId: bl.id, qty: 5 }] } });
  ok(r.json?.ok && (await pts()) === 6, `return takes back points ${j(r)}`);
  r = await R('POST', `/returns/${r.json.return.id}/undo`, { token: owner });
  ok(r.json?.ok && (await pts()) === 12, 'undo puts them back');

  // backup carries loyalty
  r = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const b = r.json?.bundle ?? r.json;
  ok(JSON.stringify(b).includes('"loyalty"') && JSON.stringify(b).includes('"kind":"earn"'), 'backup has loyalty');
  console.log(`batch3: all ${c.passed} checks passed`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
