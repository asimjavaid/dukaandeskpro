#!/usr/bin/env node
/**
 * Batch 1: loose/weighed quantities (kg, litre to 3 decimals), till shifts
 * (float, cash in/out, close, over/short, Z data, history), automatic backup
 * (folder, retention, status), cash refund cap, walk-in udhaar block, backup v6.
 * Run: node scripts/test-batch1.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('batch1', Number(process.env.API_PORT ?? 3885));
const R = api.request;

try {
  const s = await seed(api, { cashierRefunds: true });
  const { owner, cashier, soap, rashid, stock } = s;
  const sj = (await R('GET', '/suppliers', { token: owner })).json;
  const sup = (sj.items ?? sj.suppliers ?? sj)[0];

  // ---- (a) loose goods ----
  let r = await R('POST', '/catalog/products', { token: owner, body: { name: 'Chawal loose', priceRs: 320, unitLabel: 'kg', piecesPerCarton: 1, productType: 'normal' } }); // kg items default to Bulk (repack-only) since Oct 2026; 'normal' sells by weight
  ok(r.json?.ok, 'kg product');
  const rice = r.json.product;
  r = await R('POST', '/stock/receive', { token: owner, body: { productId: rice.id, qty: '25.5', unit: 'piece', amountRs: 7000, supplierId: sup.id } });
  ok(r.json?.ok && stock(rice.id) === 25.5, `receive 25.5 kg (${stock(rice.id)}) ${r.raw.slice(0,150)} ${JSON.stringify(rice).slice(0,200)}`);
  r = await R('POST', '/stock/receive', { token: owner, body: { productId: soap.id, qty: '1.5', unit: 'piece', amountRs: 100, supplierId: sup.id } });
  ok(!r.json?.ok, 'piece product refuses 1.5');
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', lines: [{ productId: rice.id, qty: 0.25 }, { productId: rice.id, qty: 0.5 }] } });
  ok(r.json?.ok, `sell 250 g + half kg ${r.raw.slice(0, 200)}`);
  const s1 = r.json.sale;
  ok(s1.totalPaisa === 24000, `total Rs 240 (${JSON.stringify(s1).slice(0,300)})`);
  ok(stock(rice.id) === 24.75, `stock 24.75 (${stock(rice.id)})`);
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', lines: [{ productId: rice.id, qty: 0.3125 }] } });
  ok(!r.json?.ok && r.json?.error === 'invalid_qty', '4 decimals refused');
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 1.5 }] } });
  ok(!r.json?.ok, 'piece sale refuses 1.5');
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', lines: [{ productId: rice.id, qty: 0.313 }] } });
  ok(r.json?.ok && r.json.sale.totalPaisa === Math.round(0.313 * 32000), 'Rs 100 worth → 0.313 kg, rounded paisa');
  ok(stock(rice.id) === 24.437, `stock 24.437 (${stock(rice.id)})`);
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', lines: [{ productId: rice.id, qty: 30 }] } });
  ok(r.json?.error === 'insufficient_stock', 'oversell refused');

  // returns fraction
  const sd = (await R('GET', `/sales/${s1.id}`, { token: owner })).json;
  const lines = sd.sale?.lines ?? sd.lines;
  r = await R('POST', '/returns', { token: cashier, body: { saleId: s1.id, lines: [{ saleLineId: lines[0].id, qty: 0.1 }] } });
  ok(r.json?.ok && r.json.return.total_paisa === 3200, `return 100 g (${r.raw.slice(0, 120)})`);
  ok(stock(rice.id) === 24.537, `restocked 24.537 (${stock(rice.id)})`);
  r = await R('POST', '/returns', { token: cashier, body: { saleId: s1.id, lines: [{ saleLineId: lines[0].id, qty: 0.2 }] } });
  ok(r.json?.error === 'qty_exceeds_sold', 'cannot return more than 0.15 left');

  // purchases fraction
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: rice.id, mode: 'loose', pieces: 10.25, unitCostRs: 280 }], paidRs: 0 } });
  ok(r.json?.ok && stock(rice.id) === 34.787, `purchase 10.25 kg (${stock(rice.id)}) ${r.raw.slice(0, 100)}`);
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: soap.id, mode: 'loose', pieces: 2.5, unitCostRs: 100 }], paidRs: 0 } });
  ok(!r.json?.ok, 'piece purchase refuses 2.5');

  // stock count fraction
  r = await R('POST', '/stock/counts/quick', { token: owner, body: { productId: rice.id, countedQty: '34.5', reasonCode: 'damaged' } });
  ok(r.json?.ok !== false && stock(rice.id) === 34.5, `quick count 34.5 (${stock(rice.id)}) ${r.raw.slice(0, 100)}`);

  // analytics stay whole paisa
  const an = (await R('GET', '/analytics/summary', { token: owner })).json;
  ok(JSON.stringify(an).match(/_paisa":-?\d+\.\d/) == null, 'analytics paisa are whole numbers');

  // ---- (d) fixes ----
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'udhaar', lines: [{ productId: soap.id, qty: 1 }] } });
  ok(r.json?.error === 'udhaar_needs_customer', 'walk-in udhaar blocked');
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'split', cashAmountPaisa: 6000, udhaarAmountPaisa: 6000, lines: [{ productId: soap.id, qty: 1 }] } });
  ok(r.json?.error === 'udhaar_needs_customer', 'walk-in split blocked');
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'split', partyId: rashid.id, cashAmountPaisa: 4000, udhaarAmountPaisa: 20000, lines: [{ productId: soap.id, qty: 2 }] } });
  ok(r.json?.ok, 'split with customer ok');
  const sp = r.json.sale;
  const spl = ((await R('GET', `/sales/${sp.id}`, { token: owner })).json.sale?.lines ?? []).concat([]);
  const spLine = spl[0] ?? (await R('GET', `/sales/${sp.id}`, { token: owner })).json.lines[0];
  r = await R('POST', '/returns', { token: cashier, body: { saleId: sp.id, lines: [{ saleLineId: spLine.id, qty: 2 }], refundCashPaisa: 24000, refundKhataPaisa: 0 } });
  ok(r.json?.error === 'refund_exceeds_cash', 'cash refund > cash paid refused');
  r = await R('POST', '/returns', { token: cashier, body: { saleId: sp.id, lines: [{ saleLineId: spLine.id, qty: 1 }], refundCashPaisa: 4000, refundKhataPaisa: 8000 } });
  ok(r.json?.ok, 'refund within cash ok');
  r = await R('POST', '/returns', { token: cashier, body: { saleId: sp.id, lines: [{ saleLineId: spLine.id, qty: 1 }], refundCashPaisa: 1000, refundKhataPaisa: 11000 } });
  ok(r.json?.error === 'refund_exceeds_cash', 'earlier cash refunds counted');

  // ---- (b) till ----
  r = await R('GET', '/cashier/till', { token: cashier });
  ok(r.json.shift === null, 'no open shift');
  r = await R('POST', '/cashier/till/moves', { token: cashier, body: { kind: 'in', amountRs: 100 } });
  ok(r.json?.error === 'till_not_open', 'move needs open till');
  r = await R('POST', '/cashier/till/open', { token: cashier, body: { floatRs: 2000 } });
  ok(r.json?.ok && r.json.shift.opening_float_paisa === 200000, 'open with float Rs 2,000');
  r = await R('POST', '/cashier/till/open', { token: owner, body: { floatRs: 0 } });
  ok(r.json?.error === 'till_already_open', 'one open shift');
  await s.sell(cashier, { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 2 }] }); // +240
  await s.sell(cashier, { paymentMethod: 'udhaar', partyId: rashid.id, lines: [{ productId: soap.id, qty: 1 }] }); // udhaar 120
  r = await R('POST', `/parties/${rashid.id}/collections`, { token: cashier, body: { amountPaisa: 5000 } });
  ok(r.json?.ok !== false, `collection Rs 50 ${r.raw.slice(0, 80)}`);
  r = await R('POST', '/expenses', { token: owner, body: { amountRs: 30, kind: 'bill', note: 'chai' } });
  ok(r.json?.ok !== false, `drawer expense Rs 30 ${r.raw.slice(0, 80)}`);
  r = await R('POST', '/cashier/till/moves', { token: cashier, body: { kind: 'in', amountRs: 500, reason: 'Change from bank' } });
  ok(r.json?.ok, 'cash in Rs 500');
  r = await R('POST', '/cashier/till/moves', { token: cashier, body: { kind: 'out', amountRs: 300, reason: 'Owner took' } });
  ok(r.json?.ok, 'cash out Rs 300');
  const outId = r.json.move.id;
  r = await R('POST', '/cashier/till/moves', { token: cashier, body: { kind: 'out', amountRs: 99999 } });
  ok(r.json?.error === 'cash_out_exceeds_till', 'cash out cannot exceed till');
  r = await R('GET', '/cashier/till', { token: cashier });
  const sm = r.json.summary;
  ok(sm.cash_sales_paisa === 24000 && sm.udhaar_given_paisa === 12000, `shift sales (${JSON.stringify(sm)})`);
  const exp = 200000 + 24000 + sm.udhaar_received_paisa - sm.expenses_paisa + 50000 - 30000;
  ok(sm.udhaar_received_paisa === 5000 && sm.expenses_paisa === 3000 && sm.expected_paisa === exp, `expected ${sm.expected_paisa} = ${exp}`);
  r = await R('POST', `/cashier/till/moves/${outId}/void`, { token: cashier });
  ok(r.json?.ok && (await R('GET', '/cashier/till', { token: cashier })).json.summary.cash_out_paisa === 0, 'undo cash out');
  const expected = (await R('GET', '/cashier/till', { token: cashier })).json.summary.expected_paisa;
  r = await R('POST', '/cashier/till/close', { token: cashier, body: { countedRs: (expected - 2000) / 100, note: 'short 20' } });
  ok(r.json?.ok && r.json.report.shift.over_short_paisa === -2000 && r.json.report.shift.counted_paisa === expected - 2000, 'close: short Rs 20');
  const shiftId = r.json.report.shift.id;
  await s.sell(cashier, { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 1 }] });
  r = await R('GET', `/cashier/till/shifts/${shiftId}`, { token: owner });
  ok(r.json.summary.cash_sales_paisa === 24000, 'closed Z report frozen');
  r = await R('GET', '/cashier/till/shifts', { token: owner });
  ok(r.json.total === 1 && r.json.shifts[0].id === shiftId, 'history');
  r = await R('GET', '/cashier/till', { token: owner });
  ok(r.json.shift === null && r.json.last_counted_paisa === expected - 2000, 'last counted suggests next float');

  // ---- (c) auto backup ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-auto-'));
  r = await R('POST', '/backup/auto', { token: cashier, body: { enabled: true, folder: dir } });
  ok(r.status === 403, 'cashier cannot configure auto backup');
  r = await R('POST', '/backup/auto', { token: owner, body: { enabled: true, folder: 'relative/path' } });
  ok(r.json?.error === 'folder_not_absolute', 'folder must be absolute');
  r = await R('POST', '/backup/auto', { token: owner, body: { enabled: true, folder: dir, keepCount: 2 } });
  ok(r.json?.ok && r.json.status.enabled && r.json.status.keep_count === 2, 'configure');
  for (let i = 0; i < 3; i++) {
    r = await R('POST', '/backup/auto/run', { token: owner });
    ok(r.json?.ok, `run ${i}`);
    await new Promise((res) => setTimeout(res, 1100));
  }
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('dukaandesk-auto-'));
  ok(files.length <= 2, `retention keeps 2 (${files.length})`);
  const newest = path.join(dir, files.sort().pop());
  let bundle;
  if (process.env.DD_DB === 'pg' || process.env.DATABASE_URL) {
    // Lite: automatic copies are full pg_dump files (.ddpro); restore is covered by test-reset-data.
    ok(newest.endsWith('.ddpro') && fs.readFileSync(newest).subarray(0, 5).toString('latin1') === 'PGDMP', 'auto copy is a full .ddpro database copy');
    const ex = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
    bundle = JSON.parse(ex.raw);
    ok(bundle.till_shifts.length === 1 && bundle.till_moves.length === 1 && !ex.raw.includes('pin_hash'), 'JSON copy (Save a copy) has till data, no PIN hashes');
  } else {
    bundle = JSON.parse(fs.readFileSync(newest, 'utf8'));
    ok(bundle.header.schema_version >= 7 && bundle.till_shifts.length === 1 && bundle.till_moves.length === 1, 'auto copy has till data');
    ok(!JSON.stringify(bundle).includes('pin_hash'), 'no PIN hashes in copy');
  }
  r = await R('GET', '/backup/auto', { token: owner });
  ok(r.json.last_at && r.json.last_file && r.json.files.length <= 2 && !r.json.last_error, 'status');

  // ---- backup v6 restore + older ----
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle } });
  ok(r.json?.ok, `restore v6 ${r.raw.slice(0, 100)}`);
  ok((await R('GET', '/cashier/till/shifts', { token: owner })).json.total === 1, 'till history restored');
  ok(stock(rice.id) === 34.5, `fraction stock restored (${stock(rice.id)})`);
  const v5 = JSON.parse(JSON.stringify(bundle));
  v5.header.schema_version = 5;
  delete v5.till_shifts;
  delete v5.till_moves;
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: v5 } });
  ok(r.json?.ok && (await R('GET', '/cashier/till/shifts', { token: owner })).json.total === 0, 'v5 restore clears till');
  r = await R('POST', '/backup/auto', { token: owner, body: { enabled: false } });
  ok(r.json?.ok && !r.json.status.enabled, 'disable');

  console.log(`\nBATCH 1 OK (${c.passed} checks)`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
