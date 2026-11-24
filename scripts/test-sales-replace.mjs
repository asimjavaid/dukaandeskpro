#!/usr/bin/env node
/** Slice 4 — Edit a bill: POST /sales/:id/replace. Run: node scripts/test-sales-replace.mjs */
import { startApi, seed, makeChecks, Database } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('sales-replace', Number(process.env.API_PORT ?? 3874));
const { request } = api;
try {
  const s = await seed(api);
  const { owner, cashier, atta, daal, soap, rashid, sell, stock, balance } = s;
  const insights = async () => (await request('GET', '/analytics/insights', { token: owner })).json;
  const detail = async (id) => (await request('GET', `/sales/${id}`, { token: owner })).json.sale;

  // Original: Rashid split, daal 2 (250) + soap 1 (120) = 620; cash 200 + khata 420
  const old = await sell(owner, { paymentMethod: 'split', partyId: rashid.id, cashAmountPaisa: 20000, udhaarAmountPaisa: 42000, lines: [{ productId: daal.id, qty: 2 }, { productId: soap.id, qty: 1 }] });
  ok((await balance(rashid.id)) === 42000, 'khata before');
  // Price of daal changes after the sale; edit must keep 250.
  const pu = await request('PATCH', `/catalog/products/${daal.id}`, { token: owner, body: { priceRs: 300 } });
  ok(pu.status < 300, `price change ${pu.status} ${pu.raw.slice(0, 120)}`);

  const body = {
    paymentMethod: 'split', partyId: rashid.id, cashAmountPaisa: 20000, udhaarAmountPaisa: 0,
    lines: [{ productId: daal.id, qty: 3 }, { productId: atta.id, qty: 1 }],
  };
  // ── Gating ──
  let r = await request('POST', `/sales/${old.id}/replace`, { token: cashier, body });
  ok(r.status === 403, 'cashier 403');
  r = await request('POST', `/sales/${old.id}/replace`, { token: owner, body: { ...body, lines: [] } });
  ok(r.status === 400 && r.json.error === 'empty_cart', `empty refused ${r.status} ${r.raw}`);
  ok((await detail(old.id)).status === 'active', 'refused edit leaves bill active');
  ok((await balance(rashid.id)) === 42000, 'refused edit leaves khata');
  r = await request('POST', `/sales/${old.id}/replace`, { token: owner, body: { ...body, lines: [{ productId: soap.id, qty: 101 }] } });
  ok(r.status === 409 && r.json.error === 'insufficient_stock', 'over stock refused');
  // Stock check counts the old bill's qty: soap on hand 99 + 1 old = 100 is fine.
  const soapOnHand = stock(soap.id);
  ok(soapOnHand === 99, 'soap 99');

  // ── Edit: daal 3 @ 250 (kept) + atta 1 @ 1480 = 2230; cash 200 (already paid) + 2030 khata ──
  const daal0 = stock(daal.id);
  const atta0 = stock(atta.id);
  r = await request('POST', `/sales/${old.shortId}/replace`, {
    token: owner,
    body: { paymentMethod: 'split', partyId: rashid.id, cashAmountPaisa: 20000, udhaarAmountPaisa: 203000, lines: [{ productId: daal.id, qty: 3, expectedUnitPricePaisa: 25000 }, { productId: atta.id, qty: 1 }] },
  });
  ok(r.status === 201 && r.json.ok, `replace ${r.status} ${r.raw}`);
  const nw = r.json.sale;
  ok(r.json.replaces.short_id === old.shortId, 'response replaces');
  ok(nw.totalPaisa === 223000 && nw.lines.find((l) => l.productId === daal.id).unitPricePaisa === 25000, 'old price kept, new item today price');
  ok(nw.shortId !== old.shortId, 'new bill no');
  ok(stock(daal.id) === daal0 + 2 - 3 && stock(atta.id) === atta0 - 1 && stock(soap.id) === soapOnHand + 1, 'stock moved by difference');
  ok((await balance(rashid.id)) === 203000, `khata = new khata only ${await balance(rashid.id)}`);
  const od = await detail(old.id);
  ok(od.status === 'replaced' && od.replaced_by.id === nw.id && od.void_reason === 'Edited', 'old replaced');
  const nd = await detail(nw.id);
  ok(nd.status === 'active' && nd.replaces.short_id === old.shortId, 'new links back');
  const till = (await insights()).cash_till;
  ok(till.cash_sales_paisa === 20000 && till.udhaar_received_paisa === 0, 'till counts new cash only');
  r = await request('POST', `/sales/${old.id}/replace`, { token: owner, body });
  ok(r.status === 409, 'old cannot be edited again');
  const db = new Database(api.dbPath, { readonly: true });
  ok(db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='sale.replace'`).get().n === 1, 'audit');
  db.close();

  // ── Walk-in cash edit: fewer items, change back ──
  const w = await sell(owner, { paymentMethod: 'cash', tenderedPaisa: 50000, lines: [{ productId: soap.id, qty: 3 }] });
  r = await request('POST', `/sales/${w.id}/replace`, { token: owner, body: { paymentMethod: 'cash', tenderedPaisa: 36000, lines: [{ productId: soap.id, qty: 1 }] } });
  ok(r.status === 201 && r.json.sale.totalPaisa === 12000 && r.json.sale.changePaisa === 24000, 'walk-in edit change');
  const list = (await request('GET', '/sales', { token: owner })).json;
  ok(list.items.filter((i) => i.status === 'replaced').length === 2 && list.sale_count === 2, 'list counts only new bills');

  // Old day refused
  const o2 = await sell(owner, { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 1 }] });
  const rw = new Database(api.dbPath);
  rw.prepare(`UPDATE sales SET recorded_at = ? WHERE id = ?`).run(new Date(Date.now() - 86400000 * 2).toISOString(), o2.id);
  rw.close();
  r = await request('POST', `/sales/${o2.id}/replace`, { token: owner, body: { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 1 }] } });
  ok(r.status === 409 && r.json.error === 'sale_not_today', 'old bill refused');

  // Backup keeps links
  const exp = await request('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const res = await request('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: exp.json } });
  ok(res.status < 300, 'restore');
  ok((await detail(old.id)).replaced_by.id === nw.id && (await detail(nw.id)).replaces.id === old.id, 'links survive restore');

  console.log(`\nPASS ${c.passed} checks`);
} catch (err) {
  console.error('\nFAIL after', c.passed, 'checks:', err.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
