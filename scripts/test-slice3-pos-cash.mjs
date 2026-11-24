#!/usr/bin/env node
/**
 * Slice 3 smoke: receive stock → sell cash OK → stock −;
 * sell over qty → refused (409); stock unchanged.
 *
 * Run:  node scripts/test-slice3-pos-cash.mjs
 * Or:   pnpm test:slice3
 *
 * Uses a fresh temp SQLite file so it does not touch the default DB.
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

const API_PORT = Number(process.env.API_PORT ?? 3853);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice3-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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

function requestRaw(method, urlPath, { body, token, cookie } = {}) {
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

function qtyOnHand(catalogJson, productId) {
  const row = catalogJson.items.find((p) => p.id === productId);
  return row?.qty_on_hand;
}

console.log('=== DukaanDesk Slice 3 smoke (POS cash) ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
console.log('migrations:', mig);
assert(
  mig.applied.includes('004_slice3_sales.sql') ||
    mig.skipped.includes('004_slice3_sales.sql'),
  '004_slice3_sales present',
);

const apiCwd = path.join(root, 'apps/api');
const distMain = path.join(apiCwd, 'dist/main.js');

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

const child = spawn('node', [distMain], {
  cwd: apiCwd,
  env: {
    ...process.env,
    API_PORT: String(API_PORT),
    SQLITE_PATH: dbPath,
    SESSION_SECRET: 'slice3-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '2468';
const DISPLAY = 'Slice3 Owner';
const PRODUCT = 'Slice3 Chai Pack';
const CLIENT_AT = '2026-10-01T06:30:00.000+05:00';

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: PIN, storeName: 'Slice3 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;
  assert(token, 'sessionToken');
  console.log('setup ok (Owner can sell without cashier)');

  const created = await request('POST', '/catalog/products', {
    token,
    body: {
      name: PRODUCT,
      priceRs: 50,
      unit: 'piece',
      piecesPerCarton: 10,
    },
  });
  assert(created.json?.ok === true, `create: ${JSON.stringify(created.json)}`);
  const productId = created.json.product.id;
  console.log('product created');

  const recv = await request('POST', '/stock/receive', {
    token,
    body: { productId, qty: 10, unit: 'piece' },
  });
  assert(recv.json?.ok === true, `receive: ${JSON.stringify(recv.json)}`);
  assert(recv.json.balance.qtyOnHand === 10, 'on hand 10 after receive');
  console.log('receive 10 pieces → 10');

  // --- Sell OK: 3 pieces cash ---
  const saleOk = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 3, unit: 'piece' }],
    },
  });
  assert(
    saleOk.status === 201 && saleOk.json?.ok === true,
    `sale ok: ${saleOk.status} ${JSON.stringify(saleOk.json)}`,
  );
  const sale = saleOk.json.sale;
  assert(sale.shortId && String(sale.shortId).length >= 6, 'shortId');
  assert(sale.totalPaisa === 3 * 50 * 100, `total ${sale.totalPaisa}`);
  assert(sale.paymentMethod === 'cash', 'cash only');
  assert(sale.clientDeviceAt, 'client_device_at');
  assert(sale.recordedAt, 'recorded_at');
  // Dual timestamps: client from body (normalized ISO) ≠ necessarily equal recorded
  const clientMs = Date.parse(sale.clientDeviceAt);
  const recordedMs = Date.parse(sale.recordedAt);
  assert(!Number.isNaN(clientMs), 'clientDeviceAt parseable');
  assert(!Number.isNaN(recordedMs), 'recordedAt parseable');
  assert(
    Math.abs(clientMs - Date.parse(CLIENT_AT)) < 1000,
    'client_device_at preserved from client',
  );
  console.log(
    `sale OK shortId=${sale.shortId} totalPaisa=${sale.totalPaisa}`,
  );
  console.log(
    `timestamps client=${sale.clientDeviceAt} recorded=${sale.recordedAt}`,
  );

  const afterSale = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(afterSale.json, productId) === 7, 'stock 10−3=7');
  console.log('stock after sale → 7');

  // --- Oversell: 10 pieces wanted, only 7 left → refuse (Sell is pieces only) ---
  const oversell = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: new Date().toISOString(),
      lines: [{ productId, qty: 10, unit: 'piece' }],
    },
  });
  assert(
    oversell.status === 409,
    `oversell should be 409, got ${oversell.status} ${JSON.stringify(oversell.json)}`,
  );
  const overBody = oversell.json;
  const nested =
    overBody && typeof overBody.message === 'object' ? overBody.message : overBody;
  const errCode = nested?.error ?? overBody?.error;
  assert(
    errCode === 'insufficient_stock',
    `error insufficient_stock, got ${JSON.stringify(oversell.json)}`,
  );
  console.log('oversell refused with 409');

  const afterRefuse = await request('GET', '/catalog/products', { token });
  assert(
    qtyOnHand(afterRefuse.json, productId) === 7,
    `stock unchanged after refuse, got ${qtyOnHand(afterRefuse.json, productId)}`,
  );
  console.log('stock unchanged at 7 after refuse');

  // --- Piece oversell also refused ---
  const overPieces = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: new Date().toISOString(),
      lines: [{ productId, qty: 8, unit: 'piece' }],
    },
  });
  assert(overPieces.status === 409, 'piece oversell 409');
  const after2 = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(after2.json, productId) === 7, 'still 7');
  console.log('piece oversell refused; stock still 7');

  // --- Sell remaining 7 OK ---
  const clear = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: new Date().toISOString(),
      lines: [{ productId, qty: 7, unit: 'piece' }],
    },
  });
  assert(clear.json?.ok === true, `clear sale: ${JSON.stringify(clear.json)}`);
  const zero = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(zero.json, productId) === 0, 'stock 0');
  console.log('sold remaining 7 → 0');

  // Unauthenticated sale rejected
  const unauth = await request('POST', '/sales', {
    body: {
      paymentMethod: 'cash',
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(unauth.status === 401, 'sale requires session');

  console.log('SLICE3 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE3 SMOKE FAIL', err);
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
