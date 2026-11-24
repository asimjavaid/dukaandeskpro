#!/usr/bin/env node
/**
 * Slice 20 smoke: cash tendered above the total stores change;
 * exact tender is change 0; short cash is refused; pure udhaar
 * does not invent change; split keeps change 0 on the cash received.
 *
 * Run: node scripts/test-slice20-change.mjs
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

const API_PORT = Number(process.env.API_PORT ?? 3891);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice20-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function safe(value) {
  return JSON.stringify(value, (k, v) =>
    k === 'sessionToken' || k === 'pin' ? '[redacted]' : v,
  );
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
      { hostname: '127.0.0.1', port: API_PORT, path: urlPath, method, headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json });
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
      if (r.status === 200 && r.json?.status === 'ok') return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('health timeout');
}

console.log('=== DukaanDesk Slice 20 smoke (change) ===');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
const mig = migrate(dbPath);
assert(
  mig.applied.includes('014_slice20_change.sql') ||
    mig.skipped.includes('014_slice20_change.sql'),
  '014 migration present',
);

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

const child = spawn('node', ['dist/main.js'], {
  cwd: path.join(root, 'apps/api'),
  env: {
    ...process.env,
    API_PORT: String(API_PORT),
    SQLITE_PATH: dbPath,
    SESSION_SECRET: 'slice20-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

try {
  await waitHealth();
  const setup = await request('POST', '/auth/setup', {
    body: { displayName: 'Slice20 Owner', pin: '1357', storeName: 'Slice20 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup ${safe(setup.json)}`);
  const owner = setup.json.sessionToken;

  const created = await request('POST', '/catalog/products', {
    token: owner,
    body: { name: 'Slice20 Soap', priceRs: 780 },
  });
  assert(created.json?.ok === true, `product ${safe(created.json)}`);
  const productId = created.json.product.id;
  const recv = await request('POST', '/stock/receive', {
    token: owner,
    body: { productId, pieces: 10, unit: 'piece', amountRs: 500 },
  });
  assert(recv.json?.ok === true, `receive ${safe(recv.json)}`);

  const party = await request('POST', '/parties', {
    token: owner,
    body: { name: 'Slice20 Customer' },
  });
  assert(party.json?.ok === true, `customer ${safe(party.json)}`);
  const partyId = party.json.party.id;

  const over = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'cash',
      tenderedPaisa: 100000,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(over.status === 201 && over.json?.ok === true, `over ${over.status} ${safe(over.json)}`);
  assert(over.json.sale.totalPaisa === 78000, 'total 780 Rs');
  assert(over.json.sale.cashAmountPaisa === 78000, 'cash kept is the bill');
  assert(over.json.sale.tenderedPaisa === 100000, 'paid 1000 Rs');
  assert(over.json.sale.changePaisa === 22000, 'change 220 Rs');
  assert(!JSON.stringify(over.json.sale).includes('unitCost'), 'no cost on sale');
  const saleId = over.json.sale.id;

  const db = new Database(dbPath, { readonly: true });
  const row = db
    .prepare(
      `SELECT total_paisa, cash_amount_paisa, tendered_paisa, change_paisa
       FROM sales WHERE id = ?`,
    )
    .get(saleId);
  db.close();
  assert(row.tendered_paisa === 100000 && row.change_paisa === 22000, `stored ${JSON.stringify(row)}`);
  console.log('overpay 780 / paid 1000 / change 220 stored');

  const exact = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'cash',
      tenderedPaisa: 78000,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(exact.json?.ok === true, `exact ${safe(exact.json)}`);
  assert(exact.json.sale.changePaisa === 0, 'exact change 0');
  assert(exact.json.sale.tenderedPaisa === 78000, 'exact tender');
  console.log('exact payment change 0');

  const short = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'cash',
      tenderedPaisa: 50000,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(short.json?.ok === false && short.json.error === 'short_tender', `short ${safe(short.json)}`);
  console.log('short cash refused');

  const udhaar = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'udhaar',
      partyId,
      tenderedPaisa: 100000,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(udhaar.json?.ok === true, `udhaar ${safe(udhaar.json)}`);
  assert(udhaar.json.sale.tenderedPaisa === 0, 'udhaar tendered 0');
  assert(udhaar.json.sale.changePaisa === 0, 'udhaar change 0');
  assert(udhaar.json.sale.cashAmountPaisa === 0, 'udhaar no cash');
  console.log('pure udhaar has no change');

  const split = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'split',
      partyId,
      cashAmountPaisa: 50000,
      udhaarAmountPaisa: 28000,
      tenderedPaisa: 50000,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(split.json?.ok === true, `split ${safe(split.json)}`);
  assert(split.json.sale.changePaisa === 0, 'split change 0');
  assert(split.json.sale.tenderedPaisa === 50000, 'split tender is cash received');
  assert(split.json.sale.udhaarAmountPaisa === 28000, 'remainder stays udhaar');
  console.log('split cash has no change; remainder stays on the customer');

  const omitted = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'cash',
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(omitted.json?.ok === true && omitted.json.sale.changePaisa === 0, 'omitted tender is exact');
  console.log('SLICE20 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE20 SMOKE FAIL', err);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  setTimeout(() => process.exit(process.exitCode ?? 0), 400);
}
