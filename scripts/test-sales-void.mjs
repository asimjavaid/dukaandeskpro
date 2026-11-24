#!/usr/bin/env node
/** Slice 2 — Remove a bill: POST /sales/:id/void. Run: node scripts/test-sales-void.mjs */
import { startApi, seed, makeChecks, Database } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('sales-void', Number(process.env.API_PORT ?? 3872));
const { request } = api;
try {
  const s = await seed(api);
  const { owner, cashier, atta, daal, soap, rashid, sell, stock, balance } = s;
  const insights = async () => (await request('GET', '/analytics/insights', { token: owner })).json;
  const summary = async () => (await request('GET', '/analytics', { token: owner })).json;
  const today = async () => (await request('GET', '/cashier/today', { token: cashier })).json;

  // Bills: cash walk-in, khata, split, kept-on-khata surplus.
  const b1 = await sell(cashier, { paymentMethod: 'cash', tenderedPaisa: 200000, lines: [{ productId: atta.id, qty: 1 }] });
  const b2 = await sell(owner, { paymentMethod: 'udhaar', partyId: rashid.id, lines: [{ productId: daal.id, qty: 2 }, { productId: soap.id, qty: 1 }] });
  const b3 = await sell(owner, { paymentMethod: 'split', partyId: rashid.id, cashAmountPaisa: 100000, udhaarAmountPaisa: 73000, lines: [{ productId: atta.id, qty: 1 }, { productId: daal.id, qty: 1 }] });
  const b4 = await sell(owner, { paymentMethod: 'cash', partyId: rashid.id, tenderedPaisa: 50000, applySurplusToKhata: true, lines: [{ productId: soap.id, qty: 2 }] });
  ok(b4.surplusCreditedPaisa === 26000, 'surplus kept 260');
  ok((await balance(rashid.id)) === 62000 + 73000 - 26000, 'balance before');
  const till0 = (await insights()).cash_till;
  ok(till0.cash_sales_paisa === 148000 + 100000 + 24000, `till cash ${till0.cash_sales_paisa}`);
  ok(till0.udhaar_received_paisa === 26000, 'surplus counts as received');
  const sum0 = await summary();
  const ct0 = await today();
  ok(ct0.sale_count === 4 && ct0.total_paisa === 148000 + 62000 + 173000 + 24000, 'today before');

  // ── Gating ──
  let r = await request('POST', `/sales/${b1.id}/void`, { token: cashier, body: { reason: 'Wrong items' } });
  ok(r.status === 403, `cashier 403, got ${r.status}`);
  r = await request('POST', `/sales/${b1.id}/void`, { body: { reason: 'x' } });
  ok(r.status === 401, 'anon 401');
  r = await request('POST', `/sales/${b1.id}/void`, { token: owner, body: { reason: '  ' } });
  ok(r.status === 400 && r.json?.error === 'reason_required', `reason required ${r.status}`);
  r = await request('POST', `/sales/nope/void`, { token: owner, body: { reason: 'x' } });
  ok(r.status === 404, 'missing 404');

  // ── Remove cash walk-in (by bill no) ──
  const attaBefore = stock(atta.id);
  r = await request('POST', `/sales/${b1.shortId}/void`, { token: owner, body: { reason: 'Wrong items' } });
  ok(r.status === 200 && r.json?.ok && r.json.sale.id === b1.id, `void b1 ${r.status} ${r.raw}`);
  ok(stock(atta.id) === attaBefore + 1, 'restocked atta');
  r = await request('POST', `/sales/${b1.id}/void`, { token: owner, body: { reason: 'again' } });
  ok(r.status === 409 && r.json?.error === 'sale_already_voided', 'double void 409');
  let d = (await request('GET', `/sales/${b1.id}`, { token: owner })).json.sale;
  ok(d.status === 'removed' && d.void_reason === 'Wrong items' && d.voided_by_name === 'Asim Owner' && d.voided_at, 'detail removed who/why/when');

  // ── Remove khata bill ──
  const daalBefore = stock(daal.id);
  const soapBefore = stock(soap.id);
  r = await request('POST', `/sales/${b2.id}/void`, { token: owner, body: { reason: 'Customer cancelled' } });
  ok(r.status === 200, 'void b2');
  ok(stock(daal.id) === daalBefore + 2 && stock(soap.id) === soapBefore + 1, 'restocked b2');
  ok((await balance(rashid.id)) === 73000 - 26000, `khata credited back ${await balance(rashid.id)}`);

  // ── Remove split ──
  r = await request('POST', `/sales/${b3.id}/void`, { token: owner, body: { reason: 'Duplicate' } });
  ok(r.status === 200, 'void b3');
  ok((await balance(rashid.id)) === -26000, 'split udhaar reversed');

  // ── Remove surplus bill: the kept-on-khata credit is reversed ──
  r = await request('POST', `/sales/${b4.id}/void`, { token: owner, body: { reason: 'Other' } });
  ok(r.status === 200, 'void b4');
  ok((await balance(rashid.id)) === 0, `surplus reversed → balance 0, got ${await balance(rashid.id)}`);

  // Reversal ledger rows are never cash received.
  const db = new Database(api.dbPath, { readonly: true });
  const rev = db.prepare(`SELECT * FROM party_ledger WHERE note LIKE '%removed'`).all();
  ok(rev.length === 3 && rev.every((x) => x.collected_on == null), 'reversal rows not dated');
  const audits = db.prepare(`SELECT * FROM audit_log WHERE action = 'sale.void'`).all();
  ok(audits.length === 4 && JSON.parse(audits.find((a) => a.subject_id === b4.id).payload_json).surplus_reversed_paisa === 26000, 'audit rows');
  db.close();

  const till1 = (await insights()).cash_till;
  ok(till1.cash_sales_paisa === 0 && till1.udhaar_received_paisa === 0 && till1.expected_paisa === 0, `till after ${JSON.stringify(till1)}`);
  const ct1 = await today();
  ok(ct1.sale_count === 0 && ct1.total_paisa === 0, 'cashier today 0');
  const sum1 = await summary();
  ok(sum1.today.total_paisa === 0 && sum0.today.total_paisa > 0, 'analytics today 0');
  ok(sum1.udhaar_outstanding_paisa === 0, 'outstanding 0');
  const topU = (await insights()).top_udhaar;
  ok(topU.length === 0, 'no top udhaar');
  const tax = (await request('GET', `/tax/summary?from=${ct1.from ? new Date(ct1.from).toISOString().slice(0, 10) : ''}`, { token: owner }));
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
  const t2 = await request('GET', `/tax/summary?from=${ymd}&to=${ymd}&rate_bp=1000`, { token: owner });
  ok(t2.status === 200 && t2.json.sales_base_paisa === 0, `tax base 0 ${t2.raw}`);
  void tax;

  // Sales list shows removed tags.
  const list = (await request('GET', '/sales?status=removed', { token: owner })).json;
  ok(list.total === 4 && list.sale_count === 0, 'list removed filter');

  // ── Old bill refused; bill with a return refused ──
  const b5 = await sell(owner, { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 1 }] });
  const b6 = await sell(owner, { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 3 }] });
  const rw = new Database(api.dbPath);
  rw.prepare(`UPDATE sales SET recorded_at = ? WHERE id = ?`).run(new Date(Date.now() - 2 * 86400000).toISOString(), b5.id);
  rw.close();
  r = await request('POST', `/sales/${b5.id}/void`, { token: owner, body: { reason: 'x' } });
  ok(r.status === 409 && r.json?.error === 'sale_not_today', `old bill refused ${r.status}`);
  const line = (await request('GET', `/sales/${b6.id}`, { token: owner })).json.sale.lines[0];
  const ret = await request('POST', '/returns', { token: owner, body: { saleId: b6.id, lines: [{ saleLineId: line.id, qty: 1 }] } });
  ok(ret.status === 201, `return made ${ret.raw}`);
  r = await request('POST', `/sales/${b6.id}/void`, { token: owner, body: { reason: 'x' } });
  ok(r.status === 409 && r.json?.error === 'sale_has_returns', 'bill with return refused');

  // ── Backup round-trip keeps void fields ──
  const exp = await request('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  ok(exp.json?.header?.schema_version === 16, 'backup v6');
  const bs = exp.json.sales.find((x) => x.id === b4.id);
  ok(bs.void_reason === 'Other' && bs.voided_by, 'export has void fields');
  ok(exp.json.sale_returns.length === 1 && exp.json.sale_return_lines.length === 1, 'export has returns');
  const restore = await request('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: exp.json } });
  ok(restore.status === 200 || restore.status === 201, `restore ${restore.status} ${restore.raw.slice(0, 200)}`);
  d = (await request('GET', `/sales/${b4.id}`, { token: owner })).json.sale;
  ok(d.status === 'removed' && d.void_reason === 'Other' && d.voided_by_name === 'Asim Owner', 'void fields survive restore');
  ok((await balance(rashid.id)) === 0, 'balance after restore 0');
  ok((await insights()).cash_till.udhaar_received_paisa === 0, 'restored reversal rows still not cash');
  {
    const dbr = new Database(api.dbPath, { readonly: true });
    const n = dbr.prepare(`SELECT COUNT(*) n FROM party_ledger WHERE note LIKE '%removed' AND collected_on IS NULL`).get().n;
    dbr.close();
    ok(n === 3, 'restored reversal rows keep NULL collected_on');
  }
  d = (await request('GET', `/sales/${b6.id}`, { token: owner })).json.sale;
  ok(d.returns.length === 1 && d.return_state === 'part', 'returns survive restore');
  // v2 copy: clears returns
  const v2 = JSON.parse(JSON.stringify(exp.json));
  v2.header.schema_version = 2;
  delete v2.sale_returns;
  delete v2.sale_return_lines;
  const r2 = await request('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: v2 } });
  ok(r2.status === 200 || r2.status === 201, `v2 restore ${r2.status} ${r2.raw.slice(0, 200)}`);
  d = (await request('GET', `/sales/${b6.id}`, { token: owner })).json.sale;
  ok(d.returns.length === 0, 'v2 restore clears returns');
  const v3bad = { ...exp.json };
  delete v3bad.sale_returns;
  const r3 = await request('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: v3bad } });
  ok(r3.status === 400, 'v3 without returns refused');

  console.log(`\nPASS ${c.passed} checks`);
} catch (err) {
  console.error('\nFAIL after', c.passed, 'checks:', err.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
