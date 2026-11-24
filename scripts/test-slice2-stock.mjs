#!/usr/bin/env node
/**
 * Slice 2 smoke: create product → receive 10 → list shows 10 → receive 2 → 12
 *
 * Run:  node scripts/test-slice2-stock.mjs
 * Or:   pnpm test:slice2
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

const API_PORT = Number(process.env.API_PORT ?? 3852);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice2-${Date.now()}.sqlite`);

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

console.log('=== DukaanDesk Slice 2 smoke (stock) ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
console.log('migrations:', mig);
assert(
  mig.applied.includes('003_slice2_stock.sql') ||
    mig.skipped.includes('003_slice2_stock.sql'),
  '003_slice2_stock present',
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
    SESSION_SECRET: 'slice2-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '1357';
const DISPLAY = 'Slice2 Owner';
const PRODUCT = 'Slice2 Biscuits';

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: PIN, storeName: 'Slice2 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;
  assert(token, 'sessionToken');
  console.log('setup ok');

  const created = await request('POST', '/catalog/products', {
    token,
    body: {
      name: PRODUCT,
      priceRs: 25,
      unit: 'piece',
      piecesPerCarton: 12,
    },
  });
  assert(created.json?.ok === true, `create: ${JSON.stringify(created.json)}`);
  const productId = created.json.product.id;
  // Current behaviour: no carton sell mode, pieces_per_carton is always 1 (cartons removed 13 Oct 2026).
  assert(created.json.product.pieces_per_carton === 1, 'pieces_per_carton fixed at 1');
  assert(created.json.product.qty_on_hand === 0, 'initial qty 0');
  console.log('product created; qty_on_hand=0');

  const recv1 = await request('POST', '/stock/receive', {
    token,
    body: { productId, qty: 10, unit: 'piece' },
  });
  assert(recv1.json?.ok === true, `receive10: ${JSON.stringify(recv1.json)}`);
  assert(recv1.json.receive.qtyPieces === 10, 'recv1 qtyPieces 10');
  assert(recv1.json.balance.qtyOnHand === 10, 'balance after +10 = 10');
  console.log('receive 10 pieces → 10');

  const listed = await request('GET', '/catalog/products', { token });
  assert(listed.status === 200, 'catalog list http');
  const row = listed.json.items.find((p) => p.id === productId);
  assert(row, 'product in catalog');
  assert(row.qty_on_hand === 10, `catalog shows 10, got ${row.qty_on_hand}`);
  console.log('catalog list shows qty_on_hand=10');

  const stockList = await request('GET', '/stock', { token });
  assert(stockList.status === 200, 'GET /stock http');
  const bal = stockList.json.items.find((b) => b.product_id === productId);
  assert(bal?.qty_on_hand === 10, 'GET /stock shows 10');
  console.log('GET /stock shows 10');

  const recv2 = await request('POST', '/stock/receive', {
    token,
    body: { productId, qty: 2, unit: 'piece' },
  });
  assert(recv2.json?.ok === true, `receive2: ${JSON.stringify(recv2.json)}`);
  assert(recv2.json.balance.qtyOnHand === 12, 'balance after +2 = 12');
  console.log('receive 2 more → 12');

  const listed2 = await request('GET', '/catalog/products', { token });
  const row2 = listed2.json.items.find((p) => p.id === productId);
  assert(row2?.qty_on_hand === 12, `catalog shows 12, got ${row2?.qty_on_hand}`);
  console.log('catalog list shows qty_on_hand=12');

  // Carton receive: qty = total pieces inside the carton (12) → 24
  const recvCarton = await request('POST', '/stock/receive', {
    token,
    body: { productId, qty: 12, unit: 'carton' },
  });
  assert(
    recvCarton.json?.ok === true,
    `receive carton: ${JSON.stringify(recvCarton.json)}`,
  );
  assert(recvCarton.json.receive.qtyPieces === 12, 'carton of 12 pieces → 12');
  assert(recvCarton.json.balance.qtyOnHand === 24, 'balance 24 after carton');
  console.log('receive 1 carton (×12) → 24');

  // Owner gate: unauthenticated receive rejected
  const unauth = await request('POST', '/stock/receive', {
    body: { productId, qty: 1, unit: 'piece' },
  });
  assert(unauth.status === 401, 'receive requires session');

  console.log('SLICE2 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE2 SMOKE FAIL', err);
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
