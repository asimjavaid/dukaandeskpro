#!/usr/bin/env node
/**
 * D31 / D31.1 Simple Tax Management smoke.
 *
 *  - Owner GET /tax/summary|years|months; cashier 403
 *  - All products: known sales → base; rate_bp → tax (10_000_000 @ 1700 → 1_700_000)
 *  - Selected products: line totals only; mixed basket scopes to picked SKU
 *  - scope=products without ids → 400; >200 ids → 400
 *  - voided_at excluded from base
 *  - New sales write tax_enabled=0 / tax_paisa=0 (D30 strip)
 *
 * Run: node scripts/test-tax-simple.mjs  (or pnpm test:tax-simple)
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

const API_PORT = Number(process.env.API_PORT ?? 3872);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-tax-simple-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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

console.log('=== DukaanDesk D31 Simple Tax smoke ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
migrate(dbPath);

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
    SESSION_SECRET: 'tax-simple-smoke-secret',
    TAX_MODE: 'simulate',
    TAX_PROCESS_INTERVAL_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '2468';
const CASHIER_PIN = '8642';
const CLIENT_AT = '2026-10-05T12:00:00.000+05:00';

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: 'Tax Owner', pin: PIN, storeName: 'Tax Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;

  const staff = await request('POST', '/owner/staff/cashiers', {
    token,
    body: { displayName: 'Tax Cashier', pin: CASHIER_PIN },
  });
  assert(
    staff.status === 200 || staff.status === 201,
    `staff status ${staff.status} ${staff.raw?.slice(0, 200)}`,
  );
  assert(staff.json?.ok === true, `staff: ${JSON.stringify(staff.json)}`);
  const cashierId = staff.json.user?.id;
  assert(cashierId, 'cashier id');

  const cashLogin = await request('POST', '/auth/login', {
    body: { userId: cashierId, pin: CASHIER_PIN },
  });
  assert(
    cashLogin.json?.ok === true,
    `cashier login: ${JSON.stringify(cashLogin.json)} status=${cashLogin.status}`,
  );
  const cashToken = cashLogin.json.sessionToken;

  const denied = await request(
    'GET',
    '/tax/summary?from=2026-10-01&to=2026-10-31',
    { token: cashToken },
  );
  assert(denied.status === 403, `cashier tax 403 got ${denied.status}`);
  console.log('cashier 403 ok');

  const createdA = await request('POST', '/catalog/products', {
    token,
    body: { name: 'Tax Atta', priceRs: 1000, unit: 'piece', piecesPerCarton: 1 },
  });
  assert(createdA.json?.ok === true, `create A: ${JSON.stringify(createdA.json)}`);
  const productA = createdA.json.product.id;

  const createdB = await request('POST', '/catalog/products', {
    token,
    body: { name: 'Tax Sugar', priceRs: 400, unit: 'piece', piecesPerCarton: 1 },
  });
  assert(createdB.json?.ok === true, `create B: ${JSON.stringify(createdB.json)}`);
  const productB = createdB.json.product.id;

  // Seed on-hand directly (receive now needs supplier; tax smoke only needs stock).
  {
    const dbSeed = new Database(dbPath);
    const upsert = dbSeed.prepare(
      `INSERT INTO stock_balances (product_id, qty_on_hand, updated_at)
       VALUES (?, 250, datetime('now'))
       ON CONFLICT(product_id) DO UPDATE SET qty_on_hand = 250, updated_at = datetime('now')`,
    );
    upsert.run(productA);
    upsert.run(productB);
    dbSeed.close();
  }

  // Sale 1: 10 × Atta @ 1000 Rs = 10_000 Rs = 1_000_000 paisa? Wait priceRs 1000 = 100000 paisa/unit
  // We need base 10_000_000 paisa = Rs 100,000.
  // Atta priceRs 1000 → 1000 Rs/piece → 100_000 paisa. qty 100 → 10_000_000 paisa.
  // Reset: create with price that works. productA is already 1000 Rs.
  // Sell 100 pieces of A alone for All-base example... but we also need mixed basket.
  // Plan:
  //  - Sale mixed: 1×A (1000 Rs) + 1×B (400 Rs) = 1400 Rs — for selected scope
  //  - Plus more A-only sales to reach totals, OR just assert math on what we sell.

  // Worked example target: base 10_000_000 @ 1700 → 1_700_000
  // Sell 100 × Atta @ Rs 1000 = Rs 100,000 = 10_000_000 paisa
  const saleAll = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId: productA, qty: 100, unit: 'piece' }],
    },
  });
  assert(saleAll.json?.ok === true, `sale all: ${JSON.stringify(saleAll.json)}`);
  assert(saleAll.json.sale.taxEnabled === false, 'new sale tax off');
  assert(Number(saleAll.json.sale.taxPaisa ?? 0) === 0, 'new sale tax_paisa 0');
  assert(Number(saleAll.json.sale.totalPaisa) === 10_000_000, `total ${saleAll.json.sale.totalPaisa}`);
  console.log('sale snapshot tax off ok');

  // Mixed basket: A 60 Rs worth... Atta is 1000 Rs/unit. Use smaller prices for mixed.
  // Instead: sell 1 A + 1 B in one sale for line-scope test using existing prices:
  // A line = 100_000 paisa? No Atta is 1000 Rs = 100000 paisa. B = 400 Rs = 40000 paisa.
  // Selected {A} → base 100000; @17% → 17000

  const saleMixed = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: '2026-10-06T12:00:00.000+05:00',
      lines: [
        { productId: productA, qty: 1, unit: 'piece' },
        { productId: productB, qty: 1, unit: 'piece' },
      ],
    },
  });
  assert(saleMixed.json?.ok === true, `sale mixed: ${JSON.stringify(saleMixed.json)}`);
  const mixedTotal = Number(saleMixed.json.sale.totalPaisa);
  assert(mixedTotal === 140_000, `mixed total ${mixedTotal}`);

  // Analytics/tax windows use recorded_at (server). Pin to intended PKT days.
  {
    const dbFix = new Database(dbPath);
    dbFix
      .prepare(`UPDATE sales SET recorded_at = ? WHERE total_paisa = 10000000`)
      .run(new Date('2026-10-05T12:00:00.000+05:00').toISOString());
    dbFix
      .prepare(`UPDATE sales SET recorded_at = ? WHERE total_paisa = 140000`)
      .run(new Date('2026-10-06T12:00:00.000+05:00').toISOString());
    dbFix.close();
  }

  // Summary All for October
  const summaryAll = await request(
    'GET',
    '/tax/summary?from=2026-10-01&to=2026-10-31&rate_bp=1700&scope=all',
    { token },
  );
  assert(summaryAll.status === 200 && summaryAll.json?.ok === true, JSON.stringify(summaryAll.json));
  // 10_000_000 + 140_000 = 10_140_000
  assert(
    Number(summaryAll.json.sales_base_paisa) === 10_140_000,
    `all base ${summaryAll.json.sales_base_paisa}`,
  );
  assert(
    Number(summaryAll.json.tax_paisa) === Math.floor((2 * 10_140_000 * 1700 + 10000) / 20000),
    `all tax ${summaryAll.json.tax_paisa}`,
  );
  assert(summaryAll.json.scope === 'all', 'scope all');
  console.log('summary all ok', summaryAll.json.sales_base_paisa, summaryAll.json.tax_paisa);

  // Worked example on first sale only window? Use rate on exact 10M by voiding mixed… or separate range.
  // Assert pure formula with first sale day only:
  const day1 = await request(
    'GET',
    '/tax/summary?from=2026-10-05&to=2026-10-05&rate_bp=1700&scope=all',
    { token },
  );
  assert(Number(day1.json.sales_base_paisa) === 10_000_000, `day1 base ${day1.json.sales_base_paisa}`);
  assert(Number(day1.json.tax_paisa) === 1_700_000, `day1 tax ${day1.json.tax_paisa}`);
  console.log('worked example 10M @ 17% → 1.7M ok');

  // Selected A only across Oct — lines: 100*A from sale1 + 1*A from mixed = 101 * 100000 = 10_100_000
  const selA = await request(
    'GET',
    `/tax/summary?from=2026-10-01&to=2026-10-31&rate_bp=1700&scope=products&product_ids=${productA}`,
    { token },
  );
  assert(selA.status === 200 && selA.json?.ok === true, JSON.stringify(selA.json));
  assert(Number(selA.json.sales_base_paisa) === 10_100_000, `selA base ${selA.json.sales_base_paisa}`);
  assert(selA.json.scope === 'products', 'scope products');
  assert(Number(selA.json.product_count) === 1, 'product_count');
  console.log('selected A ok');

  // Mixed basket Selected={A} on Oct 6 only → 100_000
  const mixedSel = await request(
    'GET',
    `/tax/summary?from=2026-10-06&to=2026-10-06&rate_bp=1700&scope=products&product_ids=${productA}`,
    { token },
  );
  assert(Number(mixedSel.json.sales_base_paisa) === 100_000, `mixed sel ${mixedSel.json.sales_base_paisa}`);
  assert(Number(mixedSel.json.tax_paisa) === 17_000, `mixed tax ${mixedSel.json.tax_paisa}`);
  console.log('mixed basket selected A ok');

  // Empty products → 400
  const empty = await request(
    'GET',
    '/tax/summary?from=2026-10-01&to=2026-10-31&scope=products',
    { token },
  );
  assert(empty.status === 400, `empty products status ${empty.status}`);
  console.log('empty selected 400 ok');

  // >200 ids → 400
  const many = Array.from({ length: 201 }, (_, i) => `id-${i}`).join(',');
  const over = await request(
    'GET',
    `/tax/summary?from=2026-10-01&to=2026-10-31&scope=products&product_ids=${many}`,
    { token },
  );
  assert(over.status === 400, `over 200 status ${over.status}`);
  console.log('>200 ids 400 ok');

  // years / months
  const years = await request('GET', '/tax/years', { token });
  assert(years.json?.ok === true && years.json.years.includes(2026), JSON.stringify(years.json));
  const months = await request(
    'GET',
    `/tax/months?year=2026&rate_bp=1700&scope=products&product_ids=${productB}`,
    { token },
  );
  assert(months.json?.ok === true && months.json.months?.length === 12, JSON.stringify(months.json));
  const oct = months.json.months.find((m) => m.month === 10);
  assert(Number(oct.sales_base_paisa) === 40_000, `oct B ${oct.sales_base_paisa}`);
  console.log('years/months ok');

  // Void exclusion: mark the Oct 5 sale voided_at directly
  const db = new Database(dbPath);
  const row = db
    .prepare(`SELECT id FROM sales WHERE total_paisa = 10000000 LIMIT 1`)
    .get();
  assert(row?.id, 'big sale id');
  db.prepare(`UPDATE sales SET voided_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    row.id,
  );
  db.close();

  const afterVoid = await request(
    'GET',
    '/tax/summary?from=2026-10-05&to=2026-10-05&rate_bp=1700&scope=all',
    { token },
  );
  assert(Number(afterVoid.json.sales_base_paisa) === 0, `voided still counted? ${afterVoid.json.sales_base_paisa}`);
  console.log('voided excluded ok');

  console.log('=== D31 Simple Tax smoke PASSED ===');
} catch (err) {
  console.error('FAIL', err);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  try {
    child.kill('SIGKILL');
  } catch {
    /* */
  }
}
