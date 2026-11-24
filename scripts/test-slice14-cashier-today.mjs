#!/usr/bin/env node
/**
 * Slice 14 smoke: Cashier Today counts non-voided only; voided excluded;
 * cashier still 403 on /analytics; Owner hub no Enqueue/Drain on primary.
 *
 * Tax V1 (D30 LOCK): FBR is out — there is no tax-doc void path. The voided
 * sale is marked directly in SQLite (stand-in for the later commercial Void
 * slice) so the "Today excludes voided" contract stays covered. Also asserts
 * /sales never queues a tax document.
 *
 * Run:  node scripts/test-slice14-cashier-today.mjs
 * Or:   pnpm test:slice14
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
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));
const Database = require('better-sqlite3');

const API_PORT = Number(process.env.API_PORT ?? 3864);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice14-${Date.now()}.sqlite`);

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

console.log('=== DukaanDesk Slice 14 smoke (Cashier Today + Owner hub) ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
console.log('migrations:', mig);

// --- Grep smoke: Owner primary surfaces must not have Enqueue/Drain stubs ---
const webSrc = path.join(root, 'apps/web/src');
let grepOut = '';
try {
  grepOut = execSync(
    `grep -rn "Enqueue stub\\|Drain simulate" "${webSrc}" --include='*.tsx' --include='*.ts' || true`,
    { encoding: 'utf8' },
  );
} catch (e) {
  grepOut = e.stdout ?? '';
}
assert(
  !grepOut.trim(),
  `Owner hub still has Enqueue/Drain stubs:\n${grepOut}`,
);
const ownerShell = path.join(webSrc, 'features/owner/OwnerShell.tsx');
assert(
  !fs.existsSync(ownerShell),
  'OwnerShell.tsx scaffold must be removed',
);
const appTsx = fs.readFileSync(path.join(webSrc, 'app/App.tsx'), 'utf8');
assert(
  !appTsx.includes('Enqueue stub') && !appTsx.includes('Drain simulate'),
  'App.tsx must not contain Enqueue/Drain stubs',
);
assert(
  !appTsx.includes('scaffoldNote'),
  'App.tsx must not use scaffoldNote',
);
console.log('grep smoke OK — no Enqueue/Drain on Owner primary');

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
    SESSION_SECRET: 'slice14-smoke-secret',
    TAX_MODE: 'simulate',
    TAX_PROCESS_INTERVAL_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const OWNER_PIN = '2468';
const CASHIER_PIN = '5678';
const DISPLAY = 'Slice14 Owner';
const CASHIER_NAME = 'Slice14 Cashier';
const PRODUCT = 'Slice14 Atta 5kg';
const CLIENT_AT = '2026-10-01T22:30:00.000+05:00';

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: OWNER_PIN, storeName: 'Slice14 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const ownerToken = setup.json.sessionToken;
  assert(ownerToken, 'owner sessionToken');
  console.log('setup ok');

  const created = await request('POST', '/owner/staff/cashiers', {
    token: ownerToken,
    body: { displayName: CASHIER_NAME, pin: CASHIER_PIN },
  });
  assert(
    created.json?.ok === true,
    `create cashier: ${JSON.stringify(created.json)}`,
  );
  const cashierId = created.json.user.id;

  const prod = await request('POST', '/catalog/products', {
    token: ownerToken,
    body: { name: PRODUCT, priceRs: 100, unit: 'piece', piecesPerCarton: 1 },
  });
  assert(prod.json?.ok === true, `product: ${JSON.stringify(prod.json)}`);
  const productId = prod.json.product.id;

  const recv = await request('POST', '/stock/receive', {
    token: ownerToken,
    body: { productId, qty: 20, unit: 'piece' },
  });
  assert(recv.json?.ok === true, `receive: ${JSON.stringify(recv.json)}`);

  const cashLogin = await request('POST', '/auth/login', {
    body: { userId: cashierId, pin: CASHIER_PIN },
  });
  assert(
    cashLogin.json?.ok === true,
    `cashier login: ${JSON.stringify(cashLogin.json)}`,
  );
  const cashToken = cashLogin.json.sessionToken;
  assert(cashToken, 'cashier token');
  console.log('cashier login ok');

  // Cashier still 403 on full Owner analytics
  const denied = await request('GET', '/analytics', { token: cashToken });
  assert(
    denied.status === 403,
    `cashier analytics → 403, got ${denied.status} ${denied.raw?.slice(0, 200)}`,
  );
  console.log('cashier /analytics → 403');

  // Two cash sales (100 Rs each)
  const sale1 = await request('POST', '/sales', {
    token: cashToken,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 1, unit: 'piece' }],
    },
  });
  assert(
    sale1.status === 201 && sale1.json?.ok === true,
    `sale1: ${sale1.status} ${JSON.stringify(sale1.json)}`,
  );
  assert(sale1.json.sale.totalPaisa === 10000, 'sale1 10000 paisa');

  const sale2 = await request('POST', '/sales', {
    token: cashToken,
    body: {
      paymentMethod: 'cash',
      clientDeviceAt: CLIENT_AT,
      lines: [{ productId, qty: 2, unit: 'piece' }],
    },
  });
  assert(
    sale2.status === 201 && sale2.json?.ok === true,
    `sale2: ${sale2.status} ${JSON.stringify(sale2.json)}`,
  );
  assert(sale2.json.sale.totalPaisa === 20000, 'sale2 20000 paisa');
  console.log('seeded 2 cash sales (100 + 200 Rs)');

  // GET /cashier/today — non-voided count + total
  const today = await request('GET', '/cashier/today', { token: cashToken });
  assert(today.status === 200, `today status ${today.status}: ${today.raw?.slice(0, 200)}`);
  const t = today.json;
  assert(t?.timezone === 'Asia/Karachi', `timezone: ${t?.timezone}`);
  assert(t.sale_count === 2, `sale_count=${t.sale_count} expected 2`);
  assert(t.total_paisa === 30000, `total_paisa=${t.total_paisa} expected 30000`);
  assert(Array.isArray(t.sales), 'sales array');
  assert(t.sales.length === 2, `sales list length ${t.sales.length}`);
  assert(
    !('cost' in t) && !('margin' in t) && !('profit' in t),
    'must not expose cost/margin/profit',
  );
  assert(
    !('low_stock' in t) && !('udhaar_outstanding_paisa' in t),
    'must not expose Owner analytics fields',
  );
  console.log('cashier today: count=2 total=30000 paisa');

  // Alias /sales/today also works for cashier
  const todayAlias = await request('GET', '/sales/today', { token: cashToken });
  assert(todayAlias.status === 200, `sales/today status ${todayAlias.status}`);
  assert(todayAlias.json?.sale_count === 2, 'sales/today count');
  assert(todayAlias.json?.total_paisa === 30000, 'sales/today total');

  // Owner can also call /cashier/today
  const ownerToday = await request('GET', '/cashier/today', {
    token: ownerToken,
  });
  assert(ownerToday.status === 200, `owner today ${ownerToday.status}`);
  assert(ownerToday.json?.sale_count === 2, 'owner sees same count');

  // FBR out: no tax documents were queued for these sales.
  {
    const ro = new Database(dbPath, { readonly: true });
    const docs = ro
      .prepare(`SELECT COUNT(*) AS n FROM tax_documents`)
      .get().n;
    ro.close();
    assert(docs === 0, `no tax_documents after sales, got ${docs}`);
  }

  // Void one sale. No void API without FBR docs (commercial Void slice later),
  // so mark it the way a void does: voided_at set on the sale row.
  const voidedSaleId = sale1.json.sale.id;
  const voidedTotal = Number(sale1.json.sale.totalPaisa);
  {
    const rw = new Database(dbPath);
    const info = rw
      .prepare(`UPDATE sales SET voided_at = ? WHERE id = ? AND voided_at IS NULL`)
      .run(new Date().toISOString(), voidedSaleId);
    rw.close();
    assert(info.changes === 1, 'voided one sale row');
  }
  console.log(`voided sale ${voidedSaleId} (${voidedTotal} paisa) directly in SQLite`);

  // Today excludes voided — remaining = 30000 − voided
  const expectedTotal = 30000 - voidedTotal;
  const afterVoid = await request('GET', '/cashier/today', { token: cashToken });
  assert(afterVoid.status === 200, `after void status ${afterVoid.status}`);
  assert(
    afterVoid.json.sale_count === 1,
    `after void count=${afterVoid.json.sale_count} expected 1`,
  );
  assert(
    afterVoid.json.total_paisa === expectedTotal,
    `after void total=${afterVoid.json.total_paisa} expected ${expectedTotal}`,
  );
  assert(
    (afterVoid.json.sales ?? []).every((s) => s.id !== voidedSaleId),
    'voided sale must not appear in list',
  );
  assert(
    (afterVoid.json.sales ?? []).some((s) => s.total_paisa === expectedTotal),
    `remaining sale ${expectedTotal} paisa in list`,
  );
  console.log(`voided excluded: count=1 total=${expectedTotal} paisa`);

  // Cashier still 403 on /analytics after void
  const denied2 = await request('GET', '/analytics', { token: cashToken });
  assert(denied2.status === 403, `cashier analytics still 403, got ${denied2.status}`);

  console.log('SLICE14 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE14 SMOKE FAIL', err);
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
