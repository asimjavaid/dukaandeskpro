#!/usr/bin/env node
/** Pricing: line totals, markup suggestions (receive, PO receive, repack), MRP items never repriced, settings, backup v11.
 * SKIP_BUILD=1 node scripts/test-pricing.mjs */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('pricing', Number(process.env.API_PORT ?? 3894));
const R = api.request;
const j = (r) => r.raw.slice(0, 300);
try {
  const s = await seed(api);
  const { owner, cashier, stock } = s;
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items.find((x) => x.name === 'Test Supplier');
  const mk = async (name, priceRs, unitLabel = 'piece', extra = {}) =>
    (await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel, ...extra } })).json.product;

  // settings
  let r = await R('GET', '/pricing/settings', { token: owner });
  ok(r.json?.pricing?.default_markup_bp === 3000 && r.json.pricing.round_paisa === 500 && r.json.pricing.round_mode === 'up' && r.json.pricing.min_margin_bp === 500, `defaults ${j(r)}`);
  r = await R('GET', '/pricing/settings', { token: cashier });
  ok(r.status === 403, `cashier blocked ${r.status}`);
  r = await R('POST', '/pricing/settings', { token: owner, body: { round_paisa: 700 } });
  ok(r.status === 400, 'bad rounding refused');

  // line total: 20 kg sugar for Rs 6000 -> Rs 300/kg
  const loose = await mk('Sugar Loose', 160, 'kg');
  ok(loose.unit_label === 'kg' && loose.fixed_price === 0 && loose.markup_bp === null, 'kg product');
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: loose.id, pieces: 20, unitCostRs: 1, lineTotalRs: 6000 }] } });
  ok(r.json?.ok && r.json.invoice.total_paisa === 600000, `line total bill ${j(r)}`);
  ok(r.json.lines[0].unit_cost_paisa === 30000 && r.json.lines[0].line_total_paisa === 600000, `unit 300/kg ${JSON.stringify(r.json.lines[0])}`);
  ok(stock(loose.id) === 20, 'stock 20 kg');
  const pc = r.json.price_check ?? [];
  ok(pc.length === 1 && pc[0].suggested_paisa === 39000 && pc[0].current_paisa === 16000 && pc[0].needs, `suggest 390 ${JSON.stringify(pc)}`);
  ok(pc[0].current_margin_bp === -8750 && pc[0].suggested_margin_bp === 2308, `margins ${pc[0].current_margin_bp} ${pc[0].suggested_margin_bp}`);

  // apply
  r = await R('POST', '/pricing/apply', { token: owner, body: { items: [{ productId: loose.id, pricePaisa: 39000 }] } });
  ok(r.json?.ok && r.json.updated === 1, `apply ${j(r)}`);
  r = await R('GET', `/catalog/products/${loose.id}/price-history`, { token: owner });
  ok((r.json?.items ?? []).some((h) => h.new_price_paisa === 39000 || h.price_paisa === 39000), `price history ${j(r)}`);

  // same cost again -> no suggestion (< 1% change)
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: loose.id, pieces: 10, unitCostRs: 301 }] } });
  ok(r.json?.ok && (r.json.price_check ?? []).length === 0, `small change quiet ${JSON.stringify(r.json.price_check)}`);

  // fixed price (MRP): Lays Rs 30, carton of 24 @ 650 -> never suggested; apply refused
  const lays = await mk('Lays Rs 30', 30, 'piece', { fixedPrice: true });
  ok(lays.fixed_price === 1, 'fixed flag on create');
  const ctn = (await R('POST', '/packs', { token: owner, body: { productId: lays.id, name: 'Carton', units: 24 } })).json.packs[0];
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: lays.id, packId: ctn.id, packQty: 2, packCostRs: 650 }] } });
  ok(r.json?.ok && (r.json.price_check ?? []).length === 0, 'fixed item not suggested');
  r = await R('POST', '/pricing/apply', { token: owner, body: { items: [{ productId: lays.id, pricePaisa: 3500 }] } });
  ok(r.json?.error === 'fixed_price', 'apply refused on MRP item');
  // pack line total: 2 cartons for Rs 1300 -> 650 each
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: lays.id, packId: ctn.id, packQty: 2, packCostRs: 1, lineTotalRs: 1300 }] } });
  ok(r.json?.ok && r.json.invoice.total_paisa === 130000 && r.json.lines[0].unit_cost_paisa === 2708, `pack total ${JSON.stringify(r.json.lines?.[0])}`);

  // per-product markup + edit
  const daal = await mk('Daal Masoor', 350, 'kg', { markupPct: 20 });
  ok(daal.markup_bp === 2000, 'markup on create');
  r = await R('PATCH', `/catalog/products/${daal.id}`, { token: owner, body: { markupPct: '' } });
  ok(r.json?.product?.markup_bp === null, 'markup cleared');
  r = await R('PATCH', `/catalog/products/${daal.id}`, { token: owner, body: { markupPct: 25, fixedPrice: false } });
  ok(r.json?.product?.markup_bp === 2500, 'markup 25');
  r = await R('PATCH', `/catalog/products/${daal.id}`, { token: owner, body: { markupPct: -1 } });
  ok(r.json?.ok === false || r.status === 400, 'negative markup refused');

  // PO receive: cost 280 -> 300 suggests (25% -> 375)
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: daal.id, pieces: 1, unitCostRs: 280 }] } });
  r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup.id, lines: [{ productId: daal.id, qty: 5 }] } });
  ok(r.json?.ok, `po ${j(r)}`);
  const po = r.json;
  r = await R('POST', `/purchase-orders/${po.order.id}/receive`, { token: owner, body: { lines: [{ orderLineId: po.lines[0].id, qty: 5, unitCostRs: 1, lineTotalRs: 1500 }] } });
  ok(r.json?.ok && r.json.order.status === 'received', `po receive ${j(r)}`);
  const prc = r.json.price_check ?? [];
  ok(prc.length === 1 && prc[0].cost_paisa === 30000 && prc[0].prev_cost_paisa === 28000 && prc[0].suggested_paisa === 37500 && prc[0].markup_custom, `po suggest ${JSON.stringify(prc)}`);

  // rounding: nearest Rs 10
  r = await R('POST', '/pricing/settings', { token: owner, body: { round_paisa: 1000, round_mode: 'nearest' } });
  ok(r.json?.ok && r.json.pricing.round_paisa === 1000, 'settings saved');
  r = await R('POST', '/pricing/suggest', { token: owner, body: { lines: [{ productId: daal.id, costPaisa: 30000 }] } });
  ok(r.json.items[0].suggested_paisa === 3.75e4 - 3.75e4 % 1000 + (3.75e4 % 1000 >= 500 ? 1000 : 0), `nearest 10 ${j(r)}`);
  await R('POST', '/pricing/settings', { token: owner, body: { round_paisa: 500, round_mode: 'up' } });

  // repack 20 kg -> 8x1 + 2x5 + 4x0.5, packing Rs 140
  r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: loose.id, pieces: 20, unitCostRs: 300 }] } });
  const p1 = await mk('Sugar 1 kg', 165);
  const p5 = await mk('Sugar 5 kg', 800);
  const ph = await mk('Sugar 0.5 kg', 85);
  for (const [p, q] of [[p1, 1], [p5, 5], [ph, 0.5]]) await R('POST', '/repack/link', { token: owner, body: { productId: p.id, bulkId: loose.id, qtyEach: q } });
  r = await R('POST', '/repack', {
    token: owner,
    body: { bulkId: loose.id, bulkUsed: 20, bulkCostRs: 300, packingCostRs: 140, lines: [{ productId: p1.id, packets: 8 }, { productId: p5.id, packets: 2 }, { productId: ph.id, packets: 4 }] },
  });
  ok(r.json?.ok, `repack ${j(r)}`);
  const rc = Object.fromEntries((r.json.price_check ?? []).map((x) => [x.product_id, x]));
  ok(rc[p1.id]?.cost_paisa === 30700 && rc[p1.id].suggested_paisa === 40000, `1kg 307 -> 400 ${JSON.stringify(rc[p1.id])}`);
  ok(rc[p5.id]?.cost_paisa === 153500 && rc[p5.id].suggested_paisa === 200000, `5kg 1535 -> 2000 ${JSON.stringify(rc[p5.id])}`);
  ok(rc[ph.id]?.cost_paisa === 15350 && rc[ph.id].suggested_paisa === 20000, `0.5kg 153.5 -> 200 ${JSON.stringify(rc[ph.id])}`);
  r = await R('POST', '/pricing/apply', { token: owner, body: { items: Object.values(rc).map((x) => ({ productId: x.product_id, pricePaisa: x.suggested_paisa })) } });
  ok(r.json?.ok && r.json.updated === 3, 'apply all');
  r = await R('GET', '/activity?kind=price.suggest_apply', { token: owner });
  ok((r.json?.items ?? []).length >= 2, `audit ${j(r)}`);

  // never below cost
  r = await R('POST', '/pricing/settings', { token: owner, body: { default_markup_bp: 0 } });
  r = await R('POST', '/pricing/suggest', { token: owner, body: { lines: [{ productId: p1.id, costPaisa: 30750 }] } });
  ok(r.json.items[0].suggested_paisa === 31000, `>= cost ${j(r)}`);
  await R('POST', '/pricing/settings', { token: owner, body: { default_markup_bp: 3000 } });

  // backup v11 round trip
  const ex = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const b = ex.json?.bundle ?? ex.json;
  ok(b.header.schema_version === 16 && b.batch2.pricing.products.length === 2 && b.batch2.pricing.bill_totals.length === 3, `backup v11 ${JSON.stringify(b.batch2.pricing).slice(0, 200)}`);
  await R('PATCH', `/catalog/products/${lays.id}`, { token: owner, body: { fixedPrice: false } });
  await R('POST', '/pricing/settings', { token: owner, body: { default_markup_bp: 4000 } });
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: b } });
  ok(r.json?.ok, `restore ${j(r)}`);
  r = await R('GET', `/catalog/products?q=${encodeURIComponent('Lays Rs 30')}`, { token: owner });
  ok(r.json.items[0]?.fixed_price === 1, 'fixed back');
  r = await R('GET', '/pricing/settings', { token: owner });
  ok(r.json.pricing.default_markup_bp === 3000, 'markup back');
  // older copy (no pricing section) -> defaults
  const old = JSON.parse(JSON.stringify(b));
  delete old.batch2.pricing;
  old.header.schema_version = 10;
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: old } });
  ok(r.json?.ok, `restore v10 ${j(r)}`);
  r = await R('GET', `/catalog/products?q=${encodeURIComponent('Lays Rs 30')}`, { token: owner });
  ok(r.json.items[0]?.fixed_price === 0, 'v10 copy -> defaults');
  console.log(`pricing: ${c.passed} checks passed`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  await api.stop();
  c.done?.();
}
