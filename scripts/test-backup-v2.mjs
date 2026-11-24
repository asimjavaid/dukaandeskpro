#!/usr/bin/env node
/**
 * Backup v2 smoke: copies carry suppliers, purchases, supplier payments,
 * stock receives, expenses and printer settings; restore brings them all back;
 * an old v1 copy restores without touching purchases / suppliers / expenses;
 * "last saved" is only recorded after POST /backup/saved.
 *
 * Run:  node scripts/test-backup-v2.mjs   (or pnpm test:backup-v2)
 * Uses a fresh temp SQLite file so it does not touch the default DB.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, scryptSync, randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));
const Database = require('better-sqlite3');

const API_PORT = Number(process.env.API_PORT ?? 3871);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-backup-v2-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(pin, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

function request(method, urlPath, { body, token, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers['x-dd-session'] = token;
    }
    if (cookie) headers.Cookie = cookie;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: API_PORT,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({
            status: res.statusCode,
            json,
            raw,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitHealth(ms = 60000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await request('GET', '/health');
      if (r.status === 200 && r.json?.status === 'ok') return r.json;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('health timeout');
}


const TABLES = [
  'products',
  'stock_balances',
  'suppliers',
  'supplier_payments',
  'purchase_invoices',
  'purchase_lines',
  'stock_receives',
  'expenses',
  'parties',
  'party_ledger',
  'sales',
  'sale_lines',
  'stock_count_sessions',
  'stock_count_lines',
  'stock_adjustments',
];
const PURCHASE_GROUP = [
  'suppliers',
  'supplier_payments',
  'purchase_invoices',
  'purchase_lines',
  'stock_receives',
  'expenses',
];
const PRINTER_COLS = `receipt_printer_name, receipt_width_mm, receipt_print_enabled,
  reports_printer_name, reports_paper, label_printer_name, label_size, label_per_row`;

function keyOf(table) {
  return table === 'stock_balances' ? 'product_id' : 'id';
}

function snapshot(tables = TABLES) {
  const db = new Database(dbPath, { readonly: true });
  const out = {};
  for (const t of tables) {
    out[t] = db.prepare(`SELECT * FROM ${t} ORDER BY ${keyOf(t)}`).all();
    // buy_measure is derived (filled from buy_unit by restore/startup since migration 043); not part of the copy contract.
    if (t === 'products') for (const r of out[t]) delete r.buy_measure;
  }
  out.printers = db.prepare(`SELECT ${PRINTER_COLS} FROM store`).get();
  db.close();
  return out;
}

function same(a, b, label) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) {
    let i = 0;
    while (i < ja.length && ja[i] === jb[i]) i++;
    throw new Error(`${label} differs at ${i}\n  want …${jb.slice(Math.max(0, i - 200), i + 200)}\n  got  …${ja.slice(Math.max(0, i - 200), i + 200)}`);
  }
}

function nestCode(json) {
  return json?.code ?? json?.message?.code ?? json?.message ?? '';
}

console.log('=== DukaanDesk backup v2 smoke ===');
console.log('migrate →', dbPath);
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
}
migrate(dbPath);

const apiCwd = path.join(root, 'apps/api');
const distMain = path.join(apiCwd, 'dist/main.js');
if (!process.env.SKIP_API_BUILD) {
  console.log('building API…');
  const build = spawn('pnpm', ['--filter', '@dukaandeskpro/api', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  await new Promise((resolve, reject) => {
    build.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`build exit ${code}`)),
    );
  });
}

const child = spawn('node', [distMain], {
  cwd: apiCwd,
  env: {
    ...process.env,
    API_PORT: String(API_PORT),
    SQLITE_PATH: dbPath,
    SESSION_SECRET: 'backup-v2-smoke-secret',
    TAX_MODE: 'simulate',
    TAX_PROCESS_INTERVAL_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '2468';
const CLIENT_AT = '2026-10-05T21:10:00.000+05:00';

try {
  await waitHealth();
  const setup = await request('POST', '/auth/setup', {
    body: { displayName: 'V2 Owner', pin: PIN, storeName: 'V2 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;
  const ok = (r, label) => {
    assert(
      (r.status === 200 || r.status === 201) && r.json?.ok !== false,
      `${label}: ${r.status} ${r.raw?.slice(0, 300)}`,
    );
    return r.json;
  };
  const post = (p, body) => request('POST', p, { token, body });

  // ---- Seed: products, supplier, purchase, payment, expenses, sale ----
  const pA = ok(await post('/catalog/products', { name: 'Chai 250g', priceRs: 80, unit: 'piece', piecesPerCarton: 1 }), 'product A').product.id;
  const pB = ok(await post('/catalog/products', { name: 'Sugar 1kg', priceRs: 160, unit: 'piece', piecesPerCarton: 1 }), 'product B').product.id;
  const supA = ok(await post('/suppliers', { name: 'Ali Traders', phone: '03001234567', contact_name: 'Ali', address: 'Main Bazaar' }), 'supplier').supplier.id;
  ok(await post('/stock/receive', { productId: pB, qty: 4, unit: 'piece', amountRs: 560, supplierId: supA, paidNow: true }), 'receive B');
  const inv1 = ok(
    await post('/purchases', {
      supplierId: supA,
      lines: [
        { productId: pA, mode: 'loose', pieces: 12, unitCostRs: 60 },
        { productId: pB, mode: 'loose', pieces: 6, unitCostRs: 140 },
      ],
      discountRs: 20,
      paidRs: 500,
      purchasedOn: '2026-10-03',
      note: 'first bill',
    }),
    'purchase 1',
  ).invoice.id;
  ok(await post(`/suppliers/${supA}/payments`, { amountRs: 300, paidOn: '2026-10-04', note: 'cash' }), 'supplier payment');
  const exp1 = ok(await post('/expenses', { kind: 'bill', amountRs: 1500, date: '2026-10-02', note: 'electric' }), 'expense 1').expense.id;
  ok(await post('/expenses', { kind: 'salary', amountRs: 20000, date: '2026-10-01', note: 'helper' }), 'expense 2');
  ok(await post('/sales', { paymentMethod: 'cash', clientDeviceAt: CLIENT_AT, lines: [{ productId: pA, qty: 2, unit: 'piece' }] }), 'sale');
  const party = ok(await post('/parties', { name: 'Usman', phone: '03111111111' }), 'party').party.id;
  ok(await post('/sales', { paymentMethod: 'udhaar', partyId: party, clientDeviceAt: CLIENT_AT, lines: [{ productId: pB, qty: 1, unit: 'piece' }] }), 'udhaar sale');
  ok(await post('/stock/counts/quick', { productId: pB, countedQty: 7, reasonCode: 'damaged' }), 'quick count');

  const set = new Database(dbPath);
  set.prepare(`UPDATE store SET receipt_printer_name = 'XP-58', receipt_width_mm = 58, label_size = '40x30', label_per_row = 2`).run();
  set.close();

  const atCopy = snapshot();
  assert(atCopy.purchase_invoices.length === 1, 'seed invoice');
  assert(atCopy.purchase_lines.length === 2, 'seed purchase lines');
  assert(atCopy.stock_receives.length === 3, `seed receives ${atCopy.stock_receives.length}`);
  assert(atCopy.supplier_payments.length === 1, 'seed payment');
  assert(atCopy.expenses.length === 2, 'seed expenses');
  console.log('seeded', Object.fromEntries(TABLES.map((t) => [t, atCopy[t].length])));

  // ---- Save a copy (v2) — last saved only after confirm ----
  const exp = await post('/backup/export', { pin: PIN });
  assert(exp.status === 200 || exp.status === 201, `export ${exp.status}`);
  const bundle = exp.json;
  assert(bundle.header.schema_version === 16, 'v5 header');
  for (const k of PURCHASE_GROUP) {
    assert(bundle[k].length === atCopy[k].length, `copy ${k} ${bundle[k].length}`);
  }
  assert(bundle.store.receipt_printer_name === 'XP-58', 'copy has printer');
  assert((await request('GET', '/backup', { token })).json.last_export_at == null, 'not saved yet');
  ok(await post('/backup/saved', { copy_id: exp.headers['x-backup-copy-id'] }), 'confirm saved');
  assert((await request('GET', '/backup', { token })).json.last_export_at, 'last saved set');
  console.log('copy v2 OK; last saved recorded after confirm');

  // ---- Change data after the copy ----
  const pC = ok(await post('/catalog/products', { name: 'Rice 5kg', priceRs: 1200, unit: 'piece', piecesPerCarton: 1 }), 'product C').product.id;
  const supB = ok(await post('/suppliers', { name: 'Bilal Wholesale' }), 'supplier B').supplier.id;
  ok(await post('/purchases', { supplierId: supB, lines: [{ productId: pC, mode: 'loose', pieces: 3, unitCostRs: 1000 }], paidRs: 3000, purchasedOn: '2026-10-07' }), 'purchase 2');
  ok(await post('/purchases', { supplierId: supA, lines: [{ productId: pA, mode: 'loose', pieces: 24, unitCostRs: 62 }], paidRs: 0, purchasedOn: '2026-10-07' }), 'purchase 3');
  const del = await request('DELETE', `/expenses/${exp1}`, { token });
  assert(del.status === 200, `delete expense ${del.status}`);
  ok(await post('/expenses', { kind: 'commission', amountRs: 700, date: '2026-10-07' }), 'expense 3');
  ok(await post('/sales', { paymentMethod: 'cash', clientDeviceAt: CLIENT_AT, lines: [{ productId: pC, qty: 1, unit: 'piece' }] }), 'sale 2');
  const mut = new Database(dbPath);
  mut.prepare(`UPDATE suppliers SET name = 'Ali Traders (renamed)' WHERE id = ?`).run(supA);
  mut.prepare(`UPDATE store SET receipt_printer_name = 'Other', receipt_width_mm = 80`).run();
  mut.close();
  const changed = snapshot();
  assert(changed.purchase_invoices.length === 3, 'changed invoices');

  // ---- Bad copies are refused and change nothing ----
  const v3 = await post('/backup/restore', { pin: PIN, bundle: { ...bundle, header: { ...bundle.header, schema_version: 999 } } }); // newer than this app supports
  assert(v3.status === 400 && String(nestCode(v3.json)).includes('schema'), `future schema refused ${v3.status}`);
  const noLines = { ...bundle };
  delete noLines.purchase_lines;
  const r1 = await post('/backup/restore', { pin: PIN, bundle: noLines });
  assert(r1.status === 400 && nestCode(r1.json) === 'invalid_backup_bundle', `v2 missing table refused ${r1.status}`);
  const broken = { ...bundle, purchase_lines: [{ ...bundle.purchase_lines[0], id: 'ghost-line', product_id: 'no-such-product' }] };
  const r2 = await post('/backup/restore', { pin: PIN, bundle: broken });
  assert(r2.status === 400 && nestCode(r2.json) === 'restore_failed', `broken copy → restore_failed, got ${r2.status} ${r2.raw}`);
  same(snapshot(), changed, 'DB after refused restores');
  console.log('bad copies refused; data unchanged');

  // ---- Restore v2: everything back exactly as in the copy ----
  const rv2 = await post('/backup/restore', { pin: PIN, bundle });
  ok(rv2, 'restore v2');
  assert(rv2.json.kept.length === 0, `v2 keeps nothing as-is: ${rv2.json.kept}`);
  const afterV2 = snapshot();
  for (const t of TABLES) same(afterV2[t], atCopy[t], `v2 restore ${t}`);
  same(afterV2.printers, atCopy.printers, 'v2 restore printers');
  const users = new Database(dbPath, { readonly: true });
  const owner = users.prepare(`SELECT pin_hash FROM users`).all();
  users.close();
  assert(owner.length === 1 && owner[0].pin_hash, 'staff / PIN kept');
  console.log('restore v2 OK — all', TABLES.length, 'tables + printer settings match the copy');

  // ---- Old v1 copy: purchases / suppliers / expenses left as they are ----
  const v1 = JSON.parse(JSON.stringify(bundle));
  v1.header.schema_version = 1;
  for (const k of PURCHASE_GROUP) delete v1[k];
  for (const k of ['receipt_printer_name', 'receipt_width_mm', 'receipt_print_enabled', 'reports_printer_name', 'reports_paper', 'label_printer_name', 'label_size', 'label_per_row']) delete v1.store[k];
  // New purchase for a product the old copy does not know, plus other changes.
  const pD = ok(await post('/catalog/products', { name: 'Daal 1kg', priceRs: 300, unit: 'piece', piecesPerCarton: 1 }), 'product D').product.id;
  ok(await post('/purchases', { supplierId: supplierFromCopy(), lines: [{ productId: pD, mode: 'loose', pieces: 10, unitCostRs: 250 }], paidRs: 1000, purchasedOn: '2026-10-08' }), 'purchase 4');
  ok(await post('/expenses', { kind: 'bill', amountRs: 900, date: '2026-10-08', note: 'gas' }), 'expense 4');
  ok(await post('/sales', { paymentMethod: 'cash', clientDeviceAt: CLIENT_AT, lines: [{ productId: pB, qty: 1, unit: 'piece' }] }), 'sale 3');
  const pr = new Database(dbPath);
  pr.prepare(`UPDATE store SET receipt_printer_name = 'Counter-80', receipt_width_mm = 80`).run();
  pr.close();
  const beforeV1 = snapshot();

  const rv1 = await post('/backup/restore', { pin: PIN, bundle: v1 });
  ok(rv1, 'restore v1');
  assert(rv1.json.kept.includes('purchases') && rv1.json.kept.includes('expenses'), `v1 kept ${rv1.json.kept}`);
  const afterV1 = snapshot();
  for (const t of PURCHASE_GROUP) same(afterV1[t], beforeV1[t], `v1 restore leaves ${t}`);
  same(afterV1.printers, beforeV1.printers, 'v1 restore leaves printer settings');
  for (const t of ['parties', 'party_ledger', 'sales', 'sale_lines']) same(afterV1[t], atCopy[t], `v1 restore ${t}`);
  const ids = afterV1.products.map((p) => p.id);
  assert(ids.includes(pA) && ids.includes(pB), 'copy products back');
  assert(ids.includes(pD), 'product used by a kept purchase is kept');
  assert(afterV1.stock_balances.some((s) => s.product_id === pD && s.qty_on_hand === 10), 'kept product keeps its stock');
  assert(!ids.includes(pC) || afterV1.purchase_lines.some((l) => l.product_id === pC), 'unrelated new product removed');
  console.log('restore v1 OK — purchase bills, suppliers, expenses, printers untouched');

  console.log('BACKUP V2 SMOKE OK');
  process.exitCode = 0;

  function supplierFromCopy() {
    return afterV2.suppliers.find((s) => s.name === 'Ali Traders').id;
  }
} catch (err) {
  console.error('BACKUP V2 SMOKE FAIL', err);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  setTimeout(() => {
    try {
      for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
      }
    } catch {
      /* ignore */
    }
    process.exit(process.exitCode ?? 0);
  }, 800);
}
