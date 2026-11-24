#!/usr/bin/env node
/**
 * Slice 19 smoke: in-store EAN-13 backfill, supplied barcode, duplicate 409,
 * exact lookup, sell adds one piece.
 *
 * Run: node scripts/test-slice19-barcodes.mjs
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));
const Database = require('better-sqlite3');

const API_PORT = Number(process.env.API_PORT ?? 3889);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice19-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function safe(value) {
  return JSON.stringify(value, (k, v) =>
    k === 'sessionToken' || k === 'pin' ? '[redacted]' : v,
  );
}

function ean13CheckDigit(d12) {
  if (!/^\d{12}$/.test(d12)) throw new Error('bad body ' + d12);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += (d12.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

function assertInStore(code, label) {
  assert(/^\d{13}$/.test(code), `${label} not 13 digits: ${code}`);
  assert(code.startsWith('20'), `${label} prefix: ${code}`);
  const expect = ean13CheckDigit(code.slice(0, 12));
  assert(Number(code[12]) === expect, `${label} check digit ${code} expected ${expect}`);
}

// stale-fix: receive now needs a supplier and an amount (defaults for these older checks).
let staleSupplierId = null;
async function request(method, urlPath, opts = {}) {
  if (urlPath === '/stock/receive' && opts.body && typeof opts.body === 'object' && !opts.body.supplierId) {
    if (!staleSupplierId) {
      const sup = await requestRaw('POST', '/suppliers', { token: opts.token, body: { name: 'Stale Test Supplier' } });
      staleSupplierId = sup.json?.supplier?.id ?? null;
    }
    opts = { ...opts, body: { amountRs: 100, supplierId: staleSupplierId, ...opts.body } };
  }
  return requestRaw(method, urlPath, opts);
}

function requestRaw(method, urlPath, { body, token } = {}) {
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
          resolve({ status: res.statusCode, json, raw });
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

console.log('=== DukaanDesk Slice 19 smoke (barcodes) ===');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
assert(
  mig.applied.includes('013_slice19_barcodes.sql') ||
    mig.skipped.includes('013_slice19_barcodes.sql'),
  '013 migration present',
);

const seed = new Database(dbPath);
seed
  .prepare(
    `INSERT INTO products (id, name, unit_label, price_paisa, active)
     VALUES ('legacy-1', 'Legacy Soap', 'piece', 5000, 1)`,
  )
  .run();
seed.close();

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

const apiCwd = path.join(root, 'apps/api');
const child = spawn('node', [path.join(apiCwd, 'dist/main.js')], {
  cwd: apiCwd,
  env: {
    ...process.env,
    API_PORT: String(API_PORT),
    SQLITE_PATH: dbPath,
    SESSION_SECRET: 'slice19-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

try {
  await waitHealth();

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: 'Slice19 Owner', pin: '2468', storeName: 'Slice19 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup ${safe(setup.json)}`);
  const owner = setup.json.sessionToken;

  const listed0 = await request('GET', '/catalog/products', { token: owner });
  assert(listed0.status === 200, 'catalog list');
  const legacy = listed0.json.items.find((p) => p.id === 'legacy-1');
  assert(legacy, 'legacy product listed');
  assertInStore(legacy.barcode, 'legacy backfill');
  assert(legacy.barcode === '2000000000015', `first in-store code ${legacy.barcode}`);
  console.log('backfill EAN-13', legacy.barcode);

  const autoA = await request('POST', '/catalog/products', {
    token: owner,
    body: { name: 'Auto Biscuit', priceRs: 40 },
  });
  assert(autoA.status === 201 && autoA.json?.ok === true, `autoA ${autoA.status} ${safe(autoA.json)}`);
  assertInStore(autoA.json.product.barcode, 'auto A');
  assert(autoA.json.product.barcode !== legacy.barcode, 'auto A unique vs legacy');

  const autoB = await request('POST', '/catalog/products', {
    token: owner,
    body: { name: 'Auto Tea', priceRs: 20, barcode: '   ' },
  });
  assert(autoB.json?.ok === true, `autoB ${safe(autoB.json)}`);
  assertInStore(autoB.json.product.barcode, 'auto B');
  assert(autoB.json.product.barcode !== autoA.json.product.barcode, 'auto B unique vs A');
  console.log('generated', autoA.json.product.barcode, autoB.json.product.barcode);

  const suppliedCode = '5901234123457';
  const supplied = await request('POST', '/catalog/products', {
    token: owner,
    body: { name: 'Maker Oil', priceRs: 80, barcode: `  ${suppliedCode}  ` },
  });
  assert(supplied.json?.ok === true, `supplied ${safe(supplied.json)}`);
  assert(supplied.json.product.barcode === suppliedCode, `trimmed barcode ${supplied.json.product.barcode}`);
  const suppliedId = supplied.json.product.id;
  console.log('supplied barcode saved as given');

  const dup = await request('POST', '/catalog/products', {
    token: owner,
    body: { name: 'Copy Oil', priceRs: 81, barcode: suppliedCode },
  });
  assert(dup.status === 409, `duplicate status ${dup.status} ${safe(dup.json)}`);
  assert(dup.json?.ok === false && dup.json?.error === 'duplicate_barcode', `duplicate body ${safe(dup.json)}`);
  const afterDup = await request('GET', '/catalog/products', { token: owner });
  const oilRows = afterDup.json.items.filter((p) => p.barcode === suppliedCode);
  assert(oilRows.length === 1 && oilRows[0].id === suppliedId, 'duplicate did not overwrite or insert');
  const autoStill = afterDup.json.items.find((p) => p.id === autoA.json.product.id);
  assert(autoStill.barcode === autoA.json.product.barcode, 'other product barcode unchanged');
  console.log('duplicate barcode 409');

  const clash = await request('PATCH', `/catalog/products/${autoA.json.product.id}`, {
    token: owner,
    body: { barcode: suppliedCode },
  });
  assert(clash.status === 409 && clash.json?.error === 'duplicate_barcode', `patch dup ${clash.status} ${safe(clash.json)}`);
  const afterClash = await request('GET', '/catalog/products', { token: owner });
  const autoAfter = afterClash.json.items.find((p) => p.id === autoA.json.product.id);
  assert(autoAfter.barcode === autoA.json.product.barcode, 'rejected edit kept original barcode');

  const lookup = await request(
    'GET',
    `/catalog/lookup?barcode=${encodeURIComponent(suppliedCode)}`,
    { token: owner },
  );
  assert(lookup.status === 200 && lookup.json?.ok === true, `lookup ${lookup.status} ${safe(lookup.json)}`);
  assert(lookup.json.product.id === suppliedId, 'lookup id');
  assert(lookup.json.product.barcode === suppliedCode, 'lookup barcode');

  const missing = await request('GET', '/catalog/lookup?barcode=0000000000000', { token: owner });
  assert(missing.status === 404, `unknown barcode ${missing.status}`);
  assert(missing.json?.error === 'barcode_not_found', `unknown body ${safe(missing.json)}`);
  console.log('lookup exact + unknown 404');

  const recv = await request('POST', '/stock/receive', {
    token: owner,
    body: { productId: suppliedId, pieces: 5, unit: 'piece', amountRs: 50 },
  });
  assert(recv.json?.ok === true, `receive ${safe(recv.json)}`);

  const sale = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'cash',
      lines: [{ productId: lookup.json.product.id, qty: 1, unit: 'piece' }],
    },
  });
  assert(sale.status === 201 && sale.json?.ok === true, `sale ${sale.status} ${safe(sale.json)}`);
  assert(sale.json.sale.lines[0].qty === 1 || sale.json.sale.lines[0].qtyPieces === 1, `qty ${safe(sale.json.sale.lines[0])}`);
  assert(sale.json.sale.lines[0].unit === 'piece', 'sold one piece');

  const afterSale = await request('GET', '/catalog/products', { token: owner });
  const sold = afterSale.json.items.find((p) => p.id === suppliedId);
  assert(sold.qty_on_hand === 4, `stock after one piece ${sold.qty_on_hand}`);
  console.log('sell lookup added one piece, stock 5 → 4');

  const sample = await request('POST', '/catalog/sample', { token: owner });
  assert(sample.json?.ok === true, `sample ${safe(sample.json)}`);
  assertInStore(sample.json.product.barcode, 'sample');
  const codes = new Set(afterSale.json.items.map((p) => p.barcode));
  assert(!codes.has(sample.json.product.barcode), 'sample barcode unique');
  console.log('sample barcode', sample.json.product.barcode);

  console.log('SLICE19 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE19 SMOKE FAIL', err);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  setTimeout(() => {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      for (const suffix of ['-wal', '-shm']) {
        const p = dbPath + suffix;
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch {
      /* ignore */
    }
    process.exit(process.exitCode ?? 0);
  }, 800);
}
