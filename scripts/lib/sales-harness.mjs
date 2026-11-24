/**
 * Shared harness for the Sales Remove / Returns / Edit API tests.
 * Fresh temp SQLite, builds the API (unless SKIP_BUILD=1), seeds an owner,
 * a cashier, three stocked products and one customer.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));
export const Database = require('better-sqlite3');

export function karachiYmd(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export function makeChecks() {
  const c = { passed: 0 };
  c.ok = (cond, msg) => {
    if (!cond) throw new Error(msg);
    c.passed += 1;
  };
  return c;
}

export async function startApi(tag, port, extraEnv = {}) {
  const dbPath = path.join(os.tmpdir(), `dukaandesk-${tag}-${Date.now()}.sqlite`);
  for (const sfx of ['', '-wal', '-shm']) if (fs.existsSync(dbPath + sfx)) fs.unlinkSync(dbPath + sfx);
  migrate(dbPath);
  const apiCwd = path.join(root, 'apps/api');
  if (process.env.SKIP_BUILD !== '1') {
    const b = spawn('pnpm', ['--filter', '@dukaandeskpro/api', 'build'], { cwd: root, stdio: 'inherit', shell: true });
    await new Promise((res, rej) => b.on('exit', (code) => (code === 0 ? res() : rej(new Error(`build ${code}`)))));
  }
  const child = spawn('node', [path.join(apiCwd, 'dist/main.js')], {
    cwd: apiCwd,
    env: { ...process.env, API_PORT: String(port), SQLITE_PATH: dbPath, SESSION_SECRET: `${tag}-secret`, TAX_PROCESS_INTERVAL_MS: '0', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

  /** till: a paired till's device key (header x-dd-till); none = this PC's own Till 1. */
  function request(method, urlPath, { body, token, till } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : null;
      const headers = {};
      if (till) headers['x-dd-till'] = till;
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(payload);
      }
      if (token) headers['x-dd-session'] = token;
      const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { /* */ }
          resolve({ status: res.statusCode, json, raw, headers: res.headers });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const r = await request('GET', '/health');
      if (r.status === 200) break;
    } catch { /* retry */ }
    if (Date.now() > deadline) throw new Error('health timeout');
    await new Promise((r) => setTimeout(r, 250));
  }
  return { dbPath, request, stop: () => child.kill('SIGTERM') };
}

/**
 * opts.cashierRefunds: P1 rule — a cashier refunds without a manager PIN. Lite asks for a manager
 * by default (shop rule cashier_refund_needs_manager); tests written for P1 refunds turn it off.
 */
export async function seed(api, opts = {}) {
  const { request } = api;
  const setup = await request('POST', '/auth/setup', {
    body: { displayName: 'Asim Owner', pin: '2468', storeName: 'Test Kiryana' },
  });
  if (!setup.json?.ok) throw new Error(`setup ${setup.raw}`);
  const owner = setup.json.sessionToken;
  if (opts.cashierRefunds) {
    const rr = await request('POST', '/settings/rules', { token: owner, body: { cashier_refund_needs_manager: false } });
    if (!rr.json?.ok) throw new Error(`rules ${rr.raw}`);
  }
  const created = await request('POST', '/owner/staff/cashiers', { token: owner, body: { displayName: 'Bilal Cashier', pin: '5678' } });
  const login = await request('POST', '/auth/login', { body: { userId: created.json.user.id, pin: '5678' } });
  const cashier = login.json.sessionToken;
  const sup = await request('POST', '/suppliers', { token: owner, body: { name: 'Test Supplier' } });
  const supplierId = sup.json.supplier.id;
  async function product(name, priceRs, costRs) {
    const r = await request('POST', '/catalog/products', { token: owner, body: { name, priceRs, unit: 'piece', piecesPerCarton: 1 } });
    if (!r.json?.ok) throw new Error(`product ${r.raw}`);
    const rc = await request('POST', '/stock/receive', {
      token: owner,
      body: { productId: r.json.product.id, qty: 100, unit: 'piece', amountRs: costRs * 100, supplierId },
    });
    if (!rc.json?.ok) throw new Error(`receive ${rc.raw}`);
    return r.json.product;
  }
  const atta = await product('Sunny Atta 5kg', 1480, 1300);
  const daal = await product('Daal Masoor', 250, 200);
  const soap = await product('Lux Soap', 120, 100);
  const pr = await request('POST', '/parties', { token: owner, body: { name: 'Rashid Bhai', phone: '0300-1234567' } });
  const rashid = pr.json.party;
  async function sell(token, body) {
    const r = await request('POST', '/sales', { token, body });
    if (r.status !== 201 || !r.json?.ok) throw new Error(`sale ${r.status} ${r.raw}`);
    return r.json.sale;
  }
  const db = () => new Database(api.dbPath, { readonly: true });
  function stock(productId) {
    const d = db();
    const r = d.prepare('SELECT qty_on_hand FROM stock_balances WHERE product_id = ?').get(productId);
    d.close();
    return r?.qty_on_hand ?? 0;
  }
  async function balance(partyId) {
    const d = db();
    const r = d.prepare(
      `SELECT COALESCE(SUM(CASE WHEN entry_type='debit' THEN amount_paisa ELSE -amount_paisa END),0) AS b
       FROM party_ledger WHERE party_id = ?`,
    ).get(partyId);
    d.close();
    return r.b;
  }
  return { owner, cashier, ownerId: setup.json.user?.id, atta, daal, soap, rashid, sell, stock, balance, db };
}

/** Start the API on an existing DB file (e.g. to check something survives a restart). */
export async function startApiOn(dbPath, port, extraEnv = {}) {
  const apiCwd = path.join(root, 'apps/api');
  const child = spawn('node', [path.join(apiCwd, 'dist/main.js')], {
    cwd: apiCwd,
    env: { ...process.env, API_PORT: String(port), SQLITE_PATH: dbPath, TAX_PROCESS_INTERVAL_MS: '0', AUTO_BACKUP_INTERVAL_MS: '0', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));
  function request(method, urlPath, { body, token } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : null;
      const headers = {};
      if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
      if (token) headers['x-dd-session'] = token;
      const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const raw = buf.toString('utf8');
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { /* */ }
          resolve({ status: res.statusCode, json, raw, buf, headers: res.headers });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }
  const deadline = Date.now() + 60000;
  for (;;) {
    try { if ((await request('GET', '/health')).status === 200) break; } catch { /* */ }
    if (Date.now() > deadline) throw new Error('health timeout');
    await new Promise((r) => setTimeout(r, 250));
  }
  return { dbPath, request, stop: () => new Promise((res) => { child.once('exit', res); child.kill('SIGTERM'); }) };
}
