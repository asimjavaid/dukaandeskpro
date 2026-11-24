#!/usr/bin/env node
/**
 * Slice 4 smoke: party create → udhaar sale → stock − + ledger debit;
 * cash sale unchanged; oversell still 409.
 *
 * Run:  node scripts/test-slice4-udhaar.mjs
 * Or:   pnpm test:slice4
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

const API_PORT = Number(process.env.API_PORT ?? 3854);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice4-${Date.now()}.sqlite`);

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

function partyBalance(partiesJson, partyId) {
  const row = partiesJson.items.find((p) => p.id === partyId);
  return row?.balance_paisa;
}

console.log('=== DukaanDesk Slice 4 smoke (udhaar + parties) ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
console.log('migrations:', mig);
assert(
  mig.applied.includes('005_slice4_parties.sql') ||
    mig.skipped.includes('005_slice4_parties.sql'),
  '005_slice4_parties present',
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
    SESSION_SECRET: 'slice4-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '1357';
const DISPLAY = 'Slice4 Owner';
const PRODUCT = 'Slice4 Atta 1kg';
const PARTY = 'Ahmed Kiryana';
const CLIENT_AT = '2026-10-01T11:00:00.000+05:00';

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: PIN, storeName: 'Slice4 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;
  assert(token, 'sessionToken');
  console.log('setup ok');

  const created = await request('POST', '/catalog/products', {
    token,
    body: {
      name: PRODUCT,
      priceRs: 100,
      unit: 'piece',
      piecesPerCarton: 1,
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
  assert(recv.json.balance.qtyOnHand === 10, 'on hand 10');
  console.log('receive 10 → 10');

  // --- Party create ---
  const partyRes = await request('POST', '/parties', {
    token,
    body: { name: PARTY, phone: '03001234567' },
  });
  assert(
    partyRes.json?.ok === true,
    `party create: ${JSON.stringify(partyRes.json)}`,
  );
  const partyId = partyRes.json.party.id;
  assert(partyRes.json.party.balance_paisa === 0, 'new party balance 0');
  console.log('party created', partyId);

  const list0 = await request('GET', '/parties', { token });
  assert(list0.json?.count === 1, 'parties list 1');
  assert(partyBalance(list0.json, partyId) === 0, 'list balance 0');

  // --- Udhaar sale: 3 pieces @ 100 Rs = 30000 paisa ---
  const udhaar = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'udhaar',
      partyId,
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 3, unit: 'piece' }],
    },
  });
  assert(
    udhaar.status === 201 && udhaar.json?.ok === true,
    `udhaar sale: ${udhaar.status} ${JSON.stringify(udhaar.json)}`,
  );
  const uSale = udhaar.json.sale;
  assert(uSale.paymentMethod === 'udhaar', 'payment udhaar');
  assert(uSale.partyId === partyId, 'sale party linked');
  assert(uSale.totalPaisa === 3 * 100 * 100, `total ${uSale.totalPaisa}`);
  assert(uSale.shortId, 'shortId');
  console.log(
    `udhaar OK shortId=${uSale.shortId} totalPaisa=${uSale.totalPaisa}`,
  );

  const afterUdhaar = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(afterUdhaar.json, productId) === 7, 'stock 10−3=7');
  console.log('stock after udhaar → 7');

  const list1 = await request('GET', '/parties', { token });
  assert(
    partyBalance(list1.json, partyId) === 30000,
    `ledger debit balance expected 30000, got ${partyBalance(list1.json, partyId)}`,
  );
  console.log('party balance → 30000 paisa (debit = sale total)');

  // --- Cash sale unchanged: 2 pieces ---
  const cash = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: new Date().toISOString(),
      lines: [{ productId, qty: 2, unit: 'piece' }],
    },
  });
  assert(
    cash.status === 201 && cash.json?.ok === true,
    `cash sale: ${JSON.stringify(cash.json)}`,
  );
  assert(cash.json.sale.paymentMethod === 'cash', 'cash method');
  assert(cash.json.sale.partyId == null, 'cash has no party');
  const afterCash = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(afterCash.json, productId) === 5, 'stock 7−2=5');
  const list2 = await request('GET', '/parties', { token });
  assert(
    partyBalance(list2.json, partyId) === 30000,
    'cash must not change party balance',
  );
  console.log('cash sale OK; stock → 5; party balance unchanged');

  // --- Udhaar without a customer is refused (current behaviour: udhaar_needs_customer) ---
  const noParty = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'udhaar',
      clientDeviceAt: new Date().toISOString(),
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(
    noParty.json?.ok === false && noParty.json?.error === 'udhaar_needs_customer',
    `walk-in udhaar refused: ${JSON.stringify(noParty.json)}`,
  );
  const afterWalkRefuse = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(afterWalkRefuse.json, productId) === 5, 'refused sale leaves stock 5');
  // Keep the rest of the script's stock arithmetic: sell 1 for cash instead.
  const walkCash = await request('POST', '/sales', {
    token,
    body: { paymentMethod: 'cash', clientDeviceAt: new Date().toISOString(), lines: [{ productId, qty: 1, unit: 'piece' }] },
  });
  assert(walkCash.json?.ok === true, `walk-in cash: ${JSON.stringify(walkCash.json)}`);
  const afterWalkIn = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(afterWalkIn.json, productId) === 4, 'stock 5−1=4');
  const listWalk = await request('GET', '/parties', { token });
  assert(
    partyBalance(listWalk.json, partyId) === 30000,
    'walk-in does not touch khata',
  );
  console.log('walk-in udhaar refused; cash sale → 4; ledger unchanged');

  // --- Oversell still 409 (udhaar path) ---
  const oversell = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'udhaar',
      partyId,
      clientDeviceAt: new Date().toISOString(),
      lines: [{ productId, qty: 9, unit: 'piece' }],
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
  const afterRefuse = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(afterRefuse.json, productId) === 4, 'stock unchanged after refuse');
  const list3 = await request('GET', '/parties', { token });
  assert(
    partyBalance(list3.json, partyId) === 30000,
    'balance unchanged after refuse',
  );
  console.log('oversell udhaar refused with 409; stock+ledger unchanged');

  // --- Cash oversell still 409 ---
  const overCash = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: new Date().toISOString(),
      lines: [{ productId, qty: 6, unit: 'piece' }],
    },
  });
  assert(overCash.status === 409, 'cash oversell 409');
  console.log('cash oversell still 409');

  console.log('SLICE4 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE4 SMOKE FAIL', err);
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
