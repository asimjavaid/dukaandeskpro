#!/usr/bin/env node
/**
 * Settings > Reset data: owner only, backup first (abort if it fails), wipes all activity in one go,
 * keeps products / barcodes / packs / users / settings, stock to 0, new sale + purchase work after.
 *   SKIP_BUILD=1 node scripts/test-reset-data.mjs
 *   DEMO_DB=/path/demo.sqlite DEMO_PIN=2468 SKIP_BUILD=1 node scripts/test-reset-data.mjs   (also runs on a copy of that DB)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startApi, seed, makeChecks, Database, root } from './lib/sales-harness.mjs';

const require = createRequire(import.meta.url);
const { RESET_KEEP_TABLES, RESET_ZERO_TABLES, RESET_WIPE_TABLES } = require(path.join(root, 'apps/api/dist/backup/reset-data.js'));
const IS_PG = process.env.DD_DB === 'pg' || !!process.env.DATABASE_URL;
const c = makeChecks();
const { ok } = c;
const j = (r) => (r.raw ?? '').slice(0, 300);

function snapshot(dbPath) {
  const d = new Database(dbPath, { readonly: true });
  const all = (q) => d.prepare(q).all();
  const s = {
    tables: all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).map((r) => r.name),
    counts: {},
    products: JSON.stringify(all(`SELECT * FROM products ORDER BY id`)),
    barcodes: JSON.stringify(all(`SELECT * FROM product_barcodes ORDER BY barcode`)),
    packs: JSON.stringify(all(`SELECT * FROM product_packs ORDER BY id`)),
    users: JSON.stringify(all(`SELECT * FROM users ORDER BY id`)),
    roles: JSON.stringify(all(`SELECT * FROM roles ORDER BY id`)),
    staff: JSON.stringify(all(`SELECT * FROM staff ORDER BY id`)),
    store: JSON.stringify(all(`SELECT * FROM store`)),
    seq: JSON.stringify(all(`SELECT * FROM barcode_seq`)),
    stockTotal: d.prepare(`SELECT COALESCE(SUM(qty_on_hand),0) s FROM stock_balances`).get().s,
    stockRows: d.prepare(`SELECT COUNT(*) c FROM stock_balances`).get().c,
    audit: all(`SELECT action FROM audit_log ORDER BY created_at`).map((r) => r.action),
  };
  for (const t of s.tables) s.counts[t] = d.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
  d.close();
  return s;
}

async function resetAndCheck(api, owner, cashier, label) {
  const R = api.request;
  const before = snapshot(api.dbPath);
  // every table classified exactly once
  const lists = [...RESET_KEEP_TABLES, ...RESET_ZERO_TABLES, ...RESET_WIPE_TABLES];
  ok(new Set(lists).size === lists.length, `${label}: no table listed twice`);
  const missing = before.tables.filter((t) => !lists.includes(t));
  ok(missing.length === 0, `${label}: every table classified (${missing})`);
  const busy = RESET_WIPE_TABLES.filter((t) => before.counts[t] > 0);
  ok(busy.length >= 10 && before.stockTotal > 0, `${label}: data to wipe in ${busy.length} tables (${busy.join(',')}), stock ${before.stockTotal}`);

  // guards
  ok((await R('POST', '/settings/reset-data', { body: { confirm: 'RESET' } })).status === 401, `${label}: no session 401`);
  ok((await R('POST', '/settings/reset-data', { token: cashier, body: { confirm: 'RESET' } })).status === 403, `${label}: cashier 403`);
  ok((await R('POST', '/settings/reset-data', { token: owner, body: { confirm: 'reset please' } })).status === 400, `${label}: wrong word 400`);
  ok(JSON.stringify(snapshot(api.dbPath).counts) === JSON.stringify(before.counts), `${label}: refused calls changed nothing`);

  const r = await R('POST', '/settings/reset-data', { token: owner, body: { confirm: 'RESET' } });
  ok(r.status === 200 && r.json?.ok, `${label}: reset ok ${j(r)}`);
  const dir = path.join(path.dirname(api.dbPath), 'reset-backups');
  ok(r.json.backup_file.startsWith(dir) && fs.existsSync(r.json.backup_file) && fs.existsSync(r.json.backup_db_file), `${label}: backup files written ${r.json.backup_file}`);
  const bundle = JSON.parse(fs.readFileSync(r.json.backup_file, 'utf8'));
  ok(bundle.header?.schema_version === 16 && bundle.products?.length === before.counts.products && JSON.stringify(bundle).length > 1000, `${label}: backup is a normal v16 copy`);
  if (IS_PG) {
    // Lite: full copy is a pg_dump file (.ddpro). Check the header; the full restore is exercised after the reset.
    const head = fs.readFileSync(r.json.backup_db_file).subarray(0, 5).toString('latin1');
    ok(r.json.backup_db_file.endsWith('.ddpro') && head === 'PGDMP', `${label}: .ddpro full copy written (${head})`);
  } else {
    const bdb = new Database(r.json.backup_db_file, { readonly: true });
    ok(bdb.prepare('SELECT COUNT(*) c FROM sales').get().c === before.counts.sales && bdb.pragma('integrity_check', { simple: true }) === 'ok', `${label}: SQLite copy has the old sales`);
    bdb.close();
  }
  const fullCopy = r.json.backup_db_file;
  fs.rmSync(r.json.backup_file, { force: true });

  const after = snapshot(api.dbPath);
  for (const k of ['products', 'barcodes', 'packs', 'users', 'roles', 'staff', 'store', 'seq']) ok(after[k] === before[k], `${label}: ${k} unchanged`);
  for (const t of RESET_KEEP_TABLES) if (t !== 'auth_throttle' && t !== 'auto_backup') ok(after.counts[t] === before.counts[t], `${label}: kept ${t} ${after.counts[t]}`);
  const left = RESET_WIPE_TABLES.filter((t) => t !== 'audit_log' && after.counts[t] !== 0);
  ok(left.length === 0, `${label}: all activity tables empty (${left})`);
  ok(after.audit.join() === 'backup.export,data.reset', `${label}: audit has only the backup + reset entry ${after.audit}`);
  ok(after.stockTotal === 0 && after.stockRows === before.stockRows, `${label}: stock 0 for every row`);
  ok(Object.values(r.json.wiped).reduce((a, b) => a + b, 0) > 0, `${label}: wiped counts returned`);

  // still signed in; new purchase and sale work
  const p = JSON.parse(after.products).find((x) => x.active === 1 && x.product_type !== 'bulk' && x.product_type !== 'packed' && x.unit_label !== 'kg');
  let s = await R('POST', '/suppliers', { token: owner, body: { name: 'New Supplier After Reset' } });
  ok(s.json?.supplier?.id, `${label}: new supplier ${j(s)}`);
  let x = await R('POST', '/purchases', { token: owner, body: { supplierId: s.json.supplier.id, lines: [{ productId: p.id, pieces: 10, unitCostRs: 10, lineTotalRs: 100 }] } });
  ok(x.status === 201 || x.json?.ok, `${label}: purchase after reset ${j(x)}`);
  let st = snapshot(api.dbPath);
  ok(st.stockTotal === 10, `${label}: stock 10 after purchase`);
  x = await R('POST', '/sales', { token: cashier, body: { paymentMethod: 'cash', clientDeviceAt: new Date().toISOString(), lines: [{ productId: p.id, qty: 2, unit: p.unit_label === 'kg' ? 'kg' : 'piece' }] } });
  ok(x.status === 201 && x.json?.ok, `${label}: sale after reset ${j(x)}`);
  st = snapshot(api.dbPath);
  ok(st.stockTotal === 8 && st.counts.sales === 1, `${label}: one sale, stock 8`);
  const po = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: s.json.supplier.id, lines: [{ productId: p.id, qty: 5 }] } });
  ok(po.json?.order?.number === 1 || po.json?.purchaseOrder?.number === 1 || /"number":1\b/.test(po.raw), `${label}: purchase order numbers start at 1 ${j(po)}`);
  if (IS_PG && process.env.OWNER_PIN_FOR_RESTORE !== 'skip') {
    // Full restore from the safety copy brings every sale back (Owner + PIN), with a new safety copy first.
    const pin = label === 'demo' ? (process.env.DEMO_PIN ?? '2468') : '2468';
    const bad = await R('POST', '/backup/db/restore', { token: owner, body: { pin: '0000', path: fullCopy } });
    ok(bad.status === 401, `${label}: wrong PIN refused ${bad.status}`);
    const notCopy = await R('POST', '/backup/db/restore', { token: owner, body: { pin, path: r.json.backup_file } });
    ok(notCopy.status === 400, `${label}: non-.ddpro refused ${notCopy.status}`);
    const listed = await R('GET', '/backup/db', { token: owner });
    ok(listed.json?.files?.some((f) => f.path === fullCopy), `${label}: copy listed in GET /backup/db`);
    const rs = await R('POST', '/backup/db/restore', { token: owner, body: { pin, path: fullCopy } });
    ok(rs.status === 201 && rs.json?.ok && fs.existsSync(rs.json.safety_file), `${label}: full restore ok ${j(rs)}`);
    const back = snapshot(api.dbPath);
    ok(back.counts.sales === before.counts.sales && back.stockTotal === before.stockTotal, `${label}: restore brought back ${back.counts.sales} sales, stock ${back.stockTotal}`);
    console.log(`${label}: full restore ok, ${back.counts.sales} sales back`);
    fs.rmSync(rs.json.safety_file, { force: true });
  }
  fs.rmSync(fullCopy, { force: true });
  return r.json;
}

// 1. Fresh shop with activity everywhere we can reach through the API.
{
  const api = await startApi('resetdata', Number(process.env.API_PORT ?? 3971));
  const R = api.request;
  try {
    const s = await seed(api, { cashierRefunds: true });
    const { owner, cashier, atta, daal, soap, rashid } = s;
    await R('PATCH', `/catalog/products/${soap.id}`, { token: owner, body: { extraBarcodes: ['8964000074008'], priceRs: 125 } });
    const sale = await s.sell(cashier, { paymentMethod: 'cash', clientDeviceAt: new Date().toISOString(), lines: [{ productId: atta.id, qty: 2, unit: 'piece' }, { productId: daal.id, qty: 3, unit: 'piece' }] });
    await s.sell(cashier, { paymentMethod: 'udhaar', partyId: rashid.id, clientDeviceAt: new Date().toISOString(), lines: [{ productId: soap.id, qty: 1, unit: 'piece' }] });
    const sd = (await R('GET', `/sales/${sale.id}`, { token: owner })).json;
    const line = (sd.sale?.lines ?? sd.lines)[0];
    let r = await R('POST', '/returns', { token: cashier, body: { saleId: sale.id, lines: [{ saleLineId: line.id, qty: 1 }] } });
    ok(r.json?.ok, `return ${j(r)}`);
    const sup = (await R('GET', '/suppliers', { token: owner })).json.items[0];
    r = await R('POST', '/purchases', { token: owner, body: { supplierId: sup.id, lines: [{ productId: daal.id, pieces: 20, unitCostRs: 200, lineTotalRs: 4000 }] } });
    ok(r.status === 201 || r.json?.ok, `purchase ${j(r)}`);
    r = await R('POST', '/purchase-orders', { token: owner, body: { supplierId: sup.id, lines: [{ productId: atta.id, qty: 5 }] } });
    ok(r.json?.ok !== false, `po ${j(r)}`);
    r = await R('POST', '/expenses', { token: owner, body: { kind: 'bill', amountRs: 30, note: 'tea' } });
    ok(r.json?.ok, `expense ${j(r)}`);
    r = await R('POST', '/stock/counts/quick', { token: owner, body: { productId: soap.id, countedQty: 90, reasonCode: 'damaged' } });
    ok(r.json?.ok !== false, `quick count ${j(r)}`);
    // backup fails -> nothing deleted
    api.stop();
    await new Promise((res) => setTimeout(res, 500));
    const blocker = `${api.dbPath}.not-a-dir`;
    fs.writeFileSync(blocker, 'x');
    const before = snapshot(api.dbPath);
    const bad = await startApiOn(api.dbPath, Number(process.env.API_PORT ?? 3971) + 5, { RESET_BACKUP_DIR: path.join(blocker, 'sub'), SESSION_SECRET: 'resetdata-secret' });
    try {
      r = await bad.request('POST', '/settings/reset-data', { token: owner, body: { confirm: 'RESET' } });
      ok(r.status === 500 && r.json?.code === 'backup_failed', `backup failure aborts ${j(r)}`);
      const after = snapshot(api.dbPath);
      const diff = Object.keys(before.counts).filter((t) => before.counts[t] !== after.counts[t]).map((t) => `${t}:${before.counts[t]}->${after.counts[t]}`);
      ok(RESET_WIPE_TABLES.every((t) => after.counts[t] >= before.counts[t]) && after.stockTotal === before.stockTotal && after.counts.sales === before.counts.sales, `nothing deleted when backup fails ${diff}`);
    } finally {
      bad.stop();
      fs.rmSync(blocker, { force: true });
    }
    await new Promise((res) => setTimeout(res, 500));
    const good = await startApiOn(api.dbPath, Number(process.env.API_PORT ?? 3971) + 6, { SESSION_SECRET: 'resetdata-secret' });
    try {
      const w = await resetAndCheck(good, owner, cashier, 'fresh');
      console.log('fresh wiped:', JSON.stringify(w.wiped));
    } finally {
      good.stop();
    }
  } finally {
    api.stop();
  }
}

// 2. Optional: a copy of a real demo database.
if (process.env.DEMO_DB) {
  const api = await startApi('resetdemo', Number(process.env.API_PORT ?? 3971) + 1);
  const R = api.request;
  try {
    api.stop();
    await new Promise((res) => setTimeout(res, 500));
    const src = new Database(process.env.DEMO_DB, { readonly: true });
    await src.backup(api.dbPath);
    src.close();
    for (const sfx of ['-wal', '-shm']) if (fs.existsSync(api.dbPath + sfx)) fs.unlinkSync(api.dbPath + sfx);
    const api2 = await startApiOn(api.dbPath, Number(process.env.API_PORT ?? 3971) + 2);
    try {
      const users = (await api2.request('GET', '/auth/users')).json.users;
      const ownerU = users.find((u) => u.role === 'owner');
      const login = await api2.request('POST', '/auth/login', { body: { userId: ownerU.id, pin: process.env.DEMO_PIN ?? '2468' } });
      ok(login.json?.sessionToken, `demo owner login ${j(login)}`);
      const owner = login.json.sessionToken;
      const cr = await api2.request('POST', '/owner/staff/cashiers', { token: owner, body: { displayName: 'Reset Test Cashier', pin: '9753' } });
      const cl = await api2.request('POST', '/auth/login', { body: { userId: cr.json.user.id, pin: '9753' } });
      const w = await resetAndCheck(api2, owner, cl.json.sessionToken, 'demo');
      console.log('demo wiped:', JSON.stringify(w.wiped), 'stock rows zeroed', w.stock_rows_zeroed, 'kept', JSON.stringify(w.kept));
    } finally {
      api2.stop();
    }
  } finally {
    /* first api already stopped */
  }
}

/** Start the API on an existing DB file (harness only knows fresh files). */
async function startApiOn(dbPath, port, extraEnv = {}) {
  const { spawn } = await import('node:child_process');
  const http = await import('node:http');
  const apiCwd = path.join(root, 'apps/api');
  const child = spawn('node', [path.join(apiCwd, 'dist/main.js')], {
    cwd: apiCwd,
    env: { ...process.env, API_PORT: String(port), SQLITE_PATH: dbPath, SESSION_SECRET: 'resetdemo-secret', TAX_PROCESS_INTERVAL_MS: '0', AUTO_BACKUP_INTERVAL_MS: '0', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[api2] ${d}`));
  function request(method, urlPath, { body, token } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : null;
      const headers = {};
      if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
      if (token) headers['x-dd-session'] = token;
      const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
        let raw = '';
        res.on('data', (ch) => (raw += ch));
        res.on('end', () => { let json = null; try { json = raw ? JSON.parse(raw) : null; } catch { /* */ } resolve({ status: res.statusCode, json, raw }); });
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
  return { dbPath, request, stop: () => child.kill('SIGTERM') };
}

console.log(`test-reset-data: PASS ${c.passed} checks`);
