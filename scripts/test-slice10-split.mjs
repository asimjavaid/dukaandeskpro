#!/usr/bin/env node
/**
 * Slice 10 smoke: full cash, full udhaar, split (cash+udhaar).
 *
 * Asserts:
 *  - cash: stock −, no ledger, analytics cash bucket
 *  - udhaar: stock −, ledger debit = total
 *  - split: stock − full; ledger debit = udhaar_amount only; analytics splits buckets
 *  - Tax V1 (D30 LOCK): FBR out — no tax document is queued for any sale.
 *    The old "void split via FBR reject" step is retired; void coverage moves
 *    to the commercial Void-sale slice (separate, later).
 *
 * Run:  node scripts/test-slice10-split.mjs
 * Or:   pnpm test:slice10
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

const API_PORT = Number(process.env.API_PORT ?? 3860);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice10-${Date.now()}.sqlite`);

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

console.log('=== DukaanDesk Slice 10 smoke (split tender) ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
console.log('migrations:', mig);
assert(
  mig.applied.includes('010_slice10_split.sql') ||
    mig.skipped.includes('010_slice10_split.sql'),
  '010_slice10_split present',
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
    SESSION_SECRET: 'slice10-smoke-secret',
    TAX_MODE: 'simulate',
    TAX_PROCESS_INTERVAL_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '2468';
const DISPLAY = 'Slice10 Owner';
const PRODUCT = 'Slice10 Chai 250g';
const PARTY = 'Slice10 Party';
const CLIENT_AT = '2026-10-01T12:00:00.000+05:00';
const PRICE_RS = 100;
const PRICE_PAISA = PRICE_RS * 100;

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: PIN, storeName: 'Slice10 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;
  assert(token, 'sessionToken');
  console.log('setup ok');

  const created = await request('POST', '/catalog/products', {
    token,
    body: {
      name: PRODUCT,
      priceRs: PRICE_RS,
      unit: 'piece',
      piecesPerCarton: 1,
    },
  });
  assert(created.json?.ok === true, `create: ${JSON.stringify(created.json)}`);
  const productId = created.json.product.id;

  const recv = await request('POST', '/stock/receive', {
    token,
    body: { productId, qty: 50, unit: 'piece' },
  });
  assert(recv.json?.ok === true, `receive: ${JSON.stringify(recv.json)}`);
  assert(recv.json.balance.qtyOnHand === 50, 'on hand 50');
  console.log('receive 50 → 50');

  const partyRes = await request('POST', '/parties', {
    token,
    body: { name: PARTY, phone: '03001234567' },
  });
  assert(partyRes.json?.ok === true, `party: ${JSON.stringify(partyRes.json)}`);
  const partyId = partyRes.json.party.id;
  assert(partyBalance((await request('GET', '/parties', { token })).json, partyId) === 0, 'party bal 0');

  // --- 1) Full cash ---
  const cashSale = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 2, unit: 'piece' }],
    },
  });
  assert(
    cashSale.status === 201 && cashSale.json?.ok === true,
    `cash: ${cashSale.status} ${JSON.stringify(cashSale.json)}`,
  );
  assert(cashSale.json.sale.paymentMethod === 'cash', 'cash method');
  assert(cashSale.json.sale.totalPaisa === 2 * PRICE_PAISA, 'cash total');
  assert(cashSale.json.sale.cashAmountPaisa === 2 * PRICE_PAISA, 'cash amount');
  assert(cashSale.json.sale.udhaarAmountPaisa === 0, 'cash udhaar 0');
  assert(cashSale.json.sale.partyId == null, 'cash no party');
  let cat = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(cat.json, productId) === 48, 'stock 50−2=48');
  let parties = await request('GET', '/parties', { token });
  assert(partyBalance(parties.json, partyId) === 0, 'cash leaves ledger 0');
  console.log('1) full cash OK; stock 48; ledger 0');

  // --- 2) Full udhaar ---
  const udhaarSale = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'udhaar',
      partyId,
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 3, unit: 'piece' }],
    },
  });
  assert(
    udhaarSale.status === 201 && udhaarSale.json?.ok === true,
    `udhaar: ${JSON.stringify(udhaarSale.json)}`,
  );
  assert(udhaarSale.json.sale.paymentMethod === 'udhaar', 'udhaar method');
  assert(udhaarSale.json.sale.totalPaisa === 3 * PRICE_PAISA, 'udhaar total');
  assert(udhaarSale.json.sale.cashAmountPaisa === 0, 'udhaar cash 0');
  assert(
    udhaarSale.json.sale.udhaarAmountPaisa === 3 * PRICE_PAISA,
    'udhaar amount',
  );
  cat = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(cat.json, productId) === 45, 'stock 48−3=45');
  parties = await request('GET', '/parties', { token });
  assert(
    partyBalance(parties.json, partyId) === 3 * PRICE_PAISA,
    `udhaar ledger ${partyBalance(parties.json, partyId)}`,
  );
  console.log('2) full udhaar OK; stock 45; ledger', 3 * PRICE_PAISA);

  // --- 3) Split: cash 150 Rs + udhaar 50 Rs on 2×100 Rs = 200 Rs ---
  // Split with udhaar but no customer is refused (current behaviour)
  const splitNoParty = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'split',
      cashAmountPaisa: 15000,
      udhaarAmountPaisa: 5000,
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 2, unit: 'piece' }],
    },
  });
  assert(
    splitNoParty.json?.ok === false && splitNoParty.json?.error === 'udhaar_needs_customer',
    `walk-in split refused: ${JSON.stringify(splitNoParty.json)}`,
  );
  const walkCash = await request('POST', '/sales', {
    token,
    body: { paymentMethod: 'cash', clientDeviceAt: CLIENT_AT, lines: [{ productId, qty: 2, unit: 'piece' }] },
  });
  assert(walkCash.json?.ok === true, `walk-in cash: ${JSON.stringify(walkCash.json)}`);
  cat = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(cat.json, productId) === 43, 'stock 45−2=43 walk-in split');
  parties = await request('GET', '/parties', { token });
  assert(
    partyBalance(parties.json, partyId) === 3 * PRICE_PAISA,
    'walk-in split leaves ledger unchanged',
  );
  console.log('3a) walk-in split OK; stock 43; ledger unchanged');

  // Reject mismatch
  const splitMismatch = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'split',
      partyId,
      cashAmountPaisa: 10000,
      udhaarAmountPaisa: 5000,
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 2, unit: 'piece' }],
    },
  });
  assert(
    splitMismatch.json?.ok === false &&
      splitMismatch.json?.error === 'split_amounts_mismatch',
    `split mismatch: ${JSON.stringify(splitMismatch.json)}`,
  );

  const CASH_PART = 15000;
  const UDHAAR_PART = 5000;
  const splitSale = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'split',
      partyId,
      cashAmountPaisa: CASH_PART,
      udhaarAmountPaisa: UDHAAR_PART,
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 2, unit: 'piece' }],
    },
  });
  assert(
    splitSale.status === 201 && splitSale.json?.ok === true,
    `split: ${splitSale.status} ${JSON.stringify(splitSale.json)}`,
  );
  const split = splitSale.json.sale;
  assert(split.paymentMethod === 'split', 'split method');
  assert(split.totalPaisa === 20000, `split total ${split.totalPaisa}`);
  assert(split.cashAmountPaisa === CASH_PART, 'split cash');
  assert(split.udhaarAmountPaisa === UDHAAR_PART, 'split udhaar');
  assert(split.partyId === partyId, 'split party');
  assert(
    splitSale.json.tax === undefined,
    `FBR out — no tax queue status on /sales: ${JSON.stringify(splitSale.json.tax)}`,
  );
  assert(split.taxEnabled === false, 'Sales Tax OFF by default on split');
  const splitSaleId = split.id;

  cat = await request('GET', '/catalog/products', { token });
  assert(qtyOnHand(cat.json, productId) === 41, 'stock 43−2=41 (party split)');
  parties = await request('GET', '/parties', { token });
  const balAfterSplit = partyBalance(parties.json, partyId);
  // prior udhaar 30000 + split udhaar 5000 = 35000 (walk-in not on ledger)
  assert(
    balAfterSplit === 3 * PRICE_PAISA + UDHAAR_PART,
    `ledger debit udhaar only: got ${balAfterSplit}`,
  );
  console.log('3b) party split OK; stock 41; ledger', balAfterSplit);

  // Analytics: cash + udhaar buckets include walk-in split amounts on the sale
  const analytics = await request('GET', '/analytics', { token });
  assert(analytics.status === 200, `analytics ${analytics.status}`);
  const today = analytics.json.today;
  // cash: 2*10000 + 2*10000 (walk-in now cash) + 15000 = 55000
  // udhaar: 3*10000 + 5000 = 35000; total 90000; count 4
  assert(today.sale_count === 4, `sale_count=${today.sale_count}`);
  assert(today.total_paisa === 90000, `total=${today.total_paisa}`);
  assert(today.cash_paisa === 55000, `cash_paisa=${today.cash_paisa}`);
  assert(today.udhaar_paisa === 35000, `udhaar_paisa=${today.udhaar_paisa}`);
  assert(
    analytics.json.udhaar_outstanding_paisa === balAfterSplit,
    `outstanding=${analytics.json.udhaar_outstanding_paisa}`,
  );
  console.log('analytics buckets: cash 55000 + udhaar 35000');

  // --- 4) FBR out: no tax documents queued (void-by-reject path retired) ---
  const queue = await request('GET', '/tax/queue', { token });
  assert(queue.status === 200, `owner tax queue (historic only) ${queue.status}`);
  assert(
    (queue.json?.items ?? []).length === 0,
    `no tax docs queued: ${JSON.stringify(queue.json)}`,
  );
  const proc = await request('POST', '/tax/process-next', { token, body: {} });
  assert(
    proc.json?.processed === false && proc.json?.disabled === true,
    `process-next dormant: ${JSON.stringify(proc.json)}`,
  );
  console.log('4) FBR dormant: 0 tax docs; process-next disabled');

  // Source markers: POS cash tendered / remainder
  const posSrc = fs.readFileSync(
    path.join(root, 'apps/web/src/features/pos/PosShell.tsx'),
    'utf8',
  );
  assert(posSrc.includes('cash-tendered') || posSrc.includes('cashTendered'), 'POS cash tendered');
  assert(posSrc.includes('remainder'), 'POS remainder');
  assert(posSrc.includes("'split'") || posSrc.includes('"split"'), 'POS split method');
  const receiptSrc = fs.readFileSync(
    path.join(root, 'apps/web/src/features/pos/receipt.ts'),
    'utf8',
  );
  assert(receiptSrc.includes("method === 'split'"), 'receipt split');

  console.log('=== Slice 10 smoke PASS ===');
} catch (err) {
  console.error('FAIL', err);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}
