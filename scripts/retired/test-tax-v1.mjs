#!/usr/bin/env node
/**
 * Tax V1 smoke (D30 LOCK — simple Sales Tax, NO FBR).
 *
 *  - R1: fresh DB → Sales Tax OFF; sale has no tax snapshot; no tax docs.
 *  - Settings → Store: Owner-only switch + rate %, rate > 0 required for ON,
 *    invalid rate refused, cashier 403, audit_log tax_setting_changed.
 *  - R2: ON → inclusive per-line extraction, half-up paisa; total unchanged
 *    (AC-4/5/6/9 worked values at 17% and 18%).
 *  - Snapshot survives turning tax OFF; analytics sums from the snapshot.
 *  - FBR out: /sales never queues tax_documents; process-next dormant.
 *  - Backup export/restore keeps tax fields; pre-028 bundle restores OFF/0.
 *
 * Run:  node scripts/test-tax-v1.mjs   (or pnpm test:tax-v1)
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

const API_PORT = Number(process.env.API_PORT ?? 3871);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-taxv1-${Date.now()}.sqlite`);

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


function db(readonly = true) {
  return new Database(dbPath, { readonly });
}
function taxDocCount() {
  const d = db();
  const n = d.prepare(`SELECT COUNT(*) AS n FROM tax_documents`).get().n;
  d.close();
  return n;
}

console.log('=== DukaanDesk Tax V1 smoke (simple Sales Tax, no FBR) ===');
for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
console.log('migrations:', migrate(dbPath));

const apiCwd = path.join(root, 'apps/api');
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

// --- Pure helper: worked values from the RE (AC-4 / AC-5) ---
{
  const { extractInclusive, percentToRateBp, rateBpToPercentText } = require(
    path.join(apiCwd, 'dist/tax/inclusive.js'),
  );
  const cases = [
    [10000, 1700, 1453, 8547],
    [10800, 1700, 1569, 9231],
    [4500, 1700, 654, 3846],
    [999, 1700, 145, 854],
    [1, 1700, 0, 1],
    [10050, 1700, 1460, 8590],
    [100, 1700, 15, 85],
    [10000, 1800, 1525, 8475],
    [10000, 0, 0, 10000],
  ];
  for (const [L, r, tax, base] of cases) {
    const got = extractInclusive(L, r);
    assert(
      got.taxPaisa === tax && got.basePaisa === base,
      `extract ${L}@${r}: got ${JSON.stringify(got)} want tax ${tax} base ${base}`,
    );
  }
  assert(percentToRateBp('17') === 1700, 'percent 17');
  assert(percentToRateBp('17.5') === 1750, 'percent 17.5');
  assert(percentToRateBp('17.555') === null, 'percent 3dp refused');
  assert(percentToRateBp('101') === null, 'percent >100 refused');
  assert(rateBpToPercentText(1750) === '17.5', 'rate text');
  console.log('inclusive helper worked values OK');
}

const child = spawn('node', [path.join(apiCwd, 'dist/main.js')], {
  cwd: apiCwd,
  env: {
    ...process.env,
    API_PORT: String(API_PORT),
    SQLITE_PATH: dbPath,
    SESSION_SECRET: 'taxv1-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const OWNER_PIN = '2468';
const CASHIER_PIN = '5678';

async function product(token, name, priceRs, extra = {}) {
  const r = await request('POST', '/catalog/products', {
    token,
    body: { name, priceRs, unit: 'piece', piecesPerCarton: 1, ...extra },
  });
  assert(r.json?.ok === true, `product ${name}: ${JSON.stringify(r.json)}`);
  const id = r.json.product.id;
  // Seed on-hand directly (receive now needs supplier + cost — not under test here).
  const d = db(false);
  d.prepare(
    `INSERT INTO stock_balances (product_id, qty_on_hand) VALUES (?, 100)
     ON CONFLICT(product_id) DO UPDATE SET qty_on_hand = 100`,
  ).run(id);
  d.close();
  return id;
}

async function sell(token, lines, extra = {}) {
  const r = await request('POST', '/sales', {
    token,
    body: {
      paymentMethod: 'cash',
      lines: lines.map(([productId, qty]) => ({ productId, qty, unit: 'piece' })),
      ...extra,
    },
  });
  assert(
    r.status === 201 && r.json?.ok === true,
    `sale: ${r.status} ${JSON.stringify(r.json)}`,
  );
  assert(r.json.tax === undefined, 'FBR out — no tax queue status on /sales');
  return r.json.sale;
}

try {
  await waitHealth();
  const setup = await request('POST', '/auth/setup', {
    body: { displayName: 'Tax Owner', pin: OWNER_PIN, storeName: 'Tax Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;

  const cashier = await request('POST', '/owner/staff/cashiers', {
    token,
    body: { displayName: 'Tax Cashier', pin: CASHIER_PIN },
  });
  assert(cashier.json?.ok === true, `cashier: ${JSON.stringify(cashier.json)}`);
  const cashLogin = await request('POST', '/auth/login', {
    body: { userId: cashier.json.user.id, pin: CASHIER_PIN },
  });
  const cashToken = cashLogin.json.sessionToken;
  assert(cashToken, 'cashier token');

  // --- AC-1: fresh DB → OFF ---
  const s0 = await request('GET', '/settings/store', { token });
  assert(s0.json?.store?.sales_tax_enabled === false, 'fresh store tax OFF');
  assert(s0.json.store.sales_tax_rate_bp === 0, 'fresh rate 0');
  console.log('AC-1 fresh store: Sales Tax OFF, rate 0');

  const p100 = await product(token, 'Tax Atta', 100);
  const p45 = await product(token, 'Tax Soap', 45);
  const p3350 = await product(token, 'Tax Chips', 33.5);
  const p999 = await product(token, 'Tax Toffee', 9.99);
  const p1 = await product(token, 'Tax Matchbox', 1);
  const p120 = await product(token, 'Tax Ghee', 120, {
    discount: { kind: 'percent', percent: 10 },
  });

  // --- AC-3: OFF sale ---
  const off = await sell(cashToken, [[p100, 1], [p45, 1]]);
  assert(off.totalPaisa === 14500, `OFF total ${off.totalPaisa}`);
  assert(off.taxEnabled === false, 'OFF snapshot taxEnabled false');
  assert(off.taxPaisa === 0 && off.taxRateBp === 0, 'OFF tax 0');
  assert(off.taxBasePaisa === null, 'OFF base null');
  assert(off.lines.every((l) => l.taxPaisa === 0), 'OFF line tax 0');
  assert(taxDocCount() === 0, 'OFF: no tax_documents');
  console.log('AC-3 OFF sale: total 14500, no tax snapshot, no tax docs');

  // --- AC-12: toggle guards ---
  const noRate = await request('PATCH', '/settings/store', {
    token,
    body: { sales_tax_enabled: true },
  });
  assert(noRate.status === 400, `ON without rate → 400, got ${noRate.status}`);
  assert(noRate.json?.code === 'tax_rate_required', `code ${JSON.stringify(noRate.json)}`);
  const badRate = await request('PATCH', '/settings/store', {
    token,
    body: { sales_tax_enabled: true, sales_tax_rate_percent: '17.555' },
  });
  assert(badRate.status === 400 && badRate.json?.code === 'invalid_tax_rate', 'bad rate → 400');
  const cashPatch = await request('PATCH', '/settings/store', {
    token: cashToken,
    body: { sales_tax_enabled: true, sales_tax_rate_percent: 17 },
  });
  assert(cashPatch.status === 403, `cashier PATCH → 403, got ${cashPatch.status}`);
  const s1 = await request('GET', '/settings/store', { token });
  assert(s1.json.store.sales_tax_enabled === false, 'still OFF after refused patches');

  const on = await request('PATCH', '/settings/store', {
    token,
    body: { sales_tax_enabled: true, sales_tax_rate_percent: '17' },
  });
  assert(on.status === 200 && on.json?.store?.sales_tax_enabled === true, `ON: ${JSON.stringify(on.json)}`);
  assert(on.json.store.sales_tax_rate_bp === 1700, 'rate 1700 bp');
  assert(on.json.store.sales_tax_rate_percent === 17, 'rate 17%');
  {
    const d = db();
    const rows = d
      .prepare(`SELECT payload_json FROM audit_log WHERE action = 'tax_setting_changed' ORDER BY created_at`)
      .all();
    d.close();
    assert(rows.length === 1, `one audit row, got ${rows.length}`);
    const p = JSON.parse(rows[0].payload_json);
    assert(p.from.sales_tax_enabled === false && p.to.sales_tax_enabled === true, 'audit from→to');
    assert(p.to.sales_tax_rate_bp === 1700, 'audit rate');
  }
  // Non-tax patch must not write a tax audit row
  await request('PATCH', '/settings/store', { token, body: { phone: '0300' } });
  console.log('AC-12 toggle: rate required, invalid refused, cashier 403, audit row');

  // --- AC-4: 1 × Rs 100 @17% ---
  const s100 = await sell(cashToken, [[p100, 1]]);
  assert(s100.totalPaisa === 10000, 'ON total unchanged 10000');
  assert(s100.taxEnabled === true && s100.taxRateBp === 1700, 'ON snapshot');
  assert(s100.taxPaisa === 1453, `tax 1453 got ${s100.taxPaisa}`);
  assert(s100.taxBasePaisa === 8547, `base 8547 got ${s100.taxBasePaisa}`);
  console.log('AC-4 Rs 100 @17%: tax 14.53, base 85.47, total 100.00');

  // --- AC-5: multi-line per-line rounding ---
  const multi = await sell(cashToken, [[p45, 1], [p3350, 3], [p999, 1]]);
  assert(multi.totalPaisa === 15549, `multi total ${multi.totalPaisa}`);
  assert(
    JSON.stringify(multi.lines.map((l) => l.taxPaisa)) === JSON.stringify([654, 1460, 145]),
    `line taxes ${JSON.stringify(multi.lines.map((l) => l.taxPaisa))}`,
  );
  assert(multi.taxPaisa === 2259 && multi.taxBasePaisa === 13290, 'multi tax 2259 base 13290');
  {
    const d = db();
    const sum = d
      .prepare(`SELECT SUM(tax_paisa) AS t, MIN(tax_rate_bp) AS r FROM sale_lines WHERE sale_id = ?`)
      .get(multi.id);
    const row = d
      .prepare(`SELECT tax_enabled, tax_rate_bp, tax_paisa, tax_base_paisa, total_paisa FROM sales WHERE id = ?`)
      .get(multi.id);
    d.close();
    assert(sum.t === 2259 && sum.r === 1700, `stored line tax ${JSON.stringify(sum)}`);
    assert(
      row.tax_enabled === 1 && row.tax_paisa === 2259 && row.tax_base_paisa + row.tax_paisa === row.total_paisa,
      `stored sale snapshot ${JSON.stringify(row)}`,
    );
  }
  const ones = await sell(cashToken, [[p1, 1], [p1, 1], [p1, 1]]);
  assert(ones.taxPaisa === 45, `3 × Rs1 per-line tax 45, got ${ones.taxPaisa}`);
  console.log('AC-5 per-line: 654+1460+145 = 2259; 3×Rs1 → 45');

  // --- AC-6: discount ---
  const disc = await sell(cashToken, [[p120, 1]], {
    lines: [{ productId: p120, qty: 1, unit: 'piece', expectedUnitPricePaisa: 10800 }],
  });
  assert(disc.lines[0].unitPricePaisa === 10800, 'discounted unit 10800');
  assert(disc.taxPaisa === 1569 && disc.taxBasePaisa === 9231, `disc tax ${disc.taxPaisa}`);
  console.log('AC-6 discount: Rs 108 → tax 15.69');

  // --- AC-9: udhaar + split — same snapshot, total unchanged ---
  const ud = await sell(cashToken, [[p100, 1]], { paymentMethod: 'udhaar' });
  assert(ud.udhaarAmountPaisa === 10000 && ud.taxPaisa === 1453, 'udhaar snapshot');
  const sp = await sell(cashToken, [[p100, 1]], {
    paymentMethod: 'split',
    cashAmountPaisa: 6000,
    udhaarAmountPaisa: 4000,
  });
  assert(sp.cashAmountPaisa + sp.udhaarAmountPaisa === sp.totalPaisa, 'split = total');
  assert(sp.taxPaisa === 1453, 'split snapshot');
  console.log('AC-9 udhaar/split: tax 14.53, totals unchanged');

  // --- 18% ---
  const r18 = await request('PATCH', '/settings/store', {
    token,
    body: { sales_tax_rate_percent: 18 },
  });
  assert(r18.json?.store?.sales_tax_rate_bp === 1800, 'rate 18');
  const s18 = await sell(cashToken, [[p100, 1]]);
  assert(s18.taxPaisa === 1525 && s18.taxBasePaisa === 8475, `18%: ${s18.taxPaisa}`);
  console.log('18%: Rs 100 → tax 15.25');

  // --- FBR out ---
  assert(taxDocCount() === 0, 'ON: still no tax_documents');
  const pnCash = await request('POST', '/tax/process-next', { token: cashToken, body: {} });
  assert(pnCash.status === 403, `cashier process-next → 403, got ${pnCash.status}`);
  const pnOwner = await request('POST', '/tax/process-next', { token, body: {} });
  assert(pnOwner.json?.processed === false && pnOwner.json?.disabled === true, 'process-next dormant');
  const enq = await request('POST', '/tax/enqueue', { token, body: { saleId: s18.id } });
  assert(enq.json?.ok === false && enq.json?.error === 'fbr_disabled', 'enqueue dormant');
  assert(taxDocCount() === 0, 'still no tax_documents after dormant calls');
  console.log('FBR out: 0 tax docs; process-next/enqueue dormant; cashier 403');

  // --- AC-13: analytics from snapshot ---
  const an = await request('GET', '/analytics', { token });
  assert(an.status === 200, `analytics ${an.status}`);
  const td = an.json.today;
  const taxedSales = [s100, multi, ones, disc, ud, sp, s18];
  const wantTax = taxedSales.reduce((a, s) => a + s.taxPaisa, 0);
  const wantBase = taxedSales.reduce((a, s) => a + s.taxBasePaisa, 0);
  assert(td.taxed_sale_count === taxedSales.length, `taxed count ${td.taxed_sale_count}`);
  assert(td.tax_paisa === wantTax, `analytics tax ${td.tax_paisa} want ${wantTax}`);
  assert(td.tax_base_paisa === wantBase, `analytics base ${td.tax_base_paisa} want ${wantBase}`);
  assert(td.total_paisa === off.totalPaisa + taxedSales.reduce((a, s) => a + s.totalPaisa, 0), 'gross unchanged');
  assert(an.json.sales_tax_enabled === true, 'analytics sales_tax_enabled');
  console.log(`AC-13 analytics: ${td.taxed_sale_count} taxed sales, tax ${wantTax}`);

  // --- Backup round trip keeps tax fields ---
  const exp = await request('POST', '/backup/export', { token, body: { pin: OWNER_PIN } });
  assert(exp.status === 200 || exp.status === 201, `export ${exp.status}`);
  const bundle = exp.json;
  assert(bundle.store.sales_tax_enabled === 1 && bundle.store.sales_tax_rate_bp === 1800, 'export store tax');
  const bs = bundle.sales.find((s) => s.id === multi.id);
  assert(bs.tax_enabled === 1 && bs.tax_paisa === 2259 && bs.tax_base_paisa === 13290, 'export sale snapshot');
  assert(
    bundle.sale_lines.filter((l) => l.sale_id === multi.id).reduce((a, l) => a + l.tax_paisa, 0) === 2259,
    'export line tax',
  );

  // --- Toggle OFF: next sale clean; old snapshot intact ---
  const offPatch = await request('PATCH', '/settings/store', {
    token,
    body: { sales_tax_enabled: false },
  });
  assert(offPatch.json?.store?.sales_tax_enabled === false, 'OFF again');
  assert(offPatch.json.store.sales_tax_rate_bp === 1800, 'rate kept for next time');
  const after = await sell(cashToken, [[p100, 1]]);
  assert(after.taxEnabled === false && after.taxPaisa === 0 && after.taxBasePaisa === null, 'OFF after toggle');
  {
    const d = db();
    const old = d.prepare(`SELECT tax_enabled, tax_paisa FROM sales WHERE id = ?`).get(s100.id);
    const audits = d.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'tax_setting_changed'`).get().n;
    d.close();
    assert(old.tax_enabled === 1 && old.tax_paisa === 1453, 'old ON sale keeps snapshot (AC-8 reprint)');
    assert(audits === 3, `3 tax audit rows (ON, 18%, OFF), got ${audits}`);
  }
  console.log('toggle OFF: new sale clean, old snapshot kept, 3 audit rows');

  // Restore the ON-era bundle → tax fields come back exactly
  const rest = await request('POST', '/backup/restore', { token, body: { pin: OWNER_PIN, bundle } });
  assert(rest.status === 200 || rest.status === 201, `restore ${rest.status}: ${rest.raw?.slice(0, 200)}`);
  {
    const d = db();
    const st = d.prepare(`SELECT sales_tax_enabled, sales_tax_rate_bp FROM store`).get();
    const ms = d.prepare(`SELECT tax_enabled, tax_rate_bp, tax_paisa, tax_base_paisa FROM sales WHERE id = ?`).get(multi.id);
    const lt = d.prepare(`SELECT SUM(tax_paisa) AS t FROM sale_lines WHERE sale_id = ?`).get(multi.id).t;
    d.close();
    assert(st.sales_tax_enabled === 1 && st.sales_tax_rate_bp === 1800, `restored store ${JSON.stringify(st)}`);
    assert(ms.tax_enabled === 1 && ms.tax_rate_bp === 1700 && ms.tax_paisa === 2259 && ms.tax_base_paisa === 13290, 'restored sale');
    assert(lt === 2259, 'restored line tax');
  }

  // Pre-028 bundle (no tax keys) → OFF / 0
  const legacy = JSON.parse(JSON.stringify(bundle));
  delete legacy.store.sales_tax_enabled;
  delete legacy.store.sales_tax_rate_bp;
  for (const s of legacy.sales) {
    delete s.tax_enabled; delete s.tax_rate_bp; delete s.tax_paisa; delete s.tax_base_paisa;
  }
  for (const l of legacy.sale_lines) { delete l.tax_rate_bp; delete l.tax_paisa; }
  const rest2 = await request('POST', '/backup/restore', { token, body: { pin: OWNER_PIN, bundle: legacy } });
  assert(rest2.status === 200 || rest2.status === 201, `legacy restore ${rest2.status}: ${rest2.raw?.slice(0, 200)}`);
  {
    const d = db();
    const st = d.prepare(`SELECT sales_tax_enabled, sales_tax_rate_bp FROM store`).get();
    const taxed = d.prepare(`SELECT COUNT(*) AS n FROM sales WHERE tax_enabled = 1 OR tax_paisa <> 0`).get().n;
    const totals = d.prepare(`SELECT SUM(total_paisa) AS t FROM sales`).get().t;
    d.close();
    assert(st.sales_tax_enabled === 0 && st.sales_tax_rate_bp === 0, 'legacy restore → OFF / 0');
    assert(taxed === 0, 'legacy restore → no taxed sales');
    assert(totals === bundle.sales.reduce((a, s) => a + s.total_paisa, 0), 'legacy totals unchanged');
  }
  console.log('backup: export/restore keeps tax; pre-028 bundle → OFF / 0');

  // --- UI source markers (R3: no tax UI when OFF; FBR UI gone) ---
  const web = (p) => fs.readFileSync(path.join(root, 'apps/web/src', p), 'utf8');
  const receipt = web('features/pos/receipt.ts');
  assert(receipt.includes("fields.taxEnabled !== true) return null"), 'receipt: tax line only when snapshot ON');
  const appTsx = web('app/App.tsx');
  assert(!appTsx.includes('TaxQueueShell') && !appTsx.includes("'taxQueue'"), 'no Tax queue in Owner rail');
  const alerts = web('features/notifications/alerts.ts');
  assert(!alerts.includes('/tax/queue'), 'bell does not poll /tax/queue');
  const pos = web('features/pos/PosShell.tsx');
  assert(!pos.includes('/tax/by-sale'), 'Sell does not fetch /tax/by-sale');
  const settings = web('features/settings/SettingsShell.tsx');
  assert(!settings.includes('settingsTaxMode') && settings.includes('settingsSalesTax'), 'Settings: Sales Tax, no Tax mode');
  console.log('UI markers OK');

  console.log('TAX V1 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('TAX V1 SMOKE FAIL', err);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  setTimeout(() => {
    for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
    process.exit(process.exitCode ?? 0);
  }, 800);
}
