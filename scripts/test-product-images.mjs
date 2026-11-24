#!/usr/bin/env node
/**
 * Product pictures + kiryana import, end to end on a throwaway DB:
 * seed a shop with products and sales, roll it back to pre-030, migrate,
 * import (dry run, real, rerun = 0), scan-to-sell an imported item,
 * picture upload/remove, backup v4 copy/restore and older-copy restore.
 * Run: node scripts/test-product-images.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startApi, seed, makeChecks, Database, root } from './lib/sales-harness.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));

const c = makeChecks();
const { ok } = c;
const PORT = Number(process.env.API_PORT ?? 3879);
let api = await startApi('images', PORT);
const dbPath = api.dbPath;
const imgDir = path.join(path.dirname(dbPath), 'product-images');
fs.rmSync(imgDir, { recursive: true, force: true });
const importer = (extra = []) =>
  JSON.parse(execFileSync('node', [path.join(root, 'scripts/import-kiryana.mjs'), '--db', dbPath, ...extra], { encoding: 'utf8' }));

try {
  const s = await seed(api);
  const { owner, cashier, atta, rashid, sell } = s;
  await sell(cashier, { paymentMethod: 'cash', lines: [{ productId: atta.id, qty: 2 }] });
  await sell(owner, { paymentMethod: 'udhaar', partyId: rashid.id, lines: [{ productId: atta.id, qty: 1 }] });
  // A product with the same name as a CSV row, and one with a sourced barcode.
  let r = await api.request('POST', '/catalog/products', { token: owner, body: { name: 'tapal danedar 190g pouch', priceRs: 360 } });
  ok(r.json?.ok, 'dup-name product');
  r = await api.request('POST', '/catalog/products', { token: owner, body: { name: 'Pepsi half litre', priceRs: 90, barcode: '8964002343850' } });
  ok(r.json?.ok, 'dup-barcode product');
  api.stop();
  await new Promise((res) => setTimeout(res, 800));

  // ---- Simulate an existing pre-030 shop DB, then migrate ----
  const IS_PG = process.env.DD_DB === 'pg' || !!process.env.DATABASE_URL;
  let d = new Database(dbPath);
  // Pre-030 simulation is SQLite-only (on PostgreSQL migration 030 is part of baseline.sql).
  if (!IS_PG) d.exec(`ALTER TABLE products DROP COLUMN image_file; DELETE FROM schema_migrations WHERE id = '030_product_images.sql';`);
  const before = d.prepare(`SELECT (SELECT COUNT(*) FROM products) p, (SELECT COUNT(*) FROM sales) s, (SELECT COUNT(*) FROM sale_lines) l, (SELECT COUNT(*) FROM party_ledger) k`).get();
  d.close();
  const dry0 = importer(['--dry-run']);
  // Counts follow the current kiryana CSV (it changes as Asim edits prices), so expect what the dry run reports.
  const N = dry0.to_add;
  ok(N > 300 && dry0.exists_by_name >= 1 && dry0.exists_by_barcode === 1 && dry0.csv_rows === N + dry0.no_price + dry0.exists_by_name + dry0.exists_by_barcode + dry0.dup_in_csv + dry0.bad_row, `dry run ${JSON.stringify(dry0)}`);
  const m = migrate(dbPath);
  ok(IS_PG || m.applied.includes('030_product_images.sql'), 'migration 030 applied');
  d = new Database(dbPath, { readonly: true });
  const after = d.prepare(`SELECT (SELECT COUNT(*) FROM products) p, (SELECT COUNT(*) FROM sales) s, (SELECT COUNT(*) FROM sale_lines) l, (SELECT COUNT(*) FROM party_ledger) k`).get();
  d.close();
  ok(JSON.stringify(before) === JSON.stringify(after), `data intact after migrate ${JSON.stringify(after)}`);

  // ---- Import ----
  const run1 = importer();
  ok(run1.added === N && run1.products_now === before.p + N, `import ${run1.added} -> ${run1.products_now}`);
  const run2 = importer();
  ok(run2.added === 0, 'rerun adds 0');
  d = new Database(dbPath, { readonly: true });
  const bc = d.prepare(`SELECT COUNT(*) n, COUNT(DISTINCT barcode) u, SUM(barcode IS NULL) z FROM products`).get();
  ok(bc.n === bc.u && !bc.z, `barcodes unique ${JSON.stringify(bc)}`);
  const stk = d.prepare(`SELECT COUNT(*) n FROM stock_balances sb JOIN products p ON p.id = sb.product_id WHERE p.image_file IS NOT NULL AND sb.qty_on_hand != 0`).get();
  ok(stk.n === 0, 'imported stock 0');
  const cost = d.prepare(`SELECT COUNT(*) n FROM products WHERE image_file IS NOT NULL AND last_unit_cost_paisa IS NOT NULL`).get();
  ok(cost.n === 0, 'imported cost not set');
  const files = d.prepare(`SELECT image_file FROM products WHERE image_file IS NOT NULL`).all();
  ok(files.length === N && files.every((f) => fs.existsSync(path.join(imgDir, f.image_file))), 'all pictures on disk');
  const seq = d.prepare(`SELECT next_n FROM barcode_seq WHERE id = 1`).get().next_n;
  d.close();

  // ---- API on the imported DB ----
  api = await restart();
  const look = await api.request('GET', '/catalog/lookup?barcode=8961103601971', { token: cashier });
  ok(look.status === 200 && look.json.product.name === 'Tapal Danedar 430g' && look.json.product.image_file, 'scan lookup sourced barcode');
  const img = await api.request('GET', `/catalog/images/${look.json.product.image_file}`);
  ok(img.status === 200 && img.headers['content-type'].startsWith('image/jpeg') && /immutable/.test(img.headers['cache-control']), 'picture served with cache headers');
  ok((await api.request('GET', '/catalog/images/..%2Fdukaandesk.sqlite')).status === 404, 'path traversal 404');
  ok((await sell(cashier, { paymentMethod: 'cash', lines: [{ productId: look.json.product.id, qty: 1 }] }).catch((e) => String(e))).includes('insufficient_stock'), 'stock 0 blocks sale until received');
  const sup = (await api.request('GET', '/suppliers', { token: owner })).json;
  const supplierId = (sup.items ?? sup.suppliers ?? sup)[0].id;
  const rc = await api.request('POST', '/stock/receive', { token: owner, body: { productId: look.json.product.id, qty: 10, unit: 'piece', amountRs: 8000, supplierId } });
  ok(rc.json?.ok, `receive ${rc.raw.slice(0, 120)}`);
  const sale = await sell(cashier, { paymentMethod: 'cash', lines: [{ productId: look.json.product.id, qty: 1 }] }).catch((e) => ({ err: String(e) }));
  ok(!sale.err, `sell imported item at stock 0 ${sale.err ?? ''}`);
  if (!sale.err) {
    const det = await api.request('GET', `/sales/${sale.id}`, { token: owner });
    ok(det.json.sale.lines[0].image_file === look.json.product.image_file, 'sale detail line has picture');
  }
  // In-store code continues the app counter
  const added = await api.request('POST', '/catalog/products', { token: owner, body: { name: 'New thing', priceRs: 10 } });
  const n = Number(/^20(\d{10})\d$/.exec(added.json.product.barcode)?.[1]);
  ok(n >= seq, `new in-store code continues counter (never reuses lower numbers) ${added.json.product.barcode} (${seq})`);

  // ---- Upload / remove ----
  const jpeg = fs.readFileSync(path.join(root, 'data/seed/kiryana/images/lux-soap-rose-glow-98g.jpg')).toString('base64');
  const pid = added.json.product.id;
  ok((await api.request('POST', `/catalog/products/${pid}/image`, { token: cashier, body: { image: jpeg } })).status === 403, 'cashier upload 403');
  ok((await api.request('POST', `/catalog/products/${pid}/image`, { token: owner, body: { image: 'aGVsbG8=' } })).status === 400, 'non-jpeg 400');
  const up = await api.request('POST', `/catalog/products/${pid}/image`, { token: owner, body: { image: `data:image/jpeg;base64,${jpeg}` } });
  const f1 = up.json?.product?.image_file;
  ok(f1 && fs.existsSync(path.join(imgDir, f1)), 'owner upload');
  const up2 = await api.request('POST', `/catalog/products/${pid}/image`, { token: owner, body: { image: jpeg } });
  const f2 = up2.json.product.image_file;
  ok(f2 !== f1 && !fs.existsSync(path.join(imgDir, f1)), 'change replaces old file');
  const del = await api.request('DELETE', `/catalog/products/${pid}/image`, { token: owner });
  ok(del.json.product.image_file === null && !fs.existsSync(path.join(imgDir, f2)), 'remove picture');

  // ---- Backup v4 ----
  const exp = await api.request('POST', '/backup/export', { token: owner, body: { pin: '2468' } });
  ok(exp.json.header.schema_version >= 8 && exp.json.product_images.length === N, `copy v4 with ${exp.json.product_images?.length} pictures, ${Math.round(exp.raw.length / 1024)} KB`);
  const bundle = exp.json;
  fs.rmSync(imgDir, { recursive: true, force: true });
  const rest = await api.request('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle } });
  ok(rest.json?.ok, `restore v4 ${rest.status} ${rest.raw.slice(0, 200)}`);
  d = new Database(dbPath, { readonly: true });
  const after4 = d.prepare(`SELECT image_file FROM products WHERE image_file IS NOT NULL`).all();
  d.close();
  ok(after4.length === N && after4.every((f) => fs.existsSync(path.join(imgDir, f.image_file))), 'v4 restore brings pictures back');
  const old = JSON.parse(JSON.stringify(bundle));
  old.header.schema_version = 3;
  delete old.product_images;
  for (const p of old.products) delete p.image_file;
  const rest3 = await api.request('POST', '/backup/restore', { token: owner, body: { pin: '2468', bundle: old } });
  ok(rest3.json?.ok, 'v3 copy restores');
  d = new Database(dbPath, { readonly: true });
  ok(d.prepare(`SELECT COUNT(*) n FROM products WHERE image_file IS NOT NULL`).get().n === N, 'v3 restore keeps pictures');
  d.close();
} finally {
  api.stop();
}
console.log(`ALL OK (${c.passed} checks)`);

async function restart() {
  const child = spawn('node', [path.join(root, 'apps/api/dist/main.js')], {
    cwd: path.join(root, 'apps/api'),
    env: { ...process.env, API_PORT: String(PORT), SQLITE_PATH: dbPath, SESSION_SECRET: 'images-secret', TAX_PROCESS_INTERVAL_MS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (x) => process.stderr.write(`[api] ${x}`));
  const http = await import('node:http');
  function request(method, urlPath, { body, token } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : null;
      const headers = {};
      if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
      if (token) headers['x-dd-session'] = token;
      const req = http.request({ hostname: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
        const chunks = [];
        res.on('data', (x) => chunks.push(x));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { /* */ }
          resolve({ status: res.statusCode, json, raw, headers: res.headers });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
  for (let i = 0; i < 240; i++) {
    try { if ((await request('GET', '/health')).status === 200) break; } catch { /* */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  return { request, stop: () => child.kill('SIGTERM') };
}
