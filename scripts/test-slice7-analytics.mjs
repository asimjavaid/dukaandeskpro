#!/usr/bin/env node
/**
 * Slice 7 smoke: seed cash + udhaar sales → analytics totals match;
 * low-stock flag when qty ≤ 5.
 *
 * Run:  node scripts/test-slice7-analytics.mjs
 * Or:   pnpm test:slice7
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
import { randomBytes, scryptSync, randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));
const Database = require('better-sqlite3');

const API_PORT = Number(process.env.API_PORT ?? 3857);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice7-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(pin, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
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

console.log('=== DukaanDesk Slice 7 smoke (Owner analytics) ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
console.log('migrations:', mig);
assert(
  mig.applied.includes('008_slice7_analytics.sql') ||
    mig.skipped.includes('008_slice7_analytics.sql'),
  '008_slice7_analytics present',
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
    SESSION_SECRET: 'slice7-smoke-secret',
    TAX_MODE: 'simulate',
    TAX_PROCESS_INTERVAL_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '2468';
const CASHIER_PIN = '8642';
const DISPLAY = 'Slice7 Owner';
const PRODUCT_A = 'Slice7 Atta 5kg';
const PRODUCT_B = 'Slice7 Sugar 1kg';
const CLIENT_AT = '2026-10-01T11:55:00.000+05:00';

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: PIN, storeName: 'Slice7 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;
  assert(token, 'sessionToken');
  console.log('setup ok');

  // Product A: price 100 Rs, receive 20 → sell 3 cash + 2 udhaar
  const createdA = await request('POST', '/catalog/products', {
    token,
    body: {
      name: PRODUCT_A,
      priceRs: 100,
      unit: 'piece',
      piecesPerCarton: 1,
    },
  });
  assert(createdA.json?.ok === true, `create A: ${JSON.stringify(createdA.json)}`);
  const productA = createdA.json.product.id;

  // Product B: price 50 Rs, receive 4 → qty ≤ 5 low-stock after receive
  const createdB = await request('POST', '/catalog/products', {
    token,
    body: {
      name: PRODUCT_B,
      priceRs: 50,
      unit: 'piece',
      piecesPerCarton: 1,
    },
  });
  assert(createdB.json?.ok === true, `create B: ${JSON.stringify(createdB.json)}`);
  const productB = createdB.json.product.id;

  const recvA = await request('POST', '/stock/receive', {
    token,
    body: { productId: productA, qty: 20, unit: 'piece' },
  });
  assert(recvA.json?.ok === true, `receive A: ${JSON.stringify(recvA.json)}`);

  const recvB = await request('POST', '/stock/receive', {
    token,
    body: { productId: productB, qty: 4, unit: 'piece' },
  });
  assert(recvB.json?.ok === true, `receive B: ${JSON.stringify(recvB.json)}`);

  const party = await request('POST', '/parties', {
    token,
    body: { name: 'Slice7 Party Ali' },
  });
  assert(party.json?.ok === true, `party: ${JSON.stringify(party.json)}`);
  const partyId = party.json.party.id;

  // Cash sale: 3 × 100 Rs = 30000 paisa
  const cashSale = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId: productA, qty: 3, unit: 'piece' }],
    },
  });
  assert(
    cashSale.status === 201 && cashSale.json?.ok === true,
    `cash sale: ${cashSale.status} ${JSON.stringify(cashSale.json)}`,
  );
  assert(cashSale.json.sale.totalPaisa === 30000, 'cash total 30000 paisa');

  // Udhaar sale: 2 × 100 Rs = 20000 paisa
  const udhaarSale = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'udhaar',
      partyId,
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId: productA, qty: 2, unit: 'piece' }],
    },
  });
  assert(
    udhaarSale.status === 201 && udhaarSale.json?.ok === true,
    `udhaar sale: ${udhaarSale.status} ${JSON.stringify(udhaarSale.json)}`,
  );
  assert(udhaarSale.json.sale.totalPaisa === 20000, 'udhaar total 20000 paisa');

  console.log('seeded cash + udhaar sales');

  const analytics = await request('GET', '/analytics', { token });
  assert(analytics.status === 200, `analytics status ${analytics.status}: ${analytics.raw?.slice(0, 200)}`);
  const a = analytics.json;
  assert(a?.timezone === 'Asia/Karachi', `timezone: ${a?.timezone}`);
  assert(a.low_stock_threshold === 5, 'default threshold 5');

  // Today totals
  assert(a.today.sale_count === 2, `today sale_count=${a.today.sale_count}`);
  assert(a.today.total_paisa === 50000, `today total=${a.today.total_paisa}`);
  assert(a.today.cash_paisa === 30000, `today cash=${a.today.cash_paisa}`);
  assert(a.today.udhaar_paisa === 20000, `today udhaar=${a.today.udhaar_paisa}`);

  // Last 7 days includes today
  assert(a.last_7_days.sale_count === 2, `7d sale_count=${a.last_7_days.sale_count}`);
  assert(a.last_7_days.total_paisa === 50000, `7d total=${a.last_7_days.total_paisa}`);
  assert(a.last_7_days.cash_paisa === 30000, `7d cash=${a.last_7_days.cash_paisa}`);
  assert(a.last_7_days.udhaar_paisa === 20000, `7d udhaar=${a.last_7_days.udhaar_paisa}`);

  // Top products by revenue
  const top = a.today.top_products ?? [];
  assert(top.length >= 1, 'top products present');
  assert(
    top.some(
      (p) =>
        p.product_id === productA &&
        p.qty_pieces === 5 &&
        p.revenue_paisa === 50000,
    ),
    `top product A: ${JSON.stringify(top)}`,
  );

  // Udhaar outstanding = party balance 20000
  assert(
    a.udhaar_outstanding_paisa === 20000,
    `udhaar outstanding=${a.udhaar_outstanding_paisa}`,
  );

  // Low stock: B has 4 ≤ 5; A has 15 (20-5) so not low
  const low = a.low_stock ?? [];
  assert(
    low.some((x) => x.product_id === productB && x.qty_on_hand === 4),
    `low stock B: ${JSON.stringify(low)}`,
  );
  assert(
    !low.some((x) => x.product_id === productA),
    `A should not be low: ${JSON.stringify(low)}`,
  );
  console.log('analytics totals match; low-stock flagged for qty≤5');

  // Cashier denied
  const cashDb = new Database(dbPath);
  const cashierId = randomUUID();
  cashDb
    .prepare(
      `INSERT INTO users (id, role_id, display_name, pin_hash)
       VALUES (?, 'role-cashier', ?, ?)`,
    )
    .run(cashierId, 'Slice7 Cashier', hashPin(CASHIER_PIN));
  cashDb.close();

  const cashLogin = await request('POST', '/auth/login', {
    body: { userId: cashierId, pin: CASHIER_PIN },
  });
  assert(
    cashLogin.json?.ok === true,
    `cashier login: ${JSON.stringify(cashLogin.json)}`,
  );
  const cashToken = cashLogin.json.sessionToken;
  const denied = await request('GET', '/analytics', { token: cashToken });
  assert(
    denied.status === 403,
    `cashier analytics → 403, got ${denied.status} ${denied.raw?.slice(0, 200)}`,
  );
  console.log('cashier denied 403');

  console.log('SLICE7 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE7 SMOKE FAIL', err);
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
