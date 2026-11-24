#!/usr/bin/env node
/**
 * Slice 11 smoke: party → udhaar sale → balance → collect partial →
 * balance → collect remainder → 0; ledger debit+credit; over-collect refused.
 *
 * Run:  node scripts/test-slice11-collections.mjs
 * Or:   pnpm test:slice11
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

const API_PORT = Number(process.env.API_PORT ?? 3861);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice11-${Date.now()}.sqlite`);

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

function nestError(json) {
  if (!json) return undefined;
  if (typeof json.message === 'object' && json.message) {
    return json.message.error ?? json.message;
  }
  return json.error;
}

console.log('=== DukaanDesk Slice 11 smoke (collections + party ledger) ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
console.log('migrations:', mig);

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
    SESSION_SECRET: 'slice11-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '2468';
const DISPLAY = 'Slice11 Owner';
const PRODUCT = 'Slice11 Chai 200g';
const PARTY = 'Bilal Store';
const CLIENT_AT = '2026-10-01T22:00:00.000+05:00';

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: PIN, storeName: 'Slice11 Kiryana' },
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

  const recv = await request('POST', '/stock/receive', {
    token,
    body: { productId, qty: 20, unit: 'piece' },
  });
  assert(recv.json?.ok === true, `receive: ${JSON.stringify(recv.json)}`);
  console.log('product + stock ready');

  // --- Create party ---
  const partyRes = await request('POST', '/parties', {
    token,
    body: { name: PARTY, phone: '03009876543' },
  });
  assert(
    partyRes.json?.ok === true,
    `party create: ${JSON.stringify(partyRes.json)}`,
  );
  const partyId = partyRes.json.party.id;
  assert(partyRes.json.party.balance_paisa === 0, 'new party balance 0');
  console.log('party created', partyId);

  // Detail empty ledger
  const detail0 = await request('GET', `/parties/${partyId}`, { token });
  assert(detail0.status === 200 && detail0.json?.ok === true, 'detail ok');
  assert(detail0.json.party.balance_paisa === 0, 'detail balance 0');
  assert(
    Array.isArray(detail0.json.ledger) && detail0.json.ledger.length === 0,
    'empty ledger',
  );
  console.log('detail: empty ledger, balance 0');

  // --- Udhaar sale: 5 × 100 Rs = 50000 paisa ---
  const udhaar = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'udhaar',
      partyId,
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 5, unit: 'piece' }],
    },
  });
  assert(
    udhaar.status === 201 && udhaar.json?.ok === true,
    `udhaar: ${udhaar.status} ${JSON.stringify(udhaar.json)}`,
  );
  const saleTotal = 5 * 100 * 100;
  assert(udhaar.json.sale.totalPaisa === saleTotal, 'sale total 50000');
  console.log('udhaar sale OK totalPaisa=', saleTotal);

  const detail1 = await request('GET', `/parties/${partyId}`, { token });
  assert(detail1.json.party.balance_paisa === saleTotal, 'balance after debit');
  assert(detail1.json.ledger.length === 1, 'one ledger entry');
  assert(detail1.json.ledger[0].entry_type === 'debit', 'debit entry');
  assert(detail1.json.ledger[0].amount_paisa === saleTotal, 'debit amount');
  assert(detail1.json.ledger[0].sale_id, 'debit linked to sale');
  console.log('balance → 50000; ledger debit present');

  // --- Collect partial: 20000 ---
  const partial = await request('POST', `/parties/${partyId}/collections`, {
    token,
    body: { amount_paisa: 20000, note: 'partial cash' },
  });
  assert(
    partial.status === 201 && partial.json?.ok === true,
    `partial collect: ${partial.status} ${JSON.stringify(partial.json)}`,
  );
  assert(partial.json.entry.entry_type === 'credit', 'credit entry');
  assert(partial.json.entry.amount_paisa === 20000, 'credit 20000');
  assert(partial.json.entry.sale_id == null, 'collection sale_id null');
  assert(partial.json.party.balance_paisa === 30000, 'balance 30000');
  console.log('partial collect 20000 → balance 30000');

  // --- Over-collect refused ---
  const over = await request('POST', `/parties/${partyId}/collections`, {
    token,
    body: { amount_paisa: 30001 },
  });
  assert(
    over.status === 409 || over.status === 400,
    `over-collect status 409/400, got ${over.status}`,
  );
  const overErr = nestError(over.json);
  assert(
    overErr === 'amount_exceeds_balance',
    `over error amount_exceeds_balance, got ${JSON.stringify(over.json)}`,
  );
  const still = await request('GET', `/parties/${partyId}`, { token });
  assert(still.json.party.balance_paisa === 30000, 'balance unchanged after over');
  console.log('over-collect refused; balance still 30000');

  // --- Amount ≤ 0 refused ---
  const zero = await request('POST', `/parties/${partyId}/collections`, {
    token,
    body: { amount_paisa: 0 },
  });
  assert(zero.status === 400, `zero amount 400, got ${zero.status}`);
  assert(nestError(zero.json) === 'amount_invalid', 'amount_invalid');
  const neg = await request('POST', `/parties/${partyId}/collections`, {
    token,
    body: { amount_paisa: -100 },
  });
  assert(neg.status === 400, 'negative 400');
  console.log('amount ≤ 0 refused');

  // --- Collect remainder → 0 ---
  const rem = await request('POST', `/parties/${partyId}/collections`, {
    token,
    body: { amount_paisa: 30000, note: 'cleared' },
  });
  assert(
    rem.status === 201 && rem.json?.ok === true,
    `remainder: ${JSON.stringify(rem.json)}`,
  );
  assert(rem.json.party.balance_paisa === 0, 'balance 0');
  console.log('remainder collect → balance 0');

  const detail2 = await request('GET', `/parties/${partyId}`, { token });
  assert(detail2.json.party.balance_paisa === 0, 'detail balance 0');
  assert(detail2.json.ledger.length === 3, '3 ledger entries');
  // newest first: credit, credit, debit
  assert(detail2.json.ledger[0].entry_type === 'credit', 'newest credit');
  assert(detail2.json.ledger[0].amount_paisa === 30000, 'newest 30000');
  assert(detail2.json.ledger[1].entry_type === 'credit', 'mid credit');
  assert(detail2.json.ledger[1].amount_paisa === 20000, 'mid 20000');
  assert(detail2.json.ledger[2].entry_type === 'debit', 'oldest debit');
  assert(detail2.json.ledger[2].amount_paisa === saleTotal, 'oldest debit total');
  const types = detail2.json.ledger.map((e) => e.entry_type);
  assert(types.includes('debit') && types.includes('credit'), 'debit+credit present');
  console.log('ledger newest-first: credit, credit, debit');

  // --- List balance matches ---
  const list = await request('GET', '/parties', { token });
  const row = list.json.items.find((p) => p.id === partyId);
  assert(row?.balance_paisa === 0, 'list balance 0');

  // --- 404 unknown party ---
  const missing = await request('GET', '/parties/does-not-exist', { token });
  assert(missing.status === 404, 'missing party 404');

  console.log('SLICE11 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE11 SMOKE FAIL', err);
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
