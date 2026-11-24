#!/usr/bin/env node
/**
 * Slice 8 smoke: create cashier → pin_once once; list never returns PIN;
 * cashier login → Sell OK; owner routes 403; deactivate → login fails.
 *
 * Run:  node scripts/test-slice8-staff.mjs
 * Or:   pnpm test:slice8
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
const Database = require('better-sqlite3');

const API_PORT = Number(process.env.API_PORT ?? 3858);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice8-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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

function assertNoPinFields(obj, label) {
  const s = JSON.stringify(obj);
  assert(!s.includes('pin_hash'), `${label}: must not contain pin_hash`);
  if (Array.isArray(obj)) {
    for (const u of obj) {
      assert(!('pin_hash' in (u ?? {})), `${label}: user has pin_hash`);
      assert(!('pin' in (u ?? {})), `${label}: user has pin`);
      assert(!('pin_once' in (u ?? {})), `${label}: user has pin_once`);
    }
  }
}

console.log('=== DukaanDesk Slice 8 smoke (Owner Staff) ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
console.log('migrations:', mig);
assert(
  mig.applied.includes('009_slice8_staff.sql') ||
    mig.skipped.includes('009_slice8_staff.sql'),
  '009_slice8_staff present',
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
    SESSION_SECRET: 'slice8-smoke-secret',
    TAX_MODE: 'simulate',
    TAX_PROCESS_INTERVAL_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const OWNER_PIN = '2468';
const CASHIER_PIN = '5678';
const DISPLAY = 'Slice8 Owner';
const CASHIER_NAME = 'Ali Cashier';
const PRODUCT = 'Slice8 Atta 5kg';
const CLIENT_AT = '2026-10-01T11:58:00.000+05:00';

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: OWNER_PIN, storeName: 'Slice8 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const ownerToken = setup.json.sessionToken;
  assert(ownerToken, 'owner sessionToken');
  console.log('setup ok');

  // List staff — owner only, no PIN fields
  const listBefore = await request('GET', '/owner/staff', { token: ownerToken });
  assert(listBefore.status === 200, `list status ${listBefore.status}`);
  assert(listBefore.json?.ok === true, 'list ok');
  assert(Array.isArray(listBefore.json.users), 'users array');
  assertNoPinFields(listBefore.json.users, 'list before');
  assert(
    listBefore.json.users.some((u) => u.role === 'owner'),
    'owner in list',
  );

  // Create cashier
  const created = await request('POST', '/owner/staff/cashiers', {
    token: ownerToken,
    body: { displayName: CASHIER_NAME, pin: CASHIER_PIN },
  });
  assert(
    created.status === 201 || created.status === 200,
    `create status ${created.status} ${created.raw?.slice(0, 200)}`,
  );
  assert(created.json?.ok === true, `create: ${JSON.stringify(created.json)}`);
  assert(created.json.pin_once === CASHIER_PIN, 'pin_once echoed once');
  assert(created.json.user?.role === 'cashier', 'role cashier');
  assert(created.json.user?.display_name === CASHIER_NAME, 'display_name');
  assert(!('pin_hash' in (created.json.user ?? {})), 'no pin_hash on user');
  const cashierId = created.json.user.id;
  assert(cashierId, 'cashier id');
  console.log('create cashier → pin_once ok');

  // List again — still no PIN / pin_hash / pin_once on rows
  const listAfter = await request('GET', '/owner/staff', { token: ownerToken });
  assert(listAfter.status === 200, 'list after create');
  const row = (listAfter.json.users ?? []).find((u) => u.id === cashierId);
  assert(row, 'cashier in list');
  assert(!row.disabled_at, 'cashier active');
  assertNoPinFields(listAfter.json.users, 'list after');
  assert(!('pin_once' in row), 'no pin_once on list row');

  // DB has scrypt pin_hash but list API never exposes it
  const db = new Database(dbPath);
  const dbUser = db
    .prepare(`SELECT pin_hash, disabled_at FROM users WHERE id = ?`)
    .get(cashierId);
  assert(dbUser?.pin_hash?.startsWith('scrypt$'), 'scrypt pin_hash stored');
  assert(!dbUser.disabled_at, 'not disabled yet');
  db.close();

  // Seed product + stock for sell path (owner)
  const prod = await request('POST', '/catalog/products', {
    token: ownerToken,
    body: { name: PRODUCT, priceRs: 100, unit: 'piece', piecesPerCarton: 1 },
  });
  assert(prod.json?.ok === true, `product: ${JSON.stringify(prod.json)}`);
  const productId = prod.json.product.id;
  const sup = await request('POST', '/suppliers', { token: ownerToken, body: { name: 'Slice8 Supplier' } });
  const recv = await request('POST', '/stock/receive', {
    token: ownerToken,
    body: { productId, qty: 10, unit: 'piece', amountRs: 500, supplierId: sup.json?.supplier?.id },
  });
  assert(recv.json?.ok === true, `receive: ${JSON.stringify(recv.json)}`);

  // Cashier PIN login
  const cashLogin = await request('POST', '/auth/login', {
    body: { userId: cashierId, pin: CASHIER_PIN },
  });
  assert(
    cashLogin.json?.ok === true,
    `cashier login: ${JSON.stringify(cashLogin.json)}`,
  );
  assert(cashLogin.json.session?.role === 'cashier', 'session role cashier');
  const cashToken = cashLogin.json.sessionToken;
  assert(cashToken, 'cashier token');
  console.log('cashier login ok');

  // Sell path OK
  const sale = await request('POST', '/sales', {
    token: cashToken,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(
    sale.status === 201 && sale.json?.ok === true,
    `sell: ${sale.status} ${JSON.stringify(sale.json)}`,
  );
  console.log('cashier sell path ok');

  // Owner routes → 403
  const ownerPaths = [
    ['GET', '/owner/staff'],
    ['POST', '/stock/receive'],
    ['GET', '/analytics'],
    ['GET', '/backup'],
    ['GET', '/tax/queue'],
    ['POST', '/tax/process-next'],
    ['GET', '/tax/by-sale/nope'],
    ['POST', '/catalog/products'],
  ];
  for (const [method, p] of ownerPaths) {
    const body =
      method === 'POST'
        ? p.includes('receive')
          ? { productId, qty: 1, unit: 'piece' }
          : { name: 'Nope', priceRs: 1, unit: 'piece' }
        : undefined;
    const r = await request(method, p, { token: cashToken, body });
    assert(
      r.status === 403,
      `cashier ${method} ${p} → 403, got ${r.status} ${r.raw?.slice(0, 120)}`,
    );
  }
  // Cashier cannot create staff
  const createDenied = await request('POST', '/owner/staff/cashiers', {
    token: cashToken,
    body: { displayName: 'Nope', pin: '1111' },
  });
  assert(
    createDenied.status === 403,
    `cashier create staff 403 got ${createDenied.status}`,
  );
  console.log('owner routes 403');

  // Deactivate → login fails
  const deact = await request('POST', `/owner/staff/${cashierId}/deactivate`, {
    token: ownerToken,
  });
  assert(deact.status === 200 || deact.status === 201, `deactivate ${deact.status}`);
  assert(deact.json?.ok === true, `deactivate body: ${JSON.stringify(deact.json)}`);
  assert(deact.json.user?.disabled_at, 'disabled_at set');

  const failLogin = await request('POST', '/auth/login', {
    body: { userId: cashierId, pin: CASHIER_PIN },
  });
  assert(
    failLogin.json?.ok === false,
    `disabled login must fail: ${JSON.stringify(failLogin.json)}`,
  );
  console.log('deactivate → login fails');

  // List still has no pin_hash; cashier shows disabled
  const listFinal = await request('GET', '/owner/staff', { token: ownerToken });
  assertNoPinFields(listFinal.json.users, 'list final');
  const disabledRow = (listFinal.json.users ?? []).find((u) => u.id === cashierId);
  assert(disabledRow?.disabled_at, 'list shows disabled_at');

  // Cannot deactivate owner
  const ownerId = listFinal.json.users.find((u) => u.role === 'owner')?.id;
  assert(ownerId, 'owner id');
  const ownerDeact = await request('POST', `/owner/staff/${ownerId}/deactivate`, {
    token: ownerToken,
  });
  assert(
    ownerDeact.status === 403,
    `cannot deactivate owner: ${ownerDeact.status}`,
  );

  console.log('SLICE8 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE8 SMOKE FAIL', err);
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
