#!/usr/bin/env node
/**
 * Slice 6 smoke: seed sale+product → export includes them;
 * pin_hash absent; cashier denied (403).
 *
 * Run:  node scripts/test-slice6-backup.mjs
 * Or:   pnpm test:slice6
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

const API_PORT = Number(process.env.API_PORT ?? 3856);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice6-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(pin, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
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

console.log('=== DukaanDesk Slice 6 smoke (Owner backup export) ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
console.log('migrations:', mig);
assert(
  mig.applied.includes('007_slice6_backup.sql') ||
    mig.skipped.includes('007_slice6_backup.sql'),
  '007_slice6_backup present',
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
    SESSION_SECRET: 'slice6-smoke-secret',
    TAX_MODE: 'simulate',
    TAX_PROCESS_INTERVAL_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '1357';
const CASHIER_PIN = '9753';
const DISPLAY = 'Slice6 Owner';
const PRODUCT = 'Slice6 Chai 250g';
const CLIENT_AT = '2026-10-01T11:50:00.000+05:00';

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: PIN, storeName: 'Slice6 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;
  const ownerId = setup.json.user?.id ?? setup.json.session?.userId;
  assert(token, 'sessionToken');
  console.log('setup ok');

  const created = await request('POST', '/catalog/products', {
    token,
    body: {
      name: PRODUCT,
      priceRs: 80,
      unit: 'piece',
      piecesPerCarton: 1,
    },
  });
  assert(created.json?.ok === true, `create: ${JSON.stringify(created.json)}`);
  const productId = created.json.product.id;

  const sup = await request('POST', '/suppliers', {
    token,
    body: { name: 'Smoke Supplier' },
  });
  assert(sup.json?.ok === true, `supplier: ${JSON.stringify(sup.json)}`);
  const recv = await request('POST', '/stock/receive', {
    token,
    body: { productId, qty: 10, unit: 'piece', amountRs: 500, supplierId: sup.json.supplier.id, paidNow: true },
  });
  assert(recv.json?.ok === true, `receive: ${JSON.stringify(recv.json)}`);

  const sale = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 2, unit: 'piece' }],
    },
  });
  assert(
    sale.status === 201 && sale.json?.ok === true,
    `sale: ${sale.status} ${JSON.stringify(sale.json)}`,
  );
  const saleId = sale.json.sale.id;
  console.log('seeded product + sale', productId, saleId);

  // Status before export
  const statusBefore = await request('GET', '/backup', { token });
  assert(statusBefore.status === 200, `status: ${statusBefore.status}`);
  assert(
    statusBefore.json?.data_region_disclosed === 'local_device',
    `data_region stub: ${JSON.stringify(statusBefore.json)}`,
  );
  assert(statusBefore.json?.product === 'DukaanDesk', 'product header stub');
  assert(statusBefore.json?.schema_version === 16, 'schema_version');
  assert(statusBefore.json?.min_schema_version === 1, 'min_schema_version');

  // Bad PIN
  const badPin = await request('POST', '/backup/export', {
    token,
    body: { pin: '0000' },
  });
  assert(badPin.status === 401, `bad pin → 401, got ${badPin.status}`);

  // Good export
  const exp = await request('POST', '/backup/export', {
    token,
    body: { pin: PIN },
  });
  assert(exp.status === 200 || exp.status === 201, `export status ${exp.status}: ${exp.raw?.slice(0, 200)}`);
  const bundle = exp.json;
  assert(bundle?.header?.product === 'DukaanDesk', 'header.product');
  assert(bundle.header.schema_version === 16, 'header.schema_version');
  for (const key of ['suppliers', 'supplier_payments', 'purchase_invoices', 'purchase_lines', 'stock_receives', 'expenses']) {
    assert(Array.isArray(bundle[key]), `export has ${key}`);
  }
  assert(
    bundle.header.data_region_disclosed === 'local_device',
    'header.data_region_disclosed',
  );
  assert(typeof bundle.header.exported_at === 'string', 'exported_at');
  assert(
    (bundle.products ?? []).some((p) => p.id === productId || p.name === PRODUCT),
    'export includes seeded product',
  );
  assert(
    (bundle.sales ?? []).some((s) => s.id === saleId),
    'export includes seeded sale',
  );
  assert(
    (bundle.sale_lines ?? []).some((l) => l.sale_id === saleId),
    'export includes sale lines',
  );
  assert(
    (bundle.stock_balances ?? []).some((b) => b.product_id === productId),
    'export includes stock',
  );
  assert(Array.isArray(bundle.tax_documents), 'tax_documents statuses array');

  const raw = JSON.stringify(bundle);
  assert(!/"pin_hash"\s*:/.test(raw), 'pin_hash absent from export');
  assert(!raw.includes('pin_hash'), 'pin_hash string absent');
  assert(!raw.includes('SESSION_SECRET'), 'SESSION_SECRET absent');
  assert(!/"payload_json"\s*:/.test(raw), 'payload_json absent (tax secrets)');
  assert(!/"raw_detail"\s*:/.test(raw), 'raw_detail absent');
  console.log('export OK — product+sale present; secrets scrubbed');

  // "Last saved" is not recorded until the client confirms the save.
  const copyId = exp.headers['x-backup-copy-id'];
  assert(copyId, 'X-Backup-Copy-Id header');
  const noAudit = new Database(dbPath, { readonly: true });
  const auditBefore = noAudit
    .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'backup.export'`)
    .get();
  noAudit.close();
  assert(auditBefore.n === 0, `no backup.export row before confirm, got ${auditBefore.n}`);
  const unsaved = await request('GET', '/backup', { token });
  assert(unsaved.json?.last_export_at == null, 'last_export_at still empty before confirm');
  const badConfirm = await request('POST', '/backup/saved', {
    token,
    body: { copy_id: 'nope' },
  });
  assert(badConfirm.status === 404, `unknown copy id → 404, got ${badConfirm.status}`);
  const confirm = await request('POST', '/backup/saved', {
    token,
    body: { copy_id: copyId },
  });
  assert(confirm.status === 200 || confirm.status === 201, `confirm ${confirm.status}`);
  assert(confirm.json?.ok === true && confirm.json?.last_export_at, 'confirm ok');
  const again = await request('POST', '/backup/saved', {
    token,
    body: { copy_id: copyId },
  });
  assert(again.status === 404, `copy id is single-use, got ${again.status}`);

  // Audit row
  const db = new Database(dbPath, { readonly: true });
  const audit = db
    .prepare(
      `SELECT action, payload_json FROM audit_log WHERE action = 'backup.export' ORDER BY created_at DESC LIMIT 1`,
    )
    .get();
  db.close();
  assert(audit?.action === 'backup.export', 'audit row backup.export');
  console.log('audit.export row present');

  // Status after
  const statusAfter = await request('GET', '/backup', { token });
  assert(statusAfter.json?.last_export_at, 'last_export_at set after export');

  // Seed cashier (no staff UI) and assert 403
  const cashDb = new Database(dbPath);
  const cashierId = randomUUID();
  cashDb
    .prepare(
      `INSERT INTO users (id, role_id, display_name, pin_hash)
       VALUES (?, 'role-cashier', ?, ?)`,
    )
    .run(cashierId, 'Slice6 Cashier', hashPin(CASHIER_PIN));
  cashDb.close();

  const cashLogin = await request('POST', '/auth/login', {
    body: { userId: cashierId, pin: CASHIER_PIN },
  });
  assert(
    cashLogin.json?.ok === true,
    `cashier login: ${JSON.stringify(cashLogin.json)}`,
  );
  const cashToken = cashLogin.json.sessionToken;
  assert(cashToken, 'cashier token');

  const denied = await request('POST', '/backup/export', {
    token: cashToken,
    body: { pin: CASHIER_PIN },
  });
  assert(
    denied.status === 403,
    `cashier export → 403, got ${denied.status} ${denied.raw?.slice(0, 200)}`,
  );

  const deniedStatus = await request('GET', '/backup', { token: cashToken });
  assert(
    deniedStatus.status === 403,
    `cashier status → 403, got ${deniedStatus.status}`,
  );
  console.log('cashier denied 403');

  console.log('SLICE6 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE6 SMOKE FAIL', err);
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
