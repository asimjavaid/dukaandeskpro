#!/usr/bin/env node
/**
 * Surplus → khata credit smoke:
 * - Walk-in overpay → change only (no ledger)
 * - Customer + return change → change, no credit
 * - Customer + applySurplusToKhata → credit surplus, change 0, Due drops
 * - Flag without party → ignored (change returned)
 *
 * Run: node scripts/test-surplus-khata-credit.mjs
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

const API_PORT = Number(process.env.API_PORT ?? 3892);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-surplus-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function safe(value) {
  return JSON.stringify(value, (k, v) =>
    k === 'sessionToken' || k === 'pin' ? '[redacted]' : v,
  );
}

function request(method, urlPath, { body, token } = {}) {
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

console.log('=== DukaanDesk surplus → khata credit smoke ===');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
migrate(dbPath);

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
    SESSION_SECRET: 'surplus-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

try {
  await waitHealth();
  const setup = await request('POST', '/auth/setup', {
    body: {
      displayName: 'Surplus Owner',
      pin: '2468',
      storeName: 'Surplus Kiryana',
    },
  });
  assert(setup.json?.ok === true, `setup ${safe(setup.json)}`);
  const owner = setup.json.sessionToken;

  const created = await request('POST', '/catalog/products', {
    token: owner,
    body: { name: 'Surplus Soap', priceRs: 750 },
  });
  assert(created.json?.ok === true, `product ${safe(created.json)}`);
  const productId = created.json.product.id;

  const supplier = await request('POST', '/suppliers', {
    token: owner,
    body: { name: 'Surplus Supplier' },
  });
  assert(supplier.json?.ok === true, `supplier ${safe(supplier.json)}`);
  const supplierId = supplier.json.supplier.id;

  const recv = await request('POST', '/stock/receive', {
    token: owner,
    body: {
      productId,
      pieces: 20,
      unit: 'piece',
      amountRs: 500,
      supplierId,
    },
  });
  assert(recv.json?.ok === true, `receive ${safe(recv.json)}`);

  const party = await request('POST', '/parties', {
    token: owner,
    body: { name: 'Surplus Customer' },
  });
  assert(party.json?.ok === true, `customer ${safe(party.json)}`);
  const partyId = party.json.party.id;

  // Seed prior due: udhaar 750, collect 250 → Due 500.
  const seed = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'udhaar',
      partyId,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(seed.json?.ok === true, `seed udhaar ${safe(seed.json)}`);
  const collect = await request('POST', `/parties/${partyId}/collections`, {
    token: owner,
    body: { amountPaisa: 25000 },
  });
  assert(collect.json?.ok === true, `collect ${safe(collect.json)}`);
  const detail0 = await request('GET', `/parties/${partyId}`, { token: owner });
  const dueBefore =
    detail0.json?.party?.balance_paisa ?? detail0.json?.balance_paisa;
  assert(dueBefore === 50000, `due before ${safe(detail0.json)}`);
  console.log(`due before surplus keep: ${dueBefore}`);

  // Walk-in overpay → change only
  const walkin = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'cash',
      tenderedPaisa: 100000,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(walkin.json?.ok === true, `walkin ${safe(walkin.json)}`);
  assert(walkin.json.sale.changePaisa === 25000, 'walk-in change 250');
  assert(
    (walkin.json.sale.surplusCreditedPaisa ?? 0) === 0,
    'walk-in no surplus credit',
  );
  console.log('walk-in overpay → change only');

  // Flag without party ignored → change returned (walk-in safe)
  const noParty = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'cash',
      tenderedPaisa: 100000,
      applySurplusToKhata: true,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(noParty.json?.ok === true, `no party ${safe(noParty.json)}`);
  assert(noParty.json.sale.changePaisa === 25000, 'flag without party → change');
  assert(
    (noParty.json.sale.surplusCreditedPaisa ?? 0) === 0,
    'flag without party → no credit',
  );
  console.log('surplus without party ignored (change)');

  // Customer + return change (flag omitted)
  const ret = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'cash',
      partyId,
      tenderedPaisa: 100000,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(ret.json?.ok === true, `return ${safe(ret.json)}`);
  assert(ret.json.sale.changePaisa === 25000, 'return change 250');
  assert((ret.json.sale.surplusCreditedPaisa ?? 0) === 0, 'return no credit');
  const db1 = new Database(dbPath, { readonly: true });
  const creditsAfterReturn = db1
    .prepare(
      `SELECT COUNT(*) AS n FROM party_ledger
       WHERE party_id = ? AND entry_type = 'credit' AND sale_id = ?`,
    )
    .get(partyId, ret.json.sale.id);
  db1.close();
  assert(creditsAfterReturn.n === 0, 'return sold no ledger credit');
  console.log('customer return change → no khata credit');

  // Customer + keep surplus
  const keep = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'cash',
      partyId,
      tenderedPaisa: 100000,
      applySurplusToKhata: true,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(keep.json?.ok === true, `keep ${safe(keep.json)}`);
  assert(keep.json.sale.totalPaisa === 75000, 'total 750');
  assert(keep.json.sale.tenderedPaisa === 100000, 'tendered 1000');
  assert(keep.json.sale.changePaisa === 0, 'change 0 when kept');
  assert(keep.json.sale.surplusCreditedPaisa === 25000, 'surplus credited 250');

  const db2 = new Database(dbPath, { readonly: true });
  const saleRow = db2
    .prepare(
      `SELECT tendered_paisa, change_paisa FROM sales WHERE id = ?`,
    )
    .get(keep.json.sale.id);
  assert(
    saleRow.tendered_paisa === 100000 && saleRow.change_paisa === 0,
    `sale row ${JSON.stringify(saleRow)}`,
  );
  const credit = db2
    .prepare(
      `SELECT amount_paisa, note, entry_type FROM party_ledger
       WHERE party_id = ? AND sale_id = ? AND entry_type = 'credit'`,
    )
    .get(partyId, keep.json.sale.id);
  assert(credit && credit.amount_paisa === 25000, `credit ${JSON.stringify(credit)}`);
  assert(
    credit.note === 'sale surplus keep',
    `note ${credit.note}`,
  );
  const bal = db2
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount_paisa ELSE 0 END), 0)
         - COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_paisa ELSE 0 END), 0)
         AS balance_paisa
       FROM party_ledger WHERE party_id = ?`,
    )
    .get(partyId);
  db2.close();
  assert(
    bal.balance_paisa === dueBefore - 25000,
    `due ${bal.balance_paisa} expected ${dueBefore - 25000}`,
  );
  console.log(
    `keep surplus → credit 250; Due ${dueBefore} → ${bal.balance_paisa}`,
  );

  console.log('SURPLUS KHATA SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SURPLUS KHATA SMOKE FAIL', err);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  setTimeout(() => process.exit(process.exitCode ?? 0), 400);
}
