#!/usr/bin/env node
/**
 * DukaanDesk Pro slice P3: tills, pairing, per-till bill numbers and shifts, one till per cashier,
 * manager role (any till's shift, refund approval, price override), till limit (trial = 2),
 * server-only install, parallel selling on two tills.
 *   DD_DB=pg node scripts/test-lite-tills.mjs
 */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const api = await startApi('lite-tills', Number(process.env.API_PORT ?? 3941));
const R = api.request;
const c = makeChecks();
const { ok } = c;
const at = () => new Date().toISOString();

try {
  const s = await seed(api);
  const { owner, cashier } = s;
  const cashierId = (await R('GET', '/auth/me', { token: cashier })).json.session.userId;

  // ---- this PC is Till 1 ----
  let r = await R('GET', '/tills/me');
  ok(r.json?.till?.id === 'till-1' && r.json.till.code === 1 && r.json.mode === 'main_till', `main PC is Till 1 ${r.raw}`);
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.soap.id, qty: 1 }] } });
  ok(r.json?.sale?.shortId === 'T1-000001' && r.json.sale.billNo === 1, `first bill T1-000001 (${r.json?.sale?.shortId})`);
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.soap.id, qty: 1 }] } });
  ok(r.json?.sale?.shortId === 'T1-000002', `second bill T1-000002 (${r.json?.sale?.shortId})`);
  const bill2 = r.json.sale;
  r = await R('GET', `/sales/${encodeURIComponent('T1-000002')}`, { token: owner });
  ok(r.json?.sale?.id === bill2.id || r.json?.id === bill2.id, `look up a bill by T1-000002 ${r.raw.slice(0, 120)}`);

  // ---- tills list + add + limit ----
  r = await R('GET', '/tills', { token: cashier });
  ok(r.status === 403, `cashier cannot list tills (${r.status})`);
  r = await R('GET', '/tills', { token: owner });
  ok(r.json?.ok && r.json.limit === 2 && r.json.used === 1 && r.json.tills.length === 1, `trial: 1 of 2 tills used ${r.raw.slice(0, 200)}`);
  r = await R('POST', '/tills', { token: cashier, body: {} });
  ok(r.status === 403, 'cashier cannot add a till');
  r = await R('POST', '/tills', { token: owner, body: { name: 'Counter 2' } });
  ok(r.json?.ok && r.json.till.code === 2 && /^\d{6}$/.test(r.json.pairCode) && r.json.till.pairing && !r.json.till.paired, `add Till 2 with a 6-digit code ${r.raw.slice(0, 200)}`);
  const t2 = r.json.till;
  const code2 = r.json.pairCode;
  r = await R('POST', '/tills', { token: owner, body: {} });
  ok(r.json?.ok === false && r.json.error === 'till_limit' && r.json.limit === 2, `third till refused on the 2-till trial ${r.raw}`);

  // ---- pairing ----
  const wrong = code2 === '000000' ? '111111' : '000000';
  r = await R('POST', '/tills/pair', { body: { code: wrong } });
  ok(r.json?.ok === false && r.json.error === 'invalid_pair_code', 'wrong pairing code refused');
  r = await R('POST', '/tills/pair', { body: { code: code2, deviceName: 'COUNTER2-PC' } });
  ok(r.json?.ok && r.json.deviceKey && r.json.till.id === t2.id && r.json.till.code === 2, `pair Till 2 ${r.raw.slice(0, 160)}`);
  const key2 = r.json.deviceKey;
  r = await R('POST', '/tills/pair', { body: { code: code2 } });
  ok(r.json?.ok === false, 'a pairing code works once');
  r = await R('GET', '/tills/me', { till: key2 });
  ok(r.json?.till?.id === t2.id, 'device key → Till 2');
  r = await R('GET', '/tills/me', { till: 'not-a-key' });
  ok(r.json?.till === null && r.json.keyRejected === true, 'unknown device key → no till');
  r = await R('POST', '/sales', { token: cashier, till: 'not-a-key', body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.soap.id, qty: 1 }] } });
  ok(r.json?.ok === false && r.json.error === 'no_till', `unknown till cannot sell (${r.json?.error})`);

  // ---- manager ----
  r = await R('POST', '/owner/staff', { token: owner, body: { name: 'Mona Manager', role: 'manager', pin: '1357' } });
  ok(r.json?.ok, `add a manager ${r.raw.slice(0, 160)}`);
  const managerId = r.json.staff.id;
  r = await R('POST', '/auth/login', { till: key2, body: { userId: managerId, pin: '1357' } });
  ok(r.json?.ok && r.json.session.role === 'manager' && r.json.session.till?.id === t2.id, 'manager signs in on Till 2');
  const manager2 = r.json.sessionToken;

  // ---- per-till bill numbers ----
  r = await R('POST', '/sales', { token: manager2, till: key2, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.atta.id, qty: 1 }] } });
  ok(r.json?.sale?.shortId === 'T2-000001', `Till 2 numbers on its own (${r.json?.sale?.shortId})`);
  r = await R('POST', '/sales', { token: manager2, till: key2, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.atta.id, qty: 5000 }] } });
  ok(r.status === 409, 'oversell refused');
  r = await R('POST', '/sales', { token: manager2, till: key2, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.atta.id, qty: 1 }] } });
  ok(r.json?.sale?.shortId === 'T2-000002', `a refused sale leaves no gap (${r.json?.sale?.shortId})`);
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.soap.id, qty: 1 }] } });
  ok(r.json?.sale?.shortId === 'T1-000003', `Till 1 carries on (${r.json?.sale?.shortId})`);

  // ---- one till at a time ----
  r = await R('POST', '/auth/login', { body: { userId: cashierId, pin: '5678' } });
  const cashierT1 = r.json.sessionToken;
  r = await R('POST', '/auth/login', { till: key2, body: { userId: cashierId, pin: '5678' } });
  ok(r.json?.ok && r.json.session.till?.id === t2.id, 'cashier signs in on Till 2');
  const cashierT2 = r.json.sessionToken;
  r = await R('GET', '/auth/me', { token: cashierT1 });
  ok(r.status === 401, `Till 1 session ended by the Till 2 sign-in (${r.status})`);
  r = await R('GET', '/auth/me', { token: cashierT2, till: key2 });
  ok(r.status === 200, 'Till 2 session works');
  r = await R('GET', '/auth/me', { token: owner });
  ok(r.status === 200, 'owner may be signed in on several tills');

  // ---- per-till shifts ----
  r = await R('POST', '/cashier/till/open', { token: owner, body: { floatRs: 1000 } });
  ok(r.json?.ok && r.json.shift.till_id === 'till-1', `open Till 1 shift ${r.raw.slice(0, 160)}`);
  r = await R('POST', '/cashier/till/open', { token: cashierT2, till: key2, body: { floatRs: 500 } });
  ok(r.json?.ok && r.json.shift.till_id === t2.id, 'Till 2 shift opens while Till 1 is open');
  r = await R('POST', '/cashier/till/open', { token: cashierT2, till: key2, body: { floatRs: 500 } });
  ok(r.json?.ok === false && r.json.error === 'till_already_open', 'one open shift per till');
  r = await R('POST', '/cashier/till/moves', { token: cashierT2, till: key2, body: { kind: 'in', amountRs: 200, reason: 'change' } });
  ok(r.json?.ok, 'cash in on Till 2');
  r = await R('POST', '/sales', { token: cashierT2, till: key2, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.daal.id, qty: 2 }] } });
  ok(r.json?.sale?.shortId === 'T2-000003', 'sale on Till 2 in the shift');
  r = await R('POST', '/sales', { token: owner, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.soap.id, qty: 1 }] } });
  ok(r.json?.sale?.shortId === 'T1-000004', 'sale on Till 1 in the shift');
  r = await R('GET', '/cashier/till', { token: cashierT2, till: key2 });
  ok(r.json?.summary?.cash_sales_paisa === 50000 && r.json.summary.cash_in_paisa === 20000 && r.json.summary.expected_paisa === 120000,
    `Till 2 expected = 500 + 200 + 500 = Rs 1,200 ${JSON.stringify(r.json?.summary)}`);
  r = await R('GET', '/cashier/till', { token: owner });
  ok(r.json?.summary?.cash_sales_paisa === 12000 && r.json.summary.expected_paisa === 112000, `Till 1 expected = 1,000 + 120 ${JSON.stringify(r.json?.summary)}`);
  r = await R('GET', '/cashier/till?tillId=till-1', { token: cashierT2, till: key2 });
  ok(r.json?.ok === false && r.json.error === 'manager_only', 'cashier cannot look at another till');
  r = await R('POST', '/cashier/till/close', { token: cashierT2, till: key2, body: { tillId: 'till-1', countedRs: 1120 } });
  ok(r.json?.ok === false && r.json.error === 'manager_only', 'cashier cannot close another till');
  r = await R('POST', '/cashier/till/close', { token: manager2, till: key2, body: { tillId: 'till-1', countedRs: 1100 } });
  ok(r.json?.ok && r.json.report.shift.till_id === 'till-1' && r.json.report.shift.over_short_paisa === -2000, `manager closes Till 1 from Till 2 (short Rs 20) ${r.raw.slice(0, 200)}`);
  r = await R('GET', '/tills', { token: manager2, till: key2 });
  const lt = r.json?.tills ?? [];
  ok(r.json?.ok && lt.find((t) => t.id === 'till-1')?.shift === null && lt.find((t) => t.id === t2.id)?.shift && lt.find((t) => t.id === t2.id).online === true,
    'tills list: Till 1 closed, Till 2 open and online');
  ok(lt.find((t) => t.id === t2.id)?.today_sales === 3 && lt.find((t) => t.id === 'till-1')?.today_sales === 4, 'tills list: sales today per till');
  r = await R('GET', '/cashier/till/shifts', { token: cashierT2, till: key2 });
  ok(r.json?.shifts?.length === 1 && r.json.shifts[0].till_id === t2.id, 'cashier history shows this till only');
  r = await R('GET', '/cashier/till/shifts?tillId=all', { token: owner });
  ok(r.json?.shifts?.length === 2, 'owner history: all tills');

  // ---- refund needs a manager ----
  const sale = (await R('POST', '/sales', { token: cashierT2, till: key2, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.daal.id, qty: 2 }] } })).json.sale;
  const sd = (await R('GET', `/returns/bills/${sale.id}`, { token: cashierT2, till: key2 })).json;
  const lineId = (sd?.sale?.lines ?? sd?.lines ?? [])[0]?.id;
  ok(!!lineId, `bill line for the return ${JSON.stringify(sd).slice(0, 160)}`);
  const retBody = { saleId: sale.id, lines: [{ saleLineId: lineId, qty: 1 }] };
  r = await R('POST', '/returns', { token: cashierT2, till: key2, body: retBody });
  ok(r.status === 403 && r.json?.error === 'manager_approval_needed', `cashier refund needs a manager (${r.status} ${r.json?.error})`);
  r = await R('POST', '/auth/approve', { token: cashierT2, till: key2, body: { userId: cashierId, pin: '5678', action: 'refund' } });
  ok(r.json?.ok === false && r.json.error === 'not_a_manager', 'a cashier cannot approve');
  r = await R('POST', '/auth/approve', { token: cashierT2, till: key2, body: { userId: managerId, pin: '9999', action: 'refund' } });
  ok(r.json?.ok === false && r.json.error === 'invalid_credentials', 'wrong manager PIN');
  r = await R('POST', '/auth/approve', { token: cashierT2, till: key2, body: { userId: managerId, pin: '1357', action: 'refund' } });
  ok(r.json?.ok && r.json.approval && r.json.approver.role === 'manager', 'manager PIN → approval');
  const appr = r.json.approval;
  r = await R('POST', '/returns', { token: cashierT2, till: key2, body: { ...retBody, approval: appr } });
  ok(r.status === 201 && r.json?.ok, `refund with the manager's approval ${r.raw.slice(0, 160)}`);
  r = await R('POST', '/returns', { token: cashierT2, till: key2, body: { ...retBody, approval: appr } });
  ok(r.status === 403, 'approval works once');
  r = await R('POST', '/returns', { token: manager2, till: key2, body: retBody });
  ok(r.status === 201, 'manager refunds directly');
  let d = s.db();
  const rets = d.prepare(`SELECT till_id, approved_by, returned_by FROM sale_returns WHERE sale_id = ? ORDER BY created_at`).all(sale.id);
  d.close();
  ok(rets.length === 2 && rets.every((x) => x.till_id === t2.id && x.approved_by === managerId), `returns on Till 2, approved by the manager ${JSON.stringify(rets)}`);
  r = await R('GET', '/cashier/till', { token: cashierT2, till: key2 });
  ok(r.json?.summary?.refunds_cash_paisa === 50000, `Till 2 refunds Rs 500 ${JSON.stringify(r.json?.summary)}`);

  // ---- price override ----
  const ov = { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.atta.id, qty: 1, overridePricePaisa: 140000 }] };
  r = await R('POST', '/sales', { token: cashierT2, till: key2, body: ov });
  ok(r.status === 403 && r.json?.error === 'manager_approval_needed', 'cashier price override needs a manager');
  r = await R('POST', '/auth/approve', { token: cashierT2, till: key2, body: { userId: managerId, pin: '1357', action: 'price_override' } });
  r = await R('POST', '/sales', { token: cashierT2, till: key2, body: { ...ov, approval: r.json.approval } });
  ok(r.json?.ok && r.json.sale.totalPaisa === 140000 && r.json.sale.lines[0].unitPricePaisa === 140000, `override Rs 1,480 → Rs 1,400 ${r.raw.slice(0, 160)}`);
  const ovSale = r.json.sale;
  r = await R('POST', '/sales', { token: manager2, till: key2, body: ov });
  ok(r.json?.ok && r.json.sale.totalPaisa === 140000, 'manager overrides directly');
  d = s.db();
  const ol = d.prepare(`SELECT override_from_paisa, override_by FROM sale_lines WHERE sale_id = ?`).get(ovSale.id);
  const oa = d.prepare(`SELECT user_id FROM audit_log WHERE action = 'sale.price_override' AND subject_id = ?`).get(ovSale.id);
  d.close();
  ok(Number(ol?.override_from_paisa) === 148000 && ol.override_by === managerId && oa?.user_id === managerId, `override logged with the manager ${JSON.stringify(ol)}`);

  // ---- switch a till off / on ----
  r = await R('POST', `/tills/${t2.id}`, { token: owner, body: { active: false } });
  ok(r.json?.ok === false && r.json.error === 'till_shift_open', 'cannot switch off a till with an open shift');
  r = await R('POST', `/tills/${t2.id}`, { token: owner, body: { name: 'Counter Two' } });
  ok(r.json?.ok && r.json.till.name === 'Counter Two', 'rename till');

  // ---- parallel selling on two tills ----
  await s.sell(owner, { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.daal.id, qty: Number(s.stock(s.daal.id)) - 3, unit: 'piece' }] });
  ok(Number(s.stock(s.daal.id)) === 3, 'stock 3 before the rush');
  const rush = await Promise.all(Array.from({ length: 16 }, (_, i) => R('POST', '/sales', {
    token: i % 2 ? manager2 : owner, till: i % 2 ? key2 : undefined,
    body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.daal.id, qty: 1 }] },
  })));
  const won = rush.filter((x) => x.status === 201 && x.json?.ok);
  ok(won.length === 3 && rush.every((x) => x.status < 500), `two tills, 16 parallel sales on 3 in stock → 3 sold (${won.length})`);
  ok(Number(s.stock(s.daal.id)) === 0, 'stock 0');
  d = s.db();
  const seqs = d.prepare(`SELECT till_id, bill_no FROM sales WHERE bill_no IS NOT NULL ORDER BY till_id, bill_no`).all();
  const tl = d.prepare(`SELECT id, next_bill_no FROM tills`).all();
  d.close();
  let gapFree = true;
  for (const t of tl) {
    const nos = seqs.filter((x) => x.till_id === t.id).map((x) => Number(x.bill_no));
    if (nos.some((n, i) => n !== i + 1) || Number(t.next_bill_no) !== nos.length + 1) gapFree = false;
  }
  ok(gapFree, `bill numbers 1..n per till, no gaps or repeats ${JSON.stringify(tl)}`);

  // ---- server-only install ----
  r = await R('POST', '/cashier/till/close', { token: manager2, till: key2, body: { countedRs: 1000 } });
  ok(r.json?.ok, 'close Till 2 shift');
  r = await R('POST', '/tills/mode', { token: owner, body: { mode: 'server_only' } });
  ok(r.json?.ok && r.json.mode === 'server_only', 'switch to server-only main PC');
  r = await R('GET', '/tills/me');
  ok(r.json?.till === null && r.json.mode === 'server_only', 'main PC has no till now');
  r = await R('POST', '/sales', { token: owner, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.soap.id, qty: 1 }] } });
  ok(r.json?.ok === false && r.json.error === 'no_till', 'server-only main PC cannot sell');
  r = await R('GET', '/tills', { token: owner });
  ok(r.json?.used === 1 && r.json.tills.every((t) => t.id !== 'till-1'), `server-only PC does not count (${r.json?.used} used)`);
  r = await R('POST', '/tills', { token: owner, body: {} });
  ok(r.json?.ok && r.json.till.code === 3, 'room for a second sales till (T3)');
  r = await R('POST', '/tills/mode', { token: owner, body: { mode: 'main_till' } });
  ok(r.json?.ok === false && r.json.error === 'till_limit', 'back to main-PC till blocked at the limit');
  r = await R('POST', '/sales', { token: manager2, till: key2, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.soap.id, qty: 1 }] } });
  ok(r.json?.ok && /^T2-/.test(r.json.sale.shortId), 'Till 2 still sells');
  // JSON copy keeps the till and number
  r = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const bundle = r.json?.bundle ?? r.json;
  const exSales = bundle?.sales ?? bundle?.data?.sales ?? bundle?.tables?.sales ?? [];
  ok(exSales.length > 0 && exSales.some((x) => x.till_id === t2.id && Number(x.bill_no) >= 1), `JSON copy carries till and bill number (${exSales.length} sales)`);
} catch (e) {
  console.error('FAIL', e.stack || e.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
if (!process.exitCode) console.log(`${c.passed} checks passed`);
