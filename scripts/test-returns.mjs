#!/usr/bin/env node
/** Slice 3 — Returns: POST/GET /returns. Run: node scripts/test-returns.mjs */
import { startApi, seed, makeChecks, Database, karachiYmd } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('returns', Number(process.env.API_PORT ?? 3873));
const { request } = api;
try {
  const s = await seed(api, { cashierRefunds: true });
  const { owner, cashier, atta, daal, soap, rashid, sell, stock, balance } = s;
  const ymd = karachiYmd(new Date());
  const insights = async () => (await request('GET', '/analytics/insights', { token: owner })).json;
  const summary = async () => (await request('GET', '/analytics', { token: owner })).json;
  const profit = async () => (await request('GET', '/analytics/profit-compare', { token: owner })).json;
  const today = async () => (await request('GET', '/cashier/today', { token: cashier })).json;
  const taxBase = async () => (await request('GET', `/tax/summary?from=${ymd}&to=${ymd}`, { token: owner })).json.sales_base_paisa;
  const detail = async (id) => (await request('GET', `/sales/${id}`, { token: owner })).json.sale;

  // Walk-in cash: atta 1 + soap 3 = 1480 + 360 = 1840
  const w = await sell(cashier, { paymentMethod: 'cash', lines: [{ productId: atta.id, qty: 1 }, { productId: soap.id, qty: 3 }] });
  // Rashid khata: daal 4 = 1000
  const k = await sell(owner, { paymentMethod: 'udhaar', partyId: rashid.id, lines: [{ productId: daal.id, qty: 4 }] });
  const till0 = (await insights()).cash_till;
  const sum0 = await summary();
  const prof0 = (await profit()).this_week;
  ok(till0.expected_paisa === 184000, 'till before');
  ok((await taxBase()) === 284000, 'tax base before');
  ok(prof0.gross_profit_paisa === (148000 - 130000) + 3 * 2000 + 4 * 5000, `profit before ${prof0.gross_profit_paisa}`);

  const wd = await detail(w.id);
  const attaLine = wd.lines.find((l) => l.product_id === atta.id);
  const soapLine = wd.lines.find((l) => l.product_id === soap.id);
  const kd = await detail(k.id);
  const daalLine = kd.lines[0];

  // ── Validation ──
  let r = await request('POST', '/returns', { body: { saleId: w.id, lines: [] } });
  ok(r.status === 401, 'anon 401');
  r = await request('POST', '/returns', { token: cashier, body: { saleId: w.id, lines: [] } });
  ok(r.status === 400 && r.json.error === 'nothing_to_return', 'nothing to return');
  r = await request('POST', '/returns', { token: cashier, body: { saleId: w.id, lines: [{ saleLineId: soapLine.id, qty: 4 }] } });
  ok(r.status === 400 && r.json.error === 'qty_exceeds_sold', 'qty > sold');
  r = await request('POST', '/returns', { token: cashier, body: { saleId: w.id, lines: [{ saleLineId: daalLine.id, qty: 1 }] } });
  ok(r.status === 400 && r.json.error === 'invalid_line', 'line from other bill');
  r = await request('POST', '/returns', { token: cashier, body: { saleId: w.id, lines: [{ saleLineId: soapLine.id, qty: 1 }], refundKhataPaisa: 12000 } });
  ok(r.status === 400 && r.json.error === 'khata_needs_customer', 'walk-in khata refused');
  r = await request('POST', '/returns', { token: cashier, body: { saleId: w.id, lines: [{ saleLineId: soapLine.id, qty: 1 }], refundCashPaisa: 5000, refundKhataPaisa: 0 } });
  ok(r.status === 400 && r.json.error === 'refund_mismatch', 'mismatch refused');
  r = await request('POST', '/returns', { token: cashier, body: { saleId: 'nope', lines: [] } });
  ok(r.status === 404, 'bill 404');

  // ── Cashier: walk-in return, soap 2 back to stock + atta 1 damaged → cash 1720 ──
  const soap0 = stock(soap.id);
  const atta0 = stock(atta.id);
  r = await request('POST', '/returns', {
    token: cashier,
    body: { saleId: w.shortId, lines: [{ saleLineId: soapLine.id, qty: 2 }, { saleLineId: attaLine.id, qty: 1, restock: false }], reason: 'Damaged' },
  });
  ok(r.status === 201 && r.json.ok, `cashier return ${r.status} ${r.raw}`);
  const ret1 = r.json.return;
  ok(ret1.total_paisa === 24000 + 148000 && ret1.refund_cash_paisa === 172000 && ret1.refund_khata_paisa === 0, 'walk-in default cash');
  ok(ret1.short_id.startsWith('R') && ret1.sale_short_id === w.shortId && ret1.returned_by_name === 'Bilal Cashier', 'return fields');
  ok(stock(soap.id) === soap0 + 2 && stock(atta.id) === atta0, 'restock only ticked lines');
  r = await request('POST', '/returns', { token: cashier, body: { saleId: w.id, lines: [{ saleLineId: soapLine.id, qty: 2 }] } });
  ok(r.status === 400 && r.json.error === 'qty_exceeds_sold', 'cannot return more than left');

  // ── Rashid khata return: daal 1 default to khata ──
  r = await request('POST', '/returns', { token: owner, body: { saleId: k.id, lines: [{ saleLineId: daalLine.id, qty: 1 }] } });
  ok(r.status === 201 && r.json.return.refund_khata_paisa === 25000 && r.json.return.refund_cash_paisa === 0, 'customer default khata');
  ok((await balance(rashid.id)) === 100000 - 25000, 'khata reduced');
  // split refund: daal 2 → 250 cash + 250 khata
  r = await request('POST', '/returns', { token: owner, body: { saleId: k.id, lines: [{ saleLineId: daalLine.id, qty: 2 }], refundCashPaisa: 25000, refundKhataPaisa: 25000 } });
  ok(r.status === 400 && r.json.error === 'refund_exceeds_cash', 'cash refund capped at cash paid (bill was all udhaar)');
  r = await request('POST', '/returns', { token: owner, body: { saleId: k.id, lines: [{ saleLineId: daalLine.id, qty: 2 }], refundCashPaisa: 0, refundKhataPaisa: 50000 } });
  ok(r.status === 201, 'khata-only refund');
  ok((await balance(rashid.id)) === 25000, 'khata after refund');
  const rdb = new Database(api.dbPath, { readonly: true });
  const credits = rdb.prepare(`SELECT * FROM party_ledger WHERE return_id IS NOT NULL`).all();
  ok(credits.length === 2 && credits.every((x) => x.collected_on == null && x.entry_type === 'credit'), 'return credits not cash');
  ok(rdb.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='sale.return'`).get().n === 3, 'audit');
  rdb.close();

  // ── Net effects ──
  const till1 = (await insights()).cash_till;
  ok(till1.refunds_cash_paisa === 172000, 'refunds in till');
  ok(till1.udhaar_received_paisa === 0, 'khata refunds not received');
  ok(till1.expected_paisa === 184000 - 172000, `till expected ${till1.expected_paisa}`);
  const ct = await today();
  ok(ct.total_paisa === 284000 - 172000 - 75000 && ct.return_count === 3 && ct.returns_paisa === 247000, `cashier today net ${ct.total_paisa}`);
  const sum1 = await summary();
  ok(sum1.today.total_paisa === 37000 && sum1.today.gross_paisa === sum0.today.total_paisa, 'analytics net sales');
  const prof1 = (await profit()).this_week;
  // Left: soap 1 (+20), daal 1 (+50). Damaged atta: revenue reversed, cost stays → -1300.
  ok(prof1.sales_paisa === 37000, `profit sales ${prof1.sales_paisa}`);
  ok(prof1.gross_profit_paisa === 2000 + 5000 - 130000, `profit ${prof1.gross_profit_paisa}`);
  ok(sum1.profit.gross_profit_paisa === 2000 + 5000 - 130000, `today profit ${sum1.profit.gross_profit_paisa}`);
  const top = sum1.today.top_products;
  ok(!top.some((t) => t.product_id === atta.id), 'fully returned item off top list');
  ok((await taxBase()) === 37000, 'tax base net');
  const fy = (await request('GET', '/tax/fiscal-years', { token: owner })).json;
  ok(fy.fiscal_years[0].sales_base_paisa === 37000, 'fy net');

  // ── Reads ──
  let j = (await request('GET', '/returns', { token: cashier })).json;
  ok(j.total === 3 && j.total_paisa === 247000, 'list today');
  j = (await request('GET', `/returns?saleId=${k.id}`, { token: owner })).json;
  ok(j.total === 2, 'list by bill');
  j = (await request('GET', `/returns/${ret1.short_id}`, { token: cashier })).json;
  ok(j.ok && j.return.lines.length === 2 && j.return.lines.some((l) => !l.restocked), 'detail by return no');
  j = (await request('GET', `/returns/bills?q=${w.shortId.slice(0, 4)}`, { token: cashier })).json;
  ok(j.items.some((i) => i.id === w.id), 'find bill by no');
  j = (await request('GET', `/returns/bills?q=rashid`, { token: cashier })).json;
  ok(j.items.length === 1 && j.items[0].id === k.id, 'find bill by customer');
  // Old bill: cashier may return it
  const old = await sell(owner, { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 1 }] });
  const rw = new Database(api.dbPath);
  rw.prepare(`UPDATE sales SET recorded_at = ? WHERE id = ?`).run(new Date(Date.now() - 5 * 86400000).toISOString(), old.id);
  rw.close();
  j = (await request('GET', `/returns/bills/${old.shortId}`, { token: cashier })).json;
  ok(j.ok && j.sale.id === old.id, 'cashier opens old bill for return');
  r = await request('POST', '/returns', { token: cashier, body: { saleId: old.id, lines: [{ saleLineId: j.sale.lines[0].id, qty: 1 }] } });
  ok(r.status === 201, 'cashier returns old bill');

  // ── Sales list tags + filter ──
  const list = (await request('GET', '/sales?status=returned', { token: owner })).json;
  ok(list.total === 2, `returned filter ${list.total}`);
  const wl = list.items.find((i) => i.id === w.id);
  ok(wl.return_state === 'part', 'walk-in part returned');
  ok((await detail(k.id)).return_state === 'part', 'khata bill part');
  r = await request('POST', '/returns', { token: owner, body: { saleId: k.id, lines: [{ saleLineId: daalLine.id, qty: 1 }], refundCashPaisa: 0, refundKhataPaisa: 25000 } });
  ok(r.status === 201 && r.json.return.refund_cash_paisa === 0, 'last daal to khata');
  const kd2 = await detail(k.id);
  ok(kd2.return_state === 'full' && kd2.returns.length === 3, 'khata bill fully returned');
  r = await request('POST', '/returns', { token: owner, body: { saleId: k.id, lines: [{ saleLineId: daalLine.id, qty: 1 }] } });
  ok(r.status === 400, 'nothing left to return');

  // Removed bill cannot be returned
  const v = await sell(owner, { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 1 }] });
  await request('POST', `/sales/${v.id}/void`, { token: owner, body: { reason: 'x' } });
  const vd = await detail(v.id);
  r = await request('POST', '/returns', { token: owner, body: { saleId: v.id, lines: [{ saleLineId: vd.lines[0].id, qty: 1 }] } });
  ok(r.status === 400 && r.json.error === 'sale_voided', 'removed bill refused');

  // Backup round-trip
  const exp = await request('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  ok(exp.json.sale_returns.length === 5 && exp.json.sale_return_lines.length === 6, 'export returns');
  const bal0 = await balance(rashid.id);
  const res = await request('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: exp.json } });
  ok(res.status < 300, `restore ${res.raw.slice(0, 200)}`);
  ok((await balance(rashid.id)) === bal0, 'balance kept');
  ok((await taxBase()) === 0 && (await insights()).cash_till.refunds_cash_paisa === 172000 + 12000, 'totals after restore');
  const d2 = (await request('GET', `/returns/${ret1.id}`, { token: owner })).json;
  ok(d2.ok && d2.return.lines.length === 2, 'return detail after restore');

  console.log(`\nPASS ${c.passed} checks`);
} catch (err) {
  console.error('\nFAIL after', c.passed, 'checks:', err.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
