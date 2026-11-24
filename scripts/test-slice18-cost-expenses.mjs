#!/usr/bin/env node
/**
 * Slice 18 smoke: piece/carton receive unit cost, sale cost snapshot,
 * later receive does not rewrite it, cashier 403 on profit/expenses,
 * expense create + today total.
 *
 * Run: node scripts/test-slice18-cost-expenses.mjs
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

const API_PORT = Number(process.env.API_PORT ?? 3878);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice18-${Date.now()}.sqlite`);

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

console.log('=== DukaanDesk Slice 18 smoke (cost + expenses) ===');
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
assert(
  mig.applied.includes('012_slice18_cost_expenses.sql') ||
    mig.skipped.includes('012_slice18_cost_expenses.sql'),
  '012 migration present',
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

const apiCwd = path.join(root, 'apps/api');
const child = spawn('node', [path.join(apiCwd, 'dist/main.js')], {
  cwd: apiCwd,
  env: {
    ...process.env,
    API_PORT: String(API_PORT),
    SQLITE_PATH: dbPath,
    SESSION_SECRET: 'slice18-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

try {
  await waitHealth();

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: 'Slice18 Owner', pin: '2468', storeName: 'Slice18 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup ${JSON.stringify(setup.json)}`);
  const owner = setup.json.sessionToken;

  const created = await request('POST', '/catalog/products', {
    token: owner,
    body: { name: 'Slice18 Soap', priceRs: 100, unit: 'carton', piecesPerCarton: 24 },
  });
  assert(created.json?.ok === true, `create ${JSON.stringify(created.json)}`);
  assert(created.json.product.unit_label === 'piece', 'sell unit forced to piece');
  const productId = created.json.product.id;

  const zero = await request('POST', '/stock/receive', {
    token: owner,
    body: { productId, pieces: 0, unit: 'piece', amountRs: 10 },
  });
  assert(zero.json?.ok === false && zero.json.error === 'invalid_qty', 'refuse 0 pieces');

  const neg = await request('POST', '/stock/receive', {
    token: owner,
    body: { productId, pieces: 4, unit: 'piece', amountRs: -5 },
  });
  assert(neg.json?.ok === false && neg.json.error === 'invalid_amount', 'refuse negative money');

  const roundRecv = await request('POST', '/stock/receive', {
    token: owner,
    body: { productId, pieces: 3, unit: 'piece', amountRs: 100 },
  });
  assert(roundRecv.json?.ok === true, `round recv ${JSON.stringify(roundRecv.json)}`);
  assert(roundRecv.json.receive.unitCostPaisa === 3333, 'round(10000/3)=3333 paisa');
  assert(roundRecv.json.balance.qtyOnHand === 3, 'rounding receive stock 3');

  const loose = await request('POST', '/stock/receive', {
    token: owner,
    body: { productId, pieces: 10, unit: 'piece', amountRs: 250 },
  });
  assert(loose.json?.ok === true, `loose ${JSON.stringify(loose.json)}`);
  assert(loose.json.receive.qtyPieces === 10, 'loose pieces');
  assert(loose.json.receive.unitCostPaisa === 2500, '250 Rs / 10 = 25 Rs');
  assert(loose.json.balance.qtyOnHand === 13, 'stock 3+10');
  assert(loose.json.lastUnitCostPaisa === 2500, 'last cost updated');

  const carton = await request('POST', '/stock/receive', {
    token: owner,
    body: { productId, pieces: 24, unit: 'carton', amountRs: 1200 },
  });
  assert(carton.json?.ok === true, `carton ${JSON.stringify(carton.json)}`);
  assert(carton.json.receive.unit === 'carton', 'receive marked carton');
  assert(carton.json.receive.qtyPieces === 24, 'carton adds pieces not pack size');
  assert(carton.json.receive.unitCostPaisa === 5000, '1200 Rs / 24 pieces = 50 Rs');
  assert(carton.json.balance.qtyOnHand === 37, 'stock 13+24');

  const ownerList = await request('GET', '/catalog/products', { token: owner });
  const ownerRow = ownerList.json.items.find((p) => p.id === productId);
  assert(ownerRow.last_unit_cost_paisa === 5000, 'owner sees last unit cost');

  const sale = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'cash',
      lines: [{ productId, qty: 2, unit: 'piece' }],
    },
  });
  assert(sale.status === 201 && sale.json?.ok === true, `sale ${sale.status} ${JSON.stringify(sale.json)}`);
  const saleId = sale.json.sale.id;
  assert(!JSON.stringify(sale.json.sale).includes('unitCost'), 'sale payload hides cost');
  assert(sale.json.sale.lines[0].unit === 'piece', 'receipt line is pieces');

  const cartonSell = await request('POST', '/sales', {
    token: owner,
    body: {
      paymentMethod: 'cash',
      lines: [{ productId, qty: 1, unit: 'carton' }],
    },
  });
  assert(cartonSell.json?.ok === false && cartonSell.json.error === 'invalid_unit', 'sell refuses carton');

  const db1 = new Database(dbPath, { readonly: true });
  const snap = db1
    .prepare(
      `SELECT unit_cost_paisa, unit_price_paisa, qty_pieces, unit
       FROM sale_lines WHERE sale_id = ?`,
    )
    .get(saleId);
  db1.close();
  assert(snap.unit === 'piece', 'stored unit piece');
  assert(snap.qty_pieces === 2, 'sold 2 pieces');
  assert(snap.unit_price_paisa === 10000, 'sell price snapshotted');
  assert(snap.unit_cost_paisa === 5000, 'cost snapshotted at sale');

  const later = await request('POST', '/stock/receive', {
    token: owner,
    body: { productId, pieces: 6, unit: 'piece', amountRs: 90 },
  });
  assert(later.json?.ok === true, `later ${JSON.stringify(later.json)}`);
  assert(later.json.receive.unitCostPaisa === 1500, 'later unit cost 90/6');
  assert(later.json.balance.qtyOnHand === 41, '37 - 2 sold + 6');

  const db2 = new Database(dbPath, { readonly: true });
  const snap2 = db2
    .prepare(`SELECT unit_cost_paisa FROM sale_lines WHERE sale_id = ?`)
    .get(saleId);
  const last = db2
    .prepare(`SELECT last_unit_cost_paisa FROM products WHERE id = ?`)
    .get(productId);
  db2.close();
  assert(snap2.unit_cost_paisa === 5000, 'later receive did not rewrite sale cost');
  assert(last.last_unit_cost_paisa === 1500, 'product last cost did update');

  const profit = await request('GET', '/analytics', { token: owner });
  assert(profit.status === 200, `analytics ${profit.status}`);
  assert(profit.json.profit.sales_paisa === 20000, `sales ${profit.json.profit.sales_paisa}`);
  assert(profit.json.profit.cogs_paisa === 10000, `cogs ${profit.json.profit.cogs_paisa}`);
  assert(profit.json.profit.gross_profit_paisa === 10000, `gross ${profit.json.profit.gross_profit_paisa}`);
  assert(profit.json.profit.cost_unknown === false, 'cost known');
  assert(profit.json.profit.lines[0].markup_ratio === 1, 'markup (100-50)/50 = 1');
  assert(profit.json.cashier_today == null, 'analytics is not cashier today');

  const exp = await request('POST', '/expenses', {
    token: owner,
    body: { kind: 'bill', amountRs: 30, note: 'tea' },
  });
  assert(exp.json?.ok === true, `expense ${JSON.stringify(exp.json)}`);
  assert(exp.json.today_total_paisa === 3000, 'today expenses 30 Rs');
  assert(exp.json.expense.kind === 'bill', 'kind bill');

  const after = await request('GET', '/analytics', { token: owner });
  assert(after.json.profit.expenses_paisa === 3000, 'analytics expenses');
  assert(after.json.profit.left_paisa === 7000, 'left = gross - expenses');

  const listed = await request('GET', '/expenses', { token: owner });
  assert(listed.status === 200 && listed.json.items.length === 1, 'expense list');
  const expenseId = listed.json.items[0].id;

  const removed = await request('DELETE', `/expenses/${expenseId}`, { token: owner });
  assert(removed.json?.ok === true, `delete ${JSON.stringify(removed.json)}`);
  assert(removed.json.today_total_paisa === 0, 'today total after delete');

  const staff = await request('POST', '/owner/staff/cashiers', {
    token: owner,
    body: { displayName: 'Slice18 Cashier', pin: '1357' },
  });
  assert(staff.json?.ok === true, `cashier ${JSON.stringify(staff.json)}`);
  const login = await request('POST', '/auth/login', {
    body: { userId: staff.json.user.id, pin: '1357' },
  });
  assert(login.json?.ok === true, 'cashier login');
  const cashier = login.json.sessionToken;

  const deniedA = await request('GET', '/analytics', { token: cashier });
  const deniedE = await request('GET', '/expenses', { token: cashier });
  const deniedP = await request('POST', '/expenses', {
    token: cashier,
    body: { kind: 'salary', amountRs: 10 },
  });
  assert(deniedA.status === 403, `cashier analytics ${deniedA.status}`);
  assert(deniedE.status === 403, `cashier expenses ${deniedE.status}`);
  assert(deniedP.status === 403, `cashier expense create ${deniedP.status}`);

  const cashCat = await request('GET', '/catalog/products', { token: cashier });
  const cashRow = cashCat.json.items.find((p) => p.id === productId);
  assert(cashRow, 'cashier can list catalog');
  assert(!('last_unit_cost_paisa' in cashRow), 'cashier catalog hides cost');

  const today = await request('GET', '/cashier/today', { token: cashier });
  assert(today.status === 200, 'cashier today ok');
  const todayRaw = JSON.stringify(today.json);
  assert(!todayRaw.includes('unit_cost'), 'cashier today has no cost');
  assert(!todayRaw.includes('gross_profit'), 'cashier today has no profit');
  assert(today.json.sale_count === 1, 'cashier today count only');
  assert(today.json.total_paisa === 20000, 'cashier today total only');

  console.log('SLICE18 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE18 SMOKE FAIL', err);
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
