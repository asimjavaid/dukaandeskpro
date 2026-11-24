#!/usr/bin/env node
/** Linked sizes: group + qty, per-unit repricing (whole Rs), price history, activity, backup v8 + older v7 restore. SKIP_BUILD=1 node scripts/test-sizes.mjs */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
const api = await startApi('sizes', Number(process.env.API_PORT ?? 3886));
const R = api.request;
const j = (r) => r.raw.slice(0, 300);
try {
  const { owner, cashier } = await seed(api);
  const mk = async (name, rs) => (await R('POST', '/catalog/products', { token: owner, body: { name, pricePaisa: rs * 100, unitLabel: 'piece' } })).json.product;
  const dz = await mk('Eggs 12 pcs', 144);
  const six = await mk('Eggs 6 pcs', 72);
  const one = await mk('Eggs 1 pc', 12);
  let r = await R('POST', `/catalog/products/${dz.id}/size-link`, { token: owner, body: { qty: 12 } });
  ok(r.json?.ok && r.json.product.size_qty === 12 && r.json.product.size_group_id, `link first ${j(r)}`);
  r = await R('POST', `/catalog/products/${six.id}/size-link`, { token: owner, body: { withProductId: dz.id, qty: 6 } });
  ok(r.json?.ok && r.json.product.size_group_id === dz.id, `link 6 ${j(r)}`);
  await R('POST', `/catalog/products/${one.id}/size-link`, { token: owner, body: { withProductId: six.id, qty: 1 } });
  r = await R('POST', `/catalog/products/${one.id}/size-link`, { token: cashier, body: { qty: 1 } });
  ok(r.status === 403, `cashier cannot link (${r.status})`);
  r = await R('POST', `/catalog/products/${one.id}/size-link`, { token: owner, body: { qty: -1 } });
  ok(r.json?.error === 'invalid_size_qty', `bad qty ${j(r)}`);
  r = await R('GET', `/catalog/products/${dz.id}/sizes`, { token: owner });
  ok(r.json.items.length === 2, `sizes ${j(r)}`);
  r = await R('GET', `/catalog/products/${dz.id}/size-plan?pricePaisa=16800`, { token: owner });
  const plan = Object.fromEntries(r.json.items.map((x) => [x.name, [x.old_price_paisa, x.new_price_paisa]]));
  ok(JSON.stringify(plan['Eggs 1 pc']) === '[1200,1400]' && JSON.stringify(plan['Eggs 6 pcs']) === '[7200,8400]', `plan ${j(r)}`);
  // only this one
  r = await R('PATCH', `/catalog/products/${dz.id}`, { token: owner, body: { pricePaisa: 15000 } });
  ok(r.json?.ok && r.json.sizes.length === 0, 'only this one');
  let g = (await R('GET', `/catalog/products/${six.id}/sizes`, { token: owner })).json.items;
  ok(g.find((x) => x.id === one.id).price_paisa === 1200, 'others unchanged');
  // update all
  r = await R('PATCH', `/catalog/products/${dz.id}`, { token: owner, body: { pricePaisa: 16800, updateSizes: true } });
  ok(r.json?.ok && r.json.sizes.length === 2, `update all ${j(r)}`);
  g = (await R('GET', `/catalog/products/${dz.id}/sizes`, { token: owner })).json.items;
  ok(g.find((x) => x.id === one.id).price_paisa === 1400 && g.find((x) => x.id === six.id).price_paisa === 8400, 'sizes repriced');
  // sugar: decimals + rounding to whole Rs
  const kg = await mk('Sugar 1 kg', 165);
  const half = await mk('Sugar 500 g', 85);
  const q = await mk('Sugar 250 g', 43);
  await R('POST', `/catalog/products/${kg.id}/size-link`, { token: owner, body: { qty: 1 } });
  await R('POST', `/catalog/products/${half.id}/size-link`, { token: owner, body: { withProductId: kg.id, qty: 0.5 } });
  await R('POST', `/catalog/products/${q.id}/size-link`, { token: owner, body: { withProductId: kg.id, qty: 0.25 } });
  r = await R('GET', `/catalog/products/${kg.id}/size-plan?pricePaisa=17500`, { token: owner });
  const sp = Object.fromEntries(r.json.items.map((x) => [x.name, x.new_price_paisa]));
  ok(sp['Sugar 500 g'] === 8800 && sp['Sugar 250 g'] === 4400, `sugar plan ${j(r)}`);
  r = await R('GET', `/catalog/products/${one.id}/price-history`, { token: owner });
  ok(r.json.items.length >= 1 && r.json.items[0].new_price_paisa === 1400 && r.json.items[0].changed_by_name, `price history ${j(r)}`);
  r = await R('GET', '/activity', { token: owner });
  const act = JSON.stringify(r.json);
  ok(act.includes('catalog.size_prices') && act.includes('Eggs 1 pc Rs 12 → Rs 14'), 'activity logged');
  // backup v8 carries sizes; v7-style copy (no sizes) still restores
  r = await R('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  const b = r.json?.bundle ?? r.json;
  ok(b.header.schema_version === 16 && b.batch2.sizes.length === 6, 'backup v8 sizes');
  await R('POST', `/catalog/products/${one.id}/size-link`, { token: owner, body: { qty: null } });
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: b } });
  ok(r.json?.ok, `restore v8 ${j(r)}`);
  g = (await R('GET', `/catalog/products/${dz.id}/sizes`, { token: owner })).json.items;
  ok(g.length === 2, 'link restored');
  const old = JSON.parse(JSON.stringify(b));
  old.header.schema_version = 7;
  delete old.batch2.sizes;
  r = await R('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: old } });
  ok(r.json?.ok, `restore older v7 ${j(r)}`);
  console.log(`sizes: all ${c.passed} checks passed`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  await api.stop?.();
}
