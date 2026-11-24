#!/usr/bin/env node
/**
 * Staff profiles, roles (Owner / Cashier / Data entry / Helper), salary khata,
 * monthly run with advance auto-deduction, expenses + drawer, backup v5 + older restore.
 * Run: node scripts/test-staff-salary.mjs
 */
import { startApi, seed, makeChecks, karachiYmd } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('staff-salary', Number(process.env.API_PORT ?? 3881));
const R = api.request;
const today = karachiYmd(new Date());
const period = today.slice(0, 7);
const st = (r, s) => r.status === s;

try {
  const s = await seed(api);
  const { owner, cashier, atta } = s;

  // ---- Profiles ----
  let r = await R('POST', '/owner/staff', { token: owner, body: { name: 'Sana DEO', role: 'data_entry', position: 'Stock clerk', phone: '0301-5550000', address: 'Gulberg', monthlySalaryRs: 30000, pin: '4321' } });
  ok(r.json?.ok && r.json.pin_once === '4321' && r.json.staff.role === 'data_entry', 'add data entry with PIN');
  const deo = r.json.staff;
  ok(deo.monthly_salary_paisa === 3000000 && deo.position === 'Stock clerk' && deo.has_login, 'profile fields');
  r = await R('POST', '/owner/staff', { token: owner, body: { name: 'Ahmed Helper', role: 'helper', monthlySalaryRs: 20000 } });
  ok(r.json?.ok && r.json.pin_once === null && !r.json.staff.has_login, 'helper without login');
  const helper = r.json.staff;
  r = await R('POST', '/owner/staff', { token: owner, body: { name: 'X', role: 'cashier' } });
  ok(st(r, 400), 'cashier needs PIN');
  r = await R('POST', '/owner/staff', { token: owner, body: { name: 'X', role: 'owner', pin: '1111' } });
  ok(st(r, 400), 'cannot add owner');
  const users = (await R('GET', '/auth/users')).json.users;
  ok(users.some((u) => u.id === deo.id) && !users.some((u) => u.id === helper.id), 'login list: DEO yes, helper no');
  ok(!JSON.stringify((await R('GET', '/owner/staff', { token: owner })).json).includes('pin_hash'), 'no pin data in list');

  // ---- Data entry permissions ----
  r = await R('POST', '/auth/login', { body: { userId: deo.id, pin: '4321' } });
  ok(r.json?.ok && r.json.session.role === 'data_entry', 'DEO logs in');
  const dt = r.json.sessionToken;
  const deny = [
    ['POST', '/sales', { paymentMethod: 'cash', lines: [{ productId: atta.id, qty: 1 }] }],
    ['GET', '/sales/today'], ['GET', '/cashier/today'], ['GET', '/returns'], ['POST', '/returns', {}],
    ['GET', '/analytics'], ['GET', '/expenses'], ['GET', '/backup'], ['GET', '/owner/staff'],
    ['GET', '/tax/queue'], ['PATCH', '/settings/store', {}], ['POST', `/suppliers/x/payments`, { amountRs: 1 }],
    ['POST', `/parties/${s.rashid.id}/collections`, { amountRs: 10 }],
  ];
  for (const [m, p, b] of deny) {
    const x = await R(m, p, { token: dt, body: b });
    ok(x.status === 403, `DEO ${m} ${p} → 403 (got ${x.status})`);
  }
  r = await R('GET', '/catalog/products?pageSize=50', { token: dt });
  ok(r.json.items.length >= 3 && r.json.items.every((p) => !('last_unit_cost_paisa' in p) && p.price_paisa > 0), 'DEO catalog: prices, no cost');
  r = await R('POST', '/catalog/products', { token: dt, body: { name: 'Tapal 95g', priceRs: 210, unit: 'piece', piecesPerCarton: 1 } });
  ok(r.json?.ok && !JSON.stringify(r.json).match(/cost/i), 'DEO adds product, no cost in reply');
  const tapal = r.json.product;
  r = await R('PATCH', `/catalog/products/${tapal.id}`, { token: dt, body: { priceRs: 220 } });
  ok(r.json?.ok, 'DEO edits price');
  r = await R('GET', '/suppliers', { token: dt });
  ok(r.json.items.length >= 1 && !JSON.stringify(r.json).match(/paisa/), 'DEO suppliers: no money');
  const supId = r.json.items.find((x) => x.name === 'Test Supplier').id;
  r = await R('POST', '/suppliers', { token: dt, body: { name: 'DEO Supplier', phone: '0300' } });
  ok(r.json?.ok, 'DEO adds supplier');
  r = await R('POST', '/purchases', { token: dt, body: { supplierId: supId, lines: [{ productId: tapal.id, mode: 'loose', pieces: 12, unitCostRs: 180 }], paidRs: 500 } });
  ok(r.json?.ok && !JSON.stringify(r.json).match(/_paisa|cost/i), `DEO records purchase, reply has no money (${r.raw.slice(0, 80)})`);
  const invId = r.json.invoice?.id ?? r.json.purchase?.id;
  r = await R('GET', '/purchases', { token: owner });
  const inv = r.json.items.find((x) => x.id === invId) ?? r.json.items[0];
  ok(inv.total_paisa === 216000 && inv.paid_paisa === 0 && inv.due_paisa === 216000, 'owner sees cost; DEO paid forced to 0');
  r = await R('GET', '/purchases', { token: dt });
  ok(r.json.items.length >= 1 && !JSON.stringify(r.json).match(/_paisa/), 'DEO purchase list: no money');
  r = await R('GET', `/purchases/${inv.id}`, { token: dt });
  ok(r.json?.ok !== false && !JSON.stringify(r.json).match(/_paisa|cost/i), 'DEO purchase detail: no money');
  r = await R('GET', '/stock/counts/draft', { token: dt });
  ok(st(r, 403), 'DEO stock count refused (SC7: Owner-only)');
  r = await R('POST', '/stock/counts/quick', { token: dt, body: { productId: tapal.id, countedQty: 10, reasonCode: 'damaged' } });
  ok(st(r, 403), 'DEO quick count refused (SC7: Owner-only)');
  r = await R('GET', '/sales', { token: dt });
  ok(st(r, 200), 'DEO views sales list');
  r = await R('POST', '/parties', { token: dt, body: { name: 'New Cust' } });
  ok(r.json?.ok, 'DEO adds customer');

  // Cashier unchanged
  r = await R('POST', '/catalog/products', { token: cashier, body: { name: 'N', priceRs: 1, unit: 'piece' } });
  ok(st(r, 403), 'cashier catalog write 403');
  r = await R('GET', '/purchases', { token: cashier });
  ok(st(r, 403), 'cashier purchases 403');
  ok(st(await R('GET', '/cashier/today', { token: cashier }), 200), 'cashier today 200');

  // ---- Edit / PIN / role change / left ----
  r = await R('PATCH', `/owner/staff/${helper.id}`, { token: owner, body: { role: 'cashier' } });
  ok(st(r, 400), 'helper → cashier needs PIN');
  r = await R('PATCH', `/owner/staff/${helper.id}`, { token: owner, body: { role: 'cashier', pin: '9999', phone: '0333' } });
  ok(r.json?.ok && r.json.staff.has_login && r.json.pin_once === '9999', 'helper → cashier with PIN');
  ok((await R('POST', '/auth/login', { body: { userId: helper.id, pin: '9999' } })).json.ok, 'new cashier logs in');
  r = await R('PATCH', `/owner/staff/${helper.id}`, { token: owner, body: { role: 'helper' } });
  ok(r.json?.ok && !r.json.staff.has_login, 'back to helper');
  ok(!(await R('POST', '/auth/login', { body: { userId: helper.id, pin: '9999' } })).json.ok, 'helper cannot log in');
  r = await R('POST', `/owner/staff/${deo.id}/pin`, { token: owner, body: { pin: '8765' } });
  ok(r.json?.pin_once === '8765', 'PIN reset');
  ok((await R('POST', '/auth/login', { body: { userId: deo.id, pin: '8765' } })).json.ok, 'login with new PIN');
  ok(!(await R('POST', '/auth/login', { body: { userId: deo.id, pin: '4321' } })).json.ok, 'old PIN fails');
  const ownerRow = (await R('GET', '/owner/staff', { token: owner })).json.users.find((u) => u.role === 'owner');
  ok(st(await R('PATCH', `/owner/staff/${ownerRow.id}`, { token: owner, body: { role: 'cashier' } }), 403), 'owner role locked');
  ok(st(await R('POST', `/owner/staff/${ownerRow.id}/pin`, { token: owner, body: { pin: '1111' } }), 403), 'owner PIN via settings only');

  // ---- Salary ----
  const drawer = async () => (await R('GET', '/analytics/insights', { token: owner })).json.cash_till;
  const d0 = await drawer();
  r = await R('POST', `/owner/staff/${helper.id}/entries`, { token: owner, body: { kind: 'advance', amountRs: 5000, note: 'Eid' } });
  ok(r.json?.ok && r.json.staff.advance_paisa === 500000, 'advance recorded');
  r = await R('POST', `/owner/staff/${deo.id}/entries`, { token: owner, body: { kind: 'payment', amountRs: 100 } });
  ok(st(r, 400), 'payment above salary balance refused');
  let pv = (await R('GET', `/owner/staff/salary-run?period=${period}`, { token: owner })).json;
  const ph = pv.rows.find((x) => x.staff_id === helper.id);
  ok(ph.salary_paisa === 2000000 && ph.deduction_paisa === 500000 && ph.payable_paisa === 1500000, 'preview: advance auto-deducted');
  r = await R('POST', '/owner/staff/salary-run', { token: owner, body: { period } });
  ok(r.json?.ok && r.json.added === 2 && r.json.deducted_paisa === 500000, 'run adds 2 salaries');
  r = await R('POST', '/owner/staff/salary-run', { token: owner, body: { period } });
  ok(r.json?.added === 0, 'run is once per month');
  let h = (await R('GET', `/owner/staff/${helper.id}`, { token: owner })).json;
  ok(h.staff.salary_balance_paisa === 1500000 && h.staff.advance_paisa === 0, 'helper owed 15,000, advance cleared');
  r = await R('POST', `/owner/staff/${helper.id}/entries`, { token: owner, body: { kind: 'payment', amountRs: 10000 } });
  ok(r.json?.ok, 'pay 10,000 from drawer');
  r = await R('POST', `/owner/staff/${deo.id}/entries`, { token: owner, body: { kind: 'payment', amountRs: 30000, fromDrawer: false } });
  ok(r.json?.ok && r.json.staff.salary_balance_paisa === 0, 'pay DEO outside drawer');
  r = await R('POST', `/owner/staff/${deo.id}/entries`, { token: owner, body: { kind: 'bonus', amountRs: 2000 } });
  ok(r.json?.ok && r.json.staff.salary_balance_paisa === 200000, 'bonus adds to balance');
  const d1 = await drawer();
  ok(d0.expenses_paisa + 1500000 === d1.expenses_paisa, `drawer counts advance + drawer payment only (${d1.expenses_paisa - d0.expenses_paisa})`);
  const ex = (await R('GET', '/expenses?period=day', { token: owner })).json;
  const sal = ex.items.filter((e) => e.staff_id);
  ok(sal.length === 3 && sal.every((e) => e.kind === 'salary' && e.staff_name), 'three salary expenses with names');
  ok(ex.period_total_paisa >= 4500000, 'profit side counts all salary paid');
  const pc = (await R('GET', '/analytics/profit-compare', { token: owner })).json;
  ok(pc.this_week.expenses_paisa >= 4500000, 'profit includes outside-drawer salary');
  ok(st(await R('DELETE', `/expenses/${sal[0].id}`, { token: owner }), 400) || (await R('DELETE', `/expenses/${sal[0].id}`, { token: owner })).json?.ok === false, 'salary expense not deletable in Expenses');

  // Void same day
  h = (await R('GET', `/owner/staff/${helper.id}`, { token: owner })).json;
  const pay = h.ledger.find((e) => e.kind === 'payment');
  ok(pay.can_void && pay.from_drawer === 1, 'payment voidable today');
  r = await R('POST', `/owner/staff/${helper.id}/entries/${pay.id}/void`, { token: owner });
  ok(r.json?.ok && r.json.staff.salary_balance_paisa === 1500000, 'void payment restores balance');
  ok((await drawer()).expenses_paisa === d1.expenses_paisa - 1000000, 'void removes the expense');
  const due = h.ledger.find((e) => e.kind === 'salary_due');
  r = await R('POST', `/owner/staff/${helper.id}/entries/${due.id}/void`, { token: owner });
  ok(r.json?.ok && r.json.staff.advance_paisa === 500000 && r.json.staff.salary_balance_paisa === 0, 'void salary run brings advance back');
  ok((await R('POST', '/owner/staff/salary-run', { token: owner, body: { period } })).json.added === 1, 're-run after void');
  const ded = (await R('GET', `/owner/staff/${helper.id}`, { token: owner })).json.ledger.find((e) => e.kind === 'deduction' && !e.voided_at);
  ok(st(await R('POST', `/owner/staff/${helper.id}/entries/${ded.id}/void`, { token: owner }), 400), 'deduction cannot be voided alone');

  // Left: no run, no login
  r = await R('POST', `/owner/staff/${deo.id}/deactivate`, { token: owner });
  ok(r.json?.user?.disabled_at, 'DEO left');
  ok(!(await R('POST', '/auth/login', { body: { userId: deo.id, pin: '8765' } })).json.ok, 'left staff cannot log in');
  pv = (await R('GET', `/owner/staff/salary-run?period=2099-01`, { token: owner })).json;
  ok(!pv.rows.some((x) => x.staff_id === deo.id), 'left staff out of runs');
  r = await R('POST', `/owner/staff/${deo.id}/activate`, { token: owner });
  ok(!r.json.user.disabled_at && (await R('POST', '/auth/login', { body: { userId: deo.id, pin: '8765' } })).json.ok, 'rejoin restores login');

  // ---- Backup v5 + restore ----
  const exp = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const bundle = exp.json;
  ok(bundle.header.schema_version >= 8 && bundle.staff.length === 4 && bundle.staff_ledger.length >= 6, 'copy v5 carries staff + khata');
  ok(!JSON.stringify(bundle.staff).includes('pin'), 'copy has no PIN data');
  const before = (await R('GET', `/owner/staff/${helper.id}`, { token: owner })).json;
  await R('PATCH', `/owner/staff/${helper.id}`, { token: owner, body: { phone: 'changed', monthlySalaryRs: 1 } });
  await R('POST', `/owner/staff/${helper.id}/entries`, { token: owner, body: { kind: 'advance', amountRs: 999 } });
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle } });
  ok(r.json?.ok, `restore v5 ${r.raw.slice(0, 120)}`);
  const after = (await R('GET', `/owner/staff/${helper.id}`, { token: owner })).json;
  ok(after.staff.phone === before.staff.phone && after.staff.monthly_salary_paisa === 2000000, 'profile restored');
  ok(after.ledger.length === before.ledger.length && after.staff.advance_paisa === before.staff.advance_paisa, 'khata restored');
  ok((await R('POST', '/auth/login', { body: { userId: deo.id, pin: '8765' } })).json.ok, 'logins unchanged by restore');
  const old = JSON.parse(JSON.stringify(bundle));
  old.header.schema_version = 4;
  delete old.staff;
  delete old.staff_ledger;
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: old } });
  ok(r.json?.ok, 'older v4 copy restores');
  const v4 = (await R('GET', '/owner/staff', { token: owner })).json.users;
  ok(v4.length === 4 && v4.every((u) => u.salary_balance_paisa === 0 && u.advance_paisa === 0), 'v4: profiles kept, khata cleared');

  console.log(`\nSTAFF+SALARY OK (${c.passed} checks)`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
