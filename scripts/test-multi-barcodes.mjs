#!/usr/bin/env node
/** Multiple barcodes per product: add / remove / promote, unique across products, every lookup matches any code,
 * backup v15 round trip and old copies without them. SKIP_BUILD=1 node scripts/test-multi-barcodes.mjs */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('multibarcode', Number(process.env.API_PORT ?? 3963));
const R = api.request;
const j = (r) => (r.raw ?? '').slice(0, 300);
const err = (r) => r.json?.error ?? r.json?.message?.error;
const MAKER = '8964000074008';
try {
  const { owner, cashier } = await seed(api);
  const mk = async (body) => R('POST', '/catalog/products', { token: owner, body: { priceRs: 420, unitLabel: 'piece', ...body } });
  let r = await mk({ name: 'Adams Cheddar 200 g', extraBarcodes: [MAKER, ' 1234567890 ', MAKER] });
  ok(r.json?.ok, `create with extras ${j(r)}`);
  const a = r.json.product;
  ok(/^20\d{11}$/.test(a.barcode) && JSON.stringify(a.extra_barcodes) === JSON.stringify([MAKER, '1234567890']), `in-store primary + 2 extras ${JSON.stringify(a.extra_barcodes)}`);

  const look = (code, purpose) => R('GET', `/catalog/lookup?barcode=${encodeURIComponent(code)}${purpose ? `&for=${purpose}` : ''}`, { token: cashier });
  for (const [code, p] of [[a.barcode, 'sale'], [MAKER, 'sale'], [MAKER, 'purchase'], ['1234567890', undefined]]) {
    r = await look(code, p);
    ok(r.json?.ok && r.json.product.id === a.id, `lookup ${code} ${p ?? 'count'} -> Adams ${j(r)}`);
  }
  r = await R('GET', `/catalog/products?q=896400007&page=1&pageSize=20&for=sale`, { token: cashier });
  ok(r.json?.items?.some((x) => x.id === a.id), 'catalog search matches part of an extra');

  // unique across products
  r = await mk({ name: 'Other 1', barcode: MAKER });
  ok(r.status === 409 && err(r) === 'duplicate_barcode', `primary = someone's extra refused ${r.status}`);
  r = await mk({ name: 'Other 2', extraBarcodes: [a.barcode] });
  ok(r.status === 409 && err(r) === 'duplicate_barcode', `extra = someone's primary refused ${r.status}`);
  r = await mk({ name: 'Other 3' });
  const b = r.json.product;
  r = await R('PATCH', `/catalog/products/${b.id}`, { token: owner, body: { extraBarcodes: ['1234567890'] } });
  ok(r.status === 409 && err(r) === 'duplicate_barcode', `extra = someone's extra refused ${r.status}`);
  r = await R('GET', `/catalog/products/${b.id}`, { token: owner });
  const bNow = r.json?.product ?? r.json;
  ok((bNow.extra_barcodes ?? []).length === 0, 'refused edit left nothing behind');
  r = await R('PATCH', `/catalog/products/${b.id}`, { token: owner, body: { extraBarcodes: ['bad\u0001code'] } });
  ok(r.status === 400, 'bad code refused');

  // remove, re-add, promote an extra to primary
  r = await R('PATCH', `/catalog/products/${a.id}`, { token: owner, body: { extraBarcodes: [MAKER] } });
  ok(r.json?.ok && r.json.product.extra_barcodes.join() === MAKER, `removed one ${j(r)}`);
  r = await look('1234567890');
  ok(r.status === 404, 'removed code no longer scans');
  r = await R('PATCH', `/catalog/products/${b.id}`, { token: owner, body: { extraBarcodes: ['1234567890'] } });
  ok(r.json?.ok && r.json.product.extra_barcodes.join() === '1234567890', 'freed code can go on another item');
  const oldPrimary = a.barcode;
  r = await R('PATCH', `/catalog/products/${a.id}`, { token: owner, body: { barcode: MAKER, extraBarcodes: [MAKER, oldPrimary] } });
  ok(r.json?.ok && r.json.product.barcode === MAKER && r.json.product.extra_barcodes.join() === oldPrimary, `promote maker code, old sticker kept as extra ${j(r)}`);
  r = await look(oldPrimary, 'sale');
  ok(r.json?.ok && r.json.product.id === a.id, 'old in-store sticker still scans');
  r = await R('PATCH', `/catalog/products/${a.id}`, { token: owner, body: { barcode: oldPrimary, extraBarcodes: [MAKER] } });
  ok(r.json?.ok && r.json.product.barcode === oldPrimary && r.json.product.extra_barcodes.join() === MAKER, `swap back ${j(r)}`);
  r = await R('PATCH', `/catalog/products/${a.id}`, { token: owner, body: { priceRs: 430 } });
  ok(r.json?.ok && r.json.product.extra_barcodes.join() === MAKER, 'edit without the list keeps extras');

  // stock count worksheet search finds the extra
  r = await R('POST', '/stock/counts', { token: owner, body: { source: 'full_screen' } });
  const sid = r.json?.session?.id;
  r = await R('GET', `/stock/counts/${sid}/items?filter=all&page=1&pageSize=20&q=${MAKER}`, { token: owner });
  ok(r.json?.items?.some((x) => x.product_id === a.id), `stock count search by extra ${j(r)}`);
  await R('POST', `/stock/counts/${sid}/discard`, { token: owner });

  // sell by the maker code: lookup gives the product, the sale goes through, sales search finds it
  const supId = (await R('GET', '/suppliers', { token: owner })).json.items[0].id;
  r = await R('POST', '/stock/receive', { token: owner, body: { productId: a.id, qty: 5, unit: 'piece', amountRs: 1500, supplierId: supId } });
  ok(r.json?.ok, `receive 5 ${j(r)}`);
  const hit = (await look(MAKER, 'sale')).json.product;
  r = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', clientDeviceAt: new Date().toISOString(), lines: [{ productId: hit.id, qty: 1, unit: 'piece' }] } });
  ok(r.json?.ok, `sale by maker code ${j(r)}`);
  const s = await R('GET', `/sales?q=${MAKER}&page=1&pageSize=20`, { token: owner });
  ok((s.json?.items ?? s.json?.sales ?? []).length >= 1, `sales search by extra ${j(s)}`);

  // backup v15 keeps extras; an older copy (no barcodes) restores with none
  r = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const bundle = r.json?.bundle ?? r.json;
  ok(bundle?.header?.schema_version === 16 && bundle.batch2?.barcodes?.length === 2, `bundle v15 barcodes ${JSON.stringify(bundle?.batch2?.barcodes)}`);
  await R('PATCH', `/catalog/products/${a.id}`, { token: owner, body: { extraBarcodes: [] } });
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle } });
  ok(r.json?.ok, `restore v15 ${j(r)}`);
  let tok = r.json?.sessionToken ?? owner;
  if (!(await R('GET', `/catalog/products/${a.id}`, { token: tok })).json) tok = owner;
  r = await R('GET', `/catalog/lookup?barcode=${MAKER}`, { token: tok });
  ok(r.json?.ok && r.json.product.id === a.id && r.json.product.extra_barcodes.includes(MAKER), `extras back after restore ${j(r)}`);
  const old = JSON.parse(JSON.stringify(bundle));
  old.header.schema_version = 14;
  delete old.batch2.barcodes;
  r = await R('POST', '/backup/restore', { token: tok, body: { pin: '2468', bundle: old } });
  ok(r.json?.ok, `restore v14 copy ${j(r)}`);
  tok = r.json?.sessionToken ?? tok;
  r = await R('GET', `/catalog/lookup?barcode=${a.barcode}`, { token: tok });
  ok(r.json?.ok && r.json.product.extra_barcodes.length === 0, `old copy: primary works, no extras ${j(r)}`);
} catch (e) {
  ok(false, `crashed: ${e.stack}`);
} finally {
  api.stop();
}
console.log(`\nmulti-barcodes: ${c.passed} checks passed`);
