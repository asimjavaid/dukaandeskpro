#!/usr/bin/env node
/**
 * Opening stock: owner only; draft saved and resumed after a restart; Excel template round trip
 * (matched / unmatched / errors preview, apply); loose kg + carton entry stored in base units;
 * post sets qty (replace) or adds (items that already sold/bought) and cost; no supplier / purchase /
 * expense rows; sale afterwards uses the opening cost; undo rules; export; backup v16; reset clears it.
 *   SKIP_BUILD=1 node scripts/test-opening-stock.mjs
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { startApi, startApiOn, seed, makeChecks, Database, root } from './lib/sales-harness.mjs';

const require = createRequire(import.meta.url);
const { readXlsx, writeXlsx } = require(path.join(root, 'apps/api/dist/common/xlsx.js'));
const c = makeChecks();
const { ok } = c;
const j = (r) => (r.raw ?? '').slice(0, 400);
const PORT = Number(process.env.API_PORT ?? 3981);
const SECRET = 'opening-secret';

let api = await startApi('opening', PORT);
await api.stop();
const dbPath = api.dbPath;
await new Promise((r) => setTimeout(r, 400));
api = await startApiOn(dbPath, PORT + 1, { SESSION_SECRET: SECRET });
let R = api.request;
const q = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); const v = d.prepare(sql).get(...a); d.close(); return v; };
const n = (t) => q(`SELECT COUNT(*) c FROM ${t}`).c;
try {
  const s = await seed(api);
  const { owner, cashier, atta, soap, daal } = s;
  const mk = async (name, priceRs, unitLabel = 'piece', extra = {}) => {
    const r = await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel, ...extra } });
    if (!r.json?.ok) throw new Error(`mk ${r.raw}`);
    return r.json.product;
  };
  const sugar = await mk('Sugar Loose', 160, 'kg', { productType: 'bulk', buyMeasure: 'kg' });
  const lays = await mk('Lays Classic 30 g', 50, 'packet', { buyMeasure: 'carton', extraBarcodes: ['8964002346875'] });
  let r = await R('POST', '/packs', { token: owner, body: { productId: lays.id, name: 'Carton', units: 24 } });
  ok(r.json?.ok !== false, `carton pack ${j(r)}`);
  const mashBulk = await mk('Daal Mash Washed', 520, 'kg', { productType: 'bulk', buyMeasure: 'kg' });
  const mash = await mk('Daal Mash 500 g', 280, 'packet', { productType: 'packed', bulkId: mashBulk.id, packKg: 0.5 });
  const tea = await mk('Tapal Danedar 95 g', 290, 'packet');

  // 1. owner only
  ok((await R('GET', '/opening-stock')).status === 401, 'no session 401');
  ok((await R('GET', '/opening-stock', { token: cashier })).status === 403, 'cashier 403');
  ok((await R('PUT', `/opening-stock/draft/${sugar.id}`, { token: cashier, body: { qty: 1 } })).status === 403, 'cashier cannot save 403');
  ok((await R('POST', '/opening-stock/post', { token: cashier, body: { confirm: true } })).status === 403, 'cashier cannot post 403');

  // 2. list: units, packs, packed-from, activity
  r = await R('GET', '/opening-stock', { token: owner });
  ok(r.json?.ok && r.json.items.length >= 7, `list ${j(r)}`);
  const row = (id) => r.json.items.find((x) => x.id === id);
  ok(row(sugar.id).fraction === true && row(sugar.id).pack === null, 'loose sugar: kg, no carton');
  ok(row(lays.id).pack?.name === 'Carton' && row(lays.id).pack.units === 24 && row(lays.id).extra_barcodes.includes('8964002346875'), `lays carton x24 ${JSON.stringify(row(lays.id))}`);
  ok(row(mash.id).packed_from === 'Daal Mash Washed', 'packed from shown');
  ok(row(atta.id).has_activity === true && row(sugar.id).has_activity === false, 'activity flags');
  ok(row(atta.id).last_cost_paisa === 130000, 'atta last cost known');

  // 3. draft: save as you type, base units, validation
  const put = (id, body) => R('PUT', `/opening-stock/draft/${id}`, { token: owner, body });
  r = await put(sugar.id, { qty: '12.5', costRs: '140' });
  ok(r.json?.ok && r.json.draft.qty === 12.5 && r.json.draft.cost_paisa === 14000, `sugar 12.5 kg @140 ${j(r)}`);
  r = await put(lays.id, { mode: 'pack', packs: 3, packUnits: 24, costRs: 45 });
  ok(r.json?.ok && r.json.draft.qty === 72 && r.json.draft.packs === 3 && r.json.draft.pack_name === 'Carton', `lays 3 cartons = 72 packets ${j(r)}`);
  r = await put(mash.id, { qty: 10, costRs: '262.5' });
  ok(r.json?.ok && r.json.draft.qty === 10 && r.json.draft.cost_paisa === 26250, `packed entered in packets ${j(r)}`);
  r = await put(atta.id, { qty: 5 });
  ok(r.json?.ok && r.json.draft.cost_paisa === 130000, 'cost defaults to last cost');
  r = await put(atta.id, { qty: 5, costRs: 1200 });
  ok(r.json?.draft?.cost_paisa === 120000, 'cost changed');
  ok((await put(sugar.id, { qty: '1.2345' })).status === 400, 'kg max 3 decimals');
  ok((await put(lays.id, { qty: '2.5' })).status === 400, 'packets whole numbers');
  ok((await put(lays.id, { mode: 'pack', packs: 2 , packUnits: 0 })).status === 400, 'pcs per carton > 0');
  ok((await put(tea.id, { qty: 3, costRs: 'abc' })).status === 400, 'bad cost');
  ok((await put('nope', { qty: 1 })).status === 404, 'unknown product 404');
  r = await put(tea.id, { qty: 4, costRs: 250 });
  r = await put(tea.id, { qty: '', costRs: '' });
  ok(r.json?.ok && r.json.draft === null, 'blank qty + cost clears the row');
  ok(r.json.totals.entered === 4 && r.json.totals.qty_kg === 12.5 && r.json.totals.qty_pieces === 87, `totals ${JSON.stringify(r.json.totals)}`);
  const expectValue = 12.5 * 14000 + 72 * 4500 + 10 * 26250 + 5 * 120000;
  ok(r.json.totals.value_paisa === expectValue, `value ${r.json.totals.value_paisa} = ${expectValue}`);

  // 4. resume after closing the app (API restart)
  await api.stop();
  api = await startApiOn(dbPath, PORT + 2, { SESSION_SECRET: SECRET });
  R = api.request;
  r = await R('GET', '/opening-stock', { token: owner });
  ok(r.json?.items.find((x) => x.id === lays.id)?.draft?.packs === 3 && r.json.totals.entered === 4, 'draft survives restart');

  // 5. Excel template round trip
  r = await R('GET', '/opening-stock/template.xlsx', { token: owner });
  ok(r.status === 200 && /spreadsheetml/.test(r.headers['content-type']) && /opening-stock-.*\.xlsx/.test(r.headers['content-disposition']), 'template download');
  const rows = readXlsx(r.buf);
  const H = rows[0];
  ok(H.join('|') === 'Product|Barcode|Unit|Qty|Cartons|Pcs per carton|Cost per unit (Rs)|Sell price (Rs)', `headers ${H}`);
  const at = (name) => rows.find((x) => x[0] === name);
  ok(at('Lays Classic 30 g')[4] === '3' && at('Lays Classic 30 g')[5] === '24' && at('Lays Classic 30 g')[6] === '45', `lays row ${at('Lays Classic 30 g')}`);
  ok(at('Sugar Loose')[3] === '12.5' && at('Sugar Loose')[6] === '140', 'sugar row has draft');
  ok(at('Lux Soap')[3] === '' && at('Lux Soap')[6] === '100', 'soap row: blank qty, last cost');
  ok(rows.length === r3c(), 'one row per active product');
  function r3c() { return q(`SELECT COUNT(*) c FROM products WHERE active = 1`).c + 1; }
  // edit like a shopkeeper would
  at('Lux Soap')[3] = '7';
  at('Lux Soap')[6] = '95';
  at('Sugar Loose')[1] = ''; // name match only
  at('Sugar Loose')[3] = '15';
  at('Daal Masoor')[3] = 'x';
  at('Tapal Danedar 95 g')[3] = '6';
  at('Tapal Danedar 95 g')[4] = '1'; // both qty and cartons
  const laysRow = [...at('Lays Classic 30 g')];
  laysRow[0] = 'Lays (old name)';
  laysRow[1] = '8964002346875'; // extra barcode finds it -> duplicate of the Lays row
  const edited = [...rows, ['Unknown Biscuit', '1234567', 'piece', '5', '', '', '20'], laysRow, ['Daal Mash 500 g'.toUpperCase(), '', '', '12', '', '', '']];
  edited.splice(edited.indexOf(at('Daal Mash 500 g')), 1);
  const file = writeXlsx([{ name: 'Opening stock', rows: edited, textCols: [1] }]).toString('base64');
  r = await R('POST', '/opening-stock/import', { token: owner, body: { fileBase64: file } });
  ok(r.json?.ok && r.json.applied === false, `preview ${j(r)}`);
  const P = r.json;
  const m = (id) => P.matched.find((x) => x.product_id === id);
  ok(m(soap.id)?.qty === 7 && m(soap.id).cost_paisa === 9500 && m(soap.id).change === 'new', 'soap matched by barcode');
  ok(m(sugar.id)?.qty === 15 && m(sugar.id).change === 'update', 'sugar matched by exact name');
  ok(m(mash.id)?.qty === 12 && m(mash.id).cost_paisa === 26250, 'name match ignores case, blank cost keeps draft cost');
  ok(m(lays.id)?.change === 'same', 'unchanged row is same');
  ok(P.unmatched.length === 1 && P.unmatched[0].name === 'Unknown Biscuit', `unmatched ${JSON.stringify(P.unmatched)}`);
  const errs = P.errors.map((e) => `${e.name}:${e.error}`).sort();
  ok(errs.length === 3 && errs.some((e) => e.startsWith('Daal Masoor:invalid_qty')) && errs.some((e) => e.includes('qty_and_cartons')) && errs.some((e) => e.includes('duplicate_of_row')), `errors ${errs}`);
  ok(q(`SELECT qty FROM opening_stock_drafts WHERE product_id = ?`, sugar.id).qty === 12.5, 'preview changed nothing');
  r = await R('POST', '/opening-stock/import', { token: owner, body: { fileBase64: file, apply: true } });
  ok(r.json?.applied === true && r.json.totals.entered === 5, `applied ${JSON.stringify(r.json?.totals)}`);
  ok(q(`SELECT qty FROM opening_stock_drafts WHERE product_id = ?`, sugar.id).qty === 15 && q(`SELECT qty, cost_paisa FROM opening_stock_drafts WHERE product_id = ?`, soap.id).cost_paisa === 9500, 'draft filled from Excel');
  ok((await R('POST', '/opening-stock/import', { token: owner, body: { fileBase64: Buffer.from('a,b\n1,2').toString('base64') } })).status === 400, 'CSV refused (Excel only)');

  // 6. post
  const before = { sup: n('suppliers'), inv: n('purchase_invoices'), pl: n('purchase_lines'), rcv: n('stock_receives'), exp: n('expenses'), pay: n('supplier_payments') };
  const attaQty = q(`SELECT qty_on_hand q FROM stock_balances WHERE product_id = ?`, atta.id).q;
  r = await R('GET', '/opening-stock/post-preview', { token: owner });
  ok(r.json?.items === 5 && r.json.added.map((x) => x.name).sort().join() === 'Lux Soap,Sunny Atta 5 kg', `preview: atta + soap add ${j(r)}`);
  const total = 15 * 14000 + 72 * 4500 + 12 * 26250 + 5 * 120000 + 7 * 9500;
  ok(r.json.total_value_paisa === total, `preview value ${r.json.total_value_paisa}`);
  ok((await R('POST', '/opening-stock/post', { token: owner, body: {} })).status === 400, 'post needs confirm');
  r = await R('POST', '/opening-stock/post', { token: owner, body: { confirm: true } });
  ok(r.json?.ok && r.json.batch.number === 1 && r.json.batch.item_count === 5 && r.json.batch.total_value_paisa === total, `posted ${j(r)}`);
  const batch1 = r.json.batch;
  const bal = (id) => q(`SELECT qty_on_hand q FROM stock_balances WHERE product_id = ?`, id).q;
  const cost = (id) => q(`SELECT last_unit_cost_paisa c FROM products WHERE id = ?`, id).c;
  ok(bal(sugar.id) === 15 && bal(lays.id) === 72 && bal(mash.id) === 12, 'stock set in base units (kg, packets)');
  ok(bal(atta.id) === attaQty + 5 && bal(soap.id) === 107, `items with history get added ${bal(atta.id)}`);
  ok(cost(sugar.id) === 14000 && cost(lays.id) === 4500 && cost(mash.id) === 26250, 'costs set');
  ok(cost(atta.id) === Math.round((attaQty * 130000 + 5 * 120000) / (attaQty + 5)), `atta weighted cost ${cost(atta.id)}`);
  const adj = q(`SELECT COUNT(*) c, SUM(CASE WHEN unit_cost_paisa IS NOT NULL THEN 1 ELSE 0 END) costed FROM stock_adjustments WHERE reason = 'opening'`);
  ok(adj.c === 5 && adj.costed === 5, 'five opening adjustments with cost');
  ok(q(`SELECT delta_pieces d, qty_before b, qty_after a FROM stock_adjustments WHERE reason='opening' AND product_id = ?`, atta.id).d === 5, 'atta adjustment +5');
  ok(n('suppliers') === before.sup && n('purchase_invoices') === before.inv && n('purchase_lines') === before.pl && n('stock_receives') === before.rcv && n('expenses') === before.exp && n('supplier_payments') === before.pay, 'no supplier / purchase / expense rows');
  ok(n('opening_stock_drafts') === 0, 'draft emptied');
  ok(q(`SELECT COUNT(*) c FROM audit_log WHERE action = 'opening_stock.post'`).c === 1, 'audit entry');
  r = await R('GET', '/activity?kind=opening_stock', { token: owner });
  ok(r.json?.items?.length === 1 && r.json.items[0].subject === 'Opening stock #1' && r.json.items[0].amount_paisa === total, `activity shows opening stock ${j(r)}`);
  r = await R('GET', '/opening-stock', { token: owner });
  ok(r.json.batches.length === 1 && r.json.batches[0].can_undo === true, `batch can be undone right after ${r.json.batches[0]?.undo_block}`);

  // 7. a sale uses the opening cost
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', clientDeviceAt: new Date().toISOString(), lines: [{ productId: lays.id, qty: 2, unit: 'piece' }] } });
  ok(r.status === 201 && r.json?.ok, `sale ${j(r)}`);
  const sl = q(`SELECT unit_cost_paisa c, line_total_paisa t FROM sale_lines WHERE product_id = ?`, lays.id);
  ok(sl.c === 4500 && sl.t === 10000, `sale line cost = opening cost ${JSON.stringify(sl)}`);
  r = await R('GET', '/analytics', { token: owner });
  ok(r.json?.profit?.cogs_paisa === 9000 && r.json.profit.gross_profit_paisa === 1000, `analytics profit from opening cost ${JSON.stringify(r.json?.profit)}`);
  r = await R('GET', '/analytics/slow-movers', { token: owner });
  const sm = (r.json?.items ?? []).find((x) => x.product_id === sugar.id || x.id === sugar.id || x.name === 'Sugar Loose');
  ok(sm && sm.stock_value_paisa === 15 * 14000, `stock value from opening cost ${JSON.stringify(sm)} ${j(r).slice(0, 200)}`);

  // 8. undo rules
  r = await R('POST', `/opening-stock/batches/${batch1.id}/undo`, { token: owner });
  ok(r.status === 400 && r.json?.error === 'sold_since', `undo blocked after a sale ${j(r)}`);
  // add more: missed item
  r = await put(tea.id, { qty: 20, costRs: 250 });
  r = await R('POST', '/opening-stock/post', { token: owner, body: { confirm: true } });
  ok(r.json?.ok && r.json.batch.number === 2 && r.json.batch.item_count === 1 && bal(tea.id) === 20 && cost(tea.id) === 25000, 'second batch for a missed item');
  const batch2 = r.json.batch;
  r = await R('GET', '/opening-stock/batches', { token: owner });
  ok(r.json.items.find((b) => b.id === batch1.id).undo_block === 'not_last', 'only the last batch can be undone');
  r = await R('POST', `/opening-stock/batches/${batch1.id}/undo`, { token: owner });
  ok(r.status === 400 && r.json?.error === 'not_last', 'older batch refused');
  ok((await R('POST', `/opening-stock/batches/${batch2.id}/undo`, { token: cashier })).status === 403, 'cashier cannot undo');
  r = await R('POST', `/opening-stock/batches/${batch2.id}/undo`, { token: owner });
  ok(r.json?.ok && r.json.batch.undone_at, `undo batch 2 ${j(r)}`);
  ok(bal(tea.id) === 0 && cost(tea.id) === null, 'undo puts stock and cost back');
  ok(q(`SELECT qty FROM opening_stock_drafts WHERE product_id = ?`, tea.id)?.qty === 20, 'undone lines back in the draft');
  ok(q(`SELECT COUNT(*) c FROM stock_adjustments WHERE reason='opening' AND product_id = ?`, tea.id).c === 2, 'undo leaves an opening -20 adjustment');
  r = await R('POST', `/opening-stock/batches/${batch2.id}/undo`, { token: owner });
  ok(r.status === 400, 'cannot undo twice');
  // now batch 1 is last again but still blocked by the sale
  r = await R('GET', '/opening-stock/batches', { token: owner });
  ok(r.json.items.find((b) => b.id === batch1.id).undo_block === 'sold_since', 'batch 1 last again, still blocked by the sale');
  // a purchase also blocks
  r = await R('POST', '/opening-stock/post', { token: owner, body: { confirm: true } });
  const batch3 = r.json.batch;
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items[0];
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: tea.id, pieces: 10, unitCostRs: 260, lineTotalRs: 2600 }] } });
  ok(r.status === 201 || r.json?.ok, `purchase ${j(r)}`);
  r = await R('POST', `/opening-stock/batches/${batch3.id}/undo`, { token: owner });
  ok(r.status === 400 && r.json?.error === 'bought_since', `undo blocked after a purchase ${j(r)}`);

  // 9. export
  r = await R('GET', `/opening-stock/batches/${batch1.id}/export.xlsx`, { token: owner });
  const ex = readXlsx(r.buf);
  ok(r.status === 200 && ex[0][0] === 'Product' && ex.some((x) => x[0] === 'Sugar Loose' && x[3] === '15' && x[6] === '2100') && ex.some((x) => x[0] === 'Total' && x[6] === String(total / 100)), `export ${JSON.stringify(ex.slice(0, 3))}`);
  ok((await R('GET', `/opening-stock/batches/${batch1.id}/export.xlsx`, { token: cashier })).status === 403, 'cashier cannot export');

  // 10. backup v16 carries it; an old copy without it restores fine
  r = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const bundle = r.json;
  ok(bundle?.header?.schema_version === 16 && bundle.batch2.opening.batches.length === 3 && bundle.batch2.opening.lines.length === 7, `backup v16 opening ${JSON.stringify(bundle?.batch2?.opening?.batches?.length)}`);
  r = await put(daal.id, { qty: 3, costRs: 200 });
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle } });
  ok(r.json?.ok !== false && r.status < 300, `restore ${j(r)}`);
  ok(n('opening_stock_batches') === 3 && n('opening_stock_lines') === 7 && n('opening_stock_drafts') === 0, 'restore brings batches back, draft as in the copy');
  const old = JSON.parse(JSON.stringify(bundle));
  delete old.batch2.opening;
  old.header.schema_version = 15;
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: old } });
  ok(r.status < 300 && n('opening_stock_batches') === 0, `v15 copy restores with no opening stock records ${j(r)}`);
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle } });

  // 11. reset clears it
  r = await put(daal.id, { qty: 3, costRs: 200 });
  r = await R('POST', '/settings/reset-data', { token: owner, body: { confirm: 'RESET' } });
  ok(r.json?.ok && r.json.wiped.opening_stock_batches === 3 && r.json.wiped.opening_stock_drafts === 1, `reset wipes opening stock ${j(r)}`);
  ok(n('opening_stock_batches') + n('opening_stock_lines') + n('opening_stock_drafts') === 0, 'opening tables empty after reset');
  for (const f of [r.json.backup_file, r.json.backup_db_file]) (await import('node:fs')).rmSync(f, { force: true });
} finally {
  await api.stop();
}
console.log(`test-opening-stock: PASS ${c.passed} checks`);
