#!/usr/bin/env node
/**
 * Slice 12 smoke: seed → export → mutate DB → restore → key entities match;
 * bad product/format/version rejected (400); bad PIN 401; cashier 403.
 *
 * Run:  node scripts/test-slice12-backup-restore.mjs
 * Or:   pnpm test:slice12
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

const API_PORT = Number(process.env.API_PORT ?? 3862);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice12-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hashPin(pin) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(pin, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

function nestCode(json) {
  if (!json) return undefined;
  if (typeof json.code === 'string') return json.code;
  if (json.message && typeof json.message === 'object') {
    return json.message.code ?? json.message.error ?? json.message.reason;
  }
  if (typeof json.message === 'string') return json.message;
  return json.error ?? json.reason;
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

console.log('=== DukaanDesk Slice 12 smoke (backup restore) ===');
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
    SESSION_SECRET: 'slice12-smoke-secret',
    TAX_MODE: 'simulate',
    TAX_PROCESS_INTERVAL_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '1357';
const CASHIER_PIN = '9753';
const DISPLAY = 'Slice12 Owner';
const PRODUCT = 'Slice12 Chai 250 g';
const CLIENT_AT = '2026-10-01T22:00:00.000+05:00';

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: PIN, storeName: 'Slice12 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;
  const ownerId = setup.json.user?.id ?? setup.json.session?.userId;
  assert(token, 'sessionToken');
  assert(ownerId, 'ownerId');
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

  const party = await request('POST', '/parties', {
    token,
    body: { name: 'Slice12 Customer', phone: '03001234567' },
  });
  assert(party.json?.ok === true, `party: ${JSON.stringify(party.json)}`);
  const partyId = party.json.party.id;

  const sale = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'udhaar',
      partyId,
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 2, unit: 'piece' }],
    },
  });
  assert(
    sale.status === 201 && sale.json?.ok === true,
    `sale: ${sale.status} ${JSON.stringify(sale.json)}`,
  );
  const saleId = sale.json.sale.id;
  console.log('seeded product + party + sale', productId, partyId, saleId);

  // Snapshot key entities before export
  const snapDb = new Database(dbPath, { readonly: true });
  const snapProduct = snapDb
    .prepare(`SELECT id, name, price_paisa FROM products WHERE id = ?`)
    .get(productId);
  const snapStock = snapDb
    .prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`)
    .get(productId);
  const snapParty = snapDb
    .prepare(`SELECT id, name FROM parties WHERE id = ?`)
    .get(partyId);
  const snapSale = snapDb
    .prepare(
      `SELECT id, total_paisa, payment_method, party_id FROM sales WHERE id = ?`,
    )
    .get(saleId);
  const snapLines = snapDb
    .prepare(`SELECT COUNT(*) AS c FROM sale_lines WHERE sale_id = ?`)
    .get(saleId);
  const snapLedger = snapDb
    .prepare(`SELECT COUNT(*) AS c FROM party_ledger WHERE party_id = ?`)
    .get(partyId);
  const ownerBefore = snapDb
    .prepare(`SELECT id, pin_hash FROM users WHERE id = ?`)
    .get(ownerId);
  snapDb.close();
  assert(snapProduct?.name === PRODUCT, 'snap product');
  assert(snapStock?.qty_on_hand === 8, `snap stock ${snapStock?.qty_on_hand}`);
  assert(snapParty?.id === partyId, 'snap party');
  assert(snapSale?.id === saleId, 'snap sale');
  assert(snapLines?.c >= 1, 'snap lines');
  assert(snapLedger?.c >= 1, 'snap ledger');
  assert(ownerBefore?.pin_hash, 'owner pin_hash present');

  // Export
  const exp = await request('POST', '/backup/export', {
    token,
    body: { pin: PIN },
  });
  assert(
    exp.status === 200 || exp.status === 201,
    `export status ${exp.status}: ${exp.raw?.slice(0, 200)}`,
  );
  const bundle = exp.json;
  assert(bundle?.header?.product === 'DukaanDesk', 'header.product');
  assert(bundle.header.format === 'dukaandesk-store-export', 'header.format');
  assert(bundle.header.schema_version === 16, 'header.schema_version');
  console.log('export OK');

  // Mutate DB away from export
  const mut = new Database(dbPath);
  mut.prepare(`UPDATE products SET name = 'MUTATED', price_paisa = 1 WHERE id = ?`).run(
    productId,
  );
  mut.prepare(
    `UPDATE stock_balances SET qty_on_hand = 999 WHERE product_id = ?`,
  ).run(productId);
  mut.prepare(`UPDATE parties SET name = 'MUTATED PARTY' WHERE id = ?`).run(
    partyId,
  );
  mut.prepare(`DELETE FROM sale_lines WHERE sale_id = ?`).run(saleId);
  mut.prepare(`DELETE FROM party_ledger WHERE sale_id = ?`).run(saleId);
  mut.prepare(`DELETE FROM tax_documents WHERE sale_id = ?`).run(saleId);
  mut.prepare(`DELETE FROM sales WHERE id = ?`).run(saleId);
  const ghostId = randomUUID();
  mut
    .prepare(
      `INSERT INTO products (id, name, unit_label, price_paisa, pieces_per_carton, active)
       VALUES (?, 'GHOST', 'piece', 50, 1, 1)`,
    )
    .run(ghostId);
  mut
    .prepare(
      `INSERT INTO stock_balances (product_id, qty_on_hand) VALUES (?, 5)`,
    )
    .run(ghostId);
  mut.close();
  console.log('DB mutated away from export');

  // Bad header validations — must not touch DB
  const beforeBad = new Database(dbPath, { readonly: true });
  const ghostBefore = beforeBad
    .prepare(`SELECT name FROM products WHERE id = ?`)
    .get(ghostId);
  beforeBad.close();
  assert(ghostBefore?.name === 'GHOST', 'ghost present before bad restores');

  const badProduct = {
    ...bundle,
    header: { ...bundle.header, product: 'OtherPOS' },
  };
  const rProd = await request('POST', '/backup/restore', {
    token,
    body: { pin: PIN, bundle: badProduct },
  });
  assert(rProd.status === 400, `bad product → 400, got ${rProd.status}`);
  assert(
    String(nestCode(rProd.json)).includes('product'),
    `bad product code: ${JSON.stringify(rProd.json)}`,
  );

  const badFormat = {
    ...bundle,
    header: { ...bundle.header, format: 'other-format' },
  };
  const rFmt = await request('POST', '/backup/restore', {
    token,
    body: { pin: PIN, bundle: badFormat },
  });
  assert(rFmt.status === 400, `bad format → 400, got ${rFmt.status}`);
  assert(
    String(nestCode(rFmt.json)).includes('format'),
    `bad format code: ${JSON.stringify(rFmt.json)}`,
  );

  const badVer = {
    ...bundle,
    header: { ...bundle.header, schema_version: 99 },
  };
  const rVer = await request('POST', '/backup/restore', {
    token,
    body: { pin: PIN, bundle: badVer },
  });
  assert(rVer.status === 400, `bad version → 400, got ${rVer.status}`);
  assert(
    String(nestCode(rVer.json)).includes('schema'),
    `bad version code: ${JSON.stringify(rVer.json)}`,
  );

  // Confirm DB untouched by bad restores
  const afterBad = new Database(dbPath, { readonly: true });
  const ghostAfterBad = afterBad
    .prepare(`SELECT name FROM products WHERE id = ?`)
    .get(ghostId);
  const mutatedStill = afterBad
    .prepare(`SELECT name FROM products WHERE id = ?`)
    .get(productId);
  afterBad.close();
  assert(ghostAfterBad?.name === 'GHOST', 'ghost still present after bad header');
  assert(mutatedStill?.name === 'MUTATED', 'mutated product untouched by bad header');
  console.log('bad product/format/version → 400; DB untouched');

  // Bad PIN
  const badPin = await request('POST', '/backup/restore', {
    token,
    body: { pin: '0000', bundle },
  });
  assert(badPin.status === 401, `bad pin → 401, got ${badPin.status}`);
  console.log('bad PIN → 401');

  // Cashier 403
  const cashDb = new Database(dbPath);
  const cashierId = randomUUID();
  cashDb
    .prepare(
      `INSERT INTO users (id, role_id, display_name, pin_hash)
       VALUES (?, 'role-cashier', ?, ?)`,
    )
    .run(cashierId, 'Slice12 Cashier', hashPin(CASHIER_PIN));
  cashDb.close();

  const cashLogin = await request('POST', '/auth/login', {
    body: { userId: cashierId, pin: CASHIER_PIN },
  });
  assert(
    cashLogin.json?.ok === true,
    `cashier login: ${JSON.stringify(cashLogin.json)}`,
  );
  const cashToken = cashLogin.json.sessionToken;

  const denied = await request('POST', '/backup/restore', {
    token: cashToken,
    body: { pin: CASHIER_PIN, bundle },
  });
  assert(
    denied.status === 403,
    `cashier restore → 403, got ${denied.status} ${denied.raw?.slice(0, 200)}`,
  );
  console.log('cashier denied 403');

  // Good restore
  const restored = await request('POST', '/backup/restore', {
    token,
    body: { pin: PIN, bundle },
  });
  assert(
    restored.status === 200 || restored.status === 201,
    `restore status ${restored.status}: ${restored.raw?.slice(0, 300)}`,
  );
  assert(restored.json?.ok === true, `restore ok: ${JSON.stringify(restored.json)}`);
  console.log('restore OK', restored.json?.counts);

  // Key entities match export / pre-mutate snapshot
  const check = new Database(dbPath, { readonly: true });
  const p = check
    .prepare(`SELECT id, name, price_paisa FROM products WHERE id = ?`)
    .get(productId);
  const st = check
    .prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`)
    .get(productId);
  const pty = check
    .prepare(`SELECT id, name FROM parties WHERE id = ?`)
    .get(partyId);
  const s = check
    .prepare(
      `SELECT id, total_paisa, payment_method, party_id FROM sales WHERE id = ?`,
    )
    .get(saleId);
  const lines = check
    .prepare(`SELECT COUNT(*) AS c FROM sale_lines WHERE sale_id = ?`)
    .get(saleId);
  const ledger = check
    .prepare(`SELECT COUNT(*) AS c FROM party_ledger WHERE party_id = ?`)
    .get(partyId);
  const ghostGone = check
    .prepare(`SELECT id FROM products WHERE id = ?`)
    .get(ghostId);
  const ownerAfter = check
    .prepare(`SELECT id, pin_hash, display_name FROM users WHERE id = ?`)
    .get(ownerId);
  const cashierKept = check
    .prepare(`SELECT id FROM users WHERE id = ?`)
    .get(cashierId);
  const audit = check
    .prepare(
      `SELECT action FROM audit_log WHERE action = 'backup.restore' ORDER BY created_at DESC LIMIT 1`,
    )
    .get();
  check.close();

  assert(p?.name === snapProduct.name, `product name restored: ${p?.name}`);
  assert(
    p?.price_paisa === snapProduct.price_paisa,
    `product price restored: ${p?.price_paisa}`,
  );
  assert(
    st?.qty_on_hand === snapStock.qty_on_hand,
    `stock restored: ${st?.qty_on_hand}`,
  );
  assert(pty?.name === snapParty.name, `party name restored: ${pty?.name}`);
  assert(s?.id === saleId, 'sale restored');
  assert(s?.total_paisa === snapSale.total_paisa, 'sale total');
  assert(s?.payment_method === snapSale.payment_method, 'sale payment');
  assert(s?.party_id === partyId, 'sale party');
  assert(lines?.c === snapLines.c, `sale lines ${lines?.c} vs ${snapLines.c}`);
  assert(
    ledger?.c === snapLedger.c,
    `ledger ${ledger?.c} vs ${snapLedger.c}`,
  );
  assert(!ghostGone, 'ghost product wiped by restore');
  assert(ownerAfter?.id === ownerId, 'owner user kept');
  assert(
    ownerAfter?.pin_hash === ownerBefore.pin_hash,
    'owner pin_hash unchanged',
  );
  assert(cashierKept?.id === cashierId, 'cashier user kept');
  assert(audit?.action === 'backup.restore', 'audit backup.restore');
  console.log('entities match; users kept; audit.restore present');

  // Owner PIN still works after restore
  const reLogin = await request('POST', '/auth/login', {
    body: { userId: ownerId, pin: PIN },
  });
  assert(
    reLogin.json?.ok === true,
    `owner re-login after restore: ${JSON.stringify(reLogin.json)}`,
  );
  console.log('owner PIN still works after restore');

  console.log('SLICE12 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE12 SMOKE FAIL', err);
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
