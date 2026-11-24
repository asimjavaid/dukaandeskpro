#!/usr/bin/env node
/** Size wording guard on product save + dedupe-names script (merge, rename, repeat, undo).
 * SKIP_BUILD=1 node scripts/test-size-names.mjs */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.join(here, '..', 'apps', 'api');
const require = createRequire(path.join(apiDir, 'package.json'));
const Database = require('better-sqlite3');
const { sizeName } = require(path.join(apiDir, 'dist', 'catalog', 'size-names.js'));

const c = makeChecks();
const { ok } = c;
const cases = [
  ['Rice 500g', 'Rice 500 g'], ['Daal 0.5 kg', 'Daal 500 g'], ['Gur 0.25kg', 'Gur 250 g'], ['Atta 1KG', 'Atta 1 kg'], ['Atta 10 KG', 'Atta 10 kg'],
  ['Oil 1.5 litre', 'Oil 1.5 L'], ['Oil 1.5 liter', 'Oil 1.5 L'], ['Milk 250ML', 'Milk 250 ml'], ['Water 0.5 L', 'Water 500 ml'], ['Dahi 1000 g', 'Dahi 1 kg'],
  ['Sugar (Cheeni) Loose', 'Sugar (Cheeni) Loose'], ['Eggs 0.5 Dozen', 'Eggs 0.5 Dozen'], ['Tapal 3in1 20 g', 'Tapal 3in1 20 g'], ['LED Bulb 12 W', 'LED Bulb 12 W'],
  ['Vermicelli 150gm', 'Vermicelli 150 g'], ['Ghee 2.5L Tin', 'Ghee 2.5 L Tin'], ['LU Candi 58.6g', 'LU Candi 58.6 g'],
];
for (const [a, b] of cases) ok(sizeName(a) === b, `sizeName ${JSON.stringify(a)} -> ${JSON.stringify(sizeName(a))}`);

const api = await startApi('sizenames', Number(process.env.API_PORT ?? 3962));
const R = api.request;
let ids = {};
try {
  const { owner } = await seed(api);
  const mk = async (name, priceRs, unitLabel = 'packet', extra = {}) => {
    const r = await R('POST', '/catalog/products', { token: owner, body: { name, priceRs, unitLabel, ...extra } });
    if (!r.json?.ok) throw new Error(`mk ${name} ${r.raw}`);
    return r.json.product;
  };
  const a = await mk('Test Rice 500g', 200);
  ok(a.name === 'Test Rice 500 g', `new product saved as "${a.name}"`);
  const b = await mk('Test Oil 1.5 litre', 600, 'piece');
  ok(b.name === 'Test Oil 1.5 L', `litre -> L "${b.name}"`);
  const r = await R('PATCH', `/catalog/products/${a.id}`, { token: owner, body: { name: 'Test Gur 0.25kg' } });
  ok(r.json?.ok && r.json.product.name === 'Test Gur 250 g', `edit saved as "${r.json?.product?.name}"`);
  const loose = await mk('Rajma Loose', 500, 'kg', { productType: 'bulk' });
  ok(loose.name === 'Rajma Loose', 'loose name unchanged');
  // duplicates for the script: same item, one with "(Red Beans)" and one without
  const keep = await mk('Rajma (Red Beans) 500 g', 200, 'packet', { productType: 'packed', bulkId: loose.id, packKg: 0.5 });
  const lose = await mk('Rajma 500 g', 250, 'packet');
  const sup = (await R('GET', '/suppliers', { token: owner })).json.items[0];
  await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: keep.id, pieces: 4, lineTotalRs: 600 }, { productId: lose.id, pieces: 3, lineTotalRs: 450 }] } });
  ids = { keep: keep.id, lose: lose.id, a: a.id };
} catch (e) {
  ok(false, `crashed: ${e.stack}`);
} finally {
  api.stop();
}
await new Promise((res) => setTimeout(res, 800));

const db = api.dbPath;
// an old-style name typed before the guard existed
{
  const d = new Database(db);
  d.prepare(`UPDATE products SET name = 'Test Gur 0.25kg' WHERE id = ?`).run(ids.a);
  d.close();
}
const run = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(here, 'dedupe-names.cjs'), ...a, '--db', db], { cwd: apiDir, encoding: 'utf8' }).trim().split('\n').pop());
const snap = () => {
  const d = new Database(db, { readonly: true });
  const rows = d.prepare(`SELECT p.id, p.name, p.active, p.product_type, p.repack_from_id, COALESCE(s.qty_on_hand, 0) AS q FROM products p LEFT JOIN stock_balances s ON s.product_id = p.id ORDER BY p.id`).all();
  d.close();
  return rows;
};
const before = snap();
const qty = (rows, id) => rows.find((x) => x.id === id)?.q;
const log = path.join(path.dirname(db), `dedupe-test-${Date.now()}.json`);
const p = run('apply', '--log', log);
ok(p.merges === 1 && p.renames === 1, `apply: 1 merge, 1 rename ${JSON.stringify(p)}`);
ok(p.totals.before.stock === p.totals.after.stock, 'total stock unchanged');
const after = snap();
ok(qty(after, ids.keep) === 7 && qty(after, ids.lose) === 0, `stock 4 + 3 -> keeper 7 (${qty(after, ids.keep)}, loser ${qty(after, ids.lose)})`);
ok(after.find((x) => x.id === ids.lose).active === 0 && after.find((x) => x.id === ids.keep).active === 1, 'loser inactive, keeper active');
ok(after.find((x) => x.id === ids.a).name === 'Test Gur 250 g', 'old name tidied');
const again = run('apply', '--log', `${log}.2`);
ok(again.merges === 0 && again.renames === 0, `repeat does nothing ${JSON.stringify(again)}`);
run('undo', '--log', `${log}.2`);
const u = run('undo', '--log', log);
ok(u.reactivated === 1 && u.renames === 1 && u.stockBack === 1, `undo ${JSON.stringify(u)}`);
ok(JSON.stringify(snap()) === JSON.stringify(before), 'undo restores names, active flags and stock');
for (const f of [log, `${log}.2`]) fs.rmSync(f, { force: true });
console.log(`\n${c.passed} passed`);

