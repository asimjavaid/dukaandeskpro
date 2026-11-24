#!/usr/bin/env node
/**
 * (helpers copied from slice 14) Slice 14 smoke: Cashier Today counts non-voided only; voided excluded;
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));
const Database = require('better-sqlite3');

const API_PORT = Number(process.env.API_PORT ?? 3871);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-sales-list-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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


let passed = 0;
function ok(cond, msg) {
  assert(cond, msg);
  passed += 1;
}

console.log('=== DukaanDesk Sales screen API (GET /sales, GET /sales/:id) ===');
console.log('migrate →', dbPath);
for (const suffix of ['', '-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
ok(mig.applied.includes('029_slice35_sales_returns.sql'), 'migration 029 applied');

const apiCwd = path.join(root, 'apps/api');
const distMain = path.join(apiCwd, 'dist/main.js');
if (process.env.SKIP_BUILD !== '1') {
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
}

const child = spawn('node', [distMain], {
  cwd: apiCwd,
  env: {
    ...process.env,
    API_PORT: String(API_PORT),
    SQLITE_PATH: dbPath,
    SESSION_SECRET: 'sales-list-secret',
    TAX_PROCESS_INTERVAL_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

function karachiYmd(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
const q = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

try {
  await waitHealth();
  const setup = await request('POST', '/auth/setup', {
    body: { displayName: 'Asim Owner', pin: '2468', storeName: 'Sales Test Kiryana' },
  });
  ok(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const owner = setup.json.sessionToken;

  const created = await request('POST', '/owner/staff/cashiers', {
    token: owner,
    body: { displayName: 'Bilal Cashier', pin: '5678' },
  });
  ok(created.json?.ok === true, `cashier: ${JSON.stringify(created.json)}`);
  const cashLogin = await request('POST', '/auth/login', {
    body: { userId: created.json.user.id, pin: '5678' },
  });
  const cashier = cashLogin.json.sessionToken;
  ok(cashier, 'cashier token');

  const sup = await request('POST', '/suppliers', { token: owner, body: { name: 'Test Supplier' } });
  ok(sup.json?.ok === true, `supplier: ${JSON.stringify(sup.json)}`);
  const supplierId = sup.json.supplier.id;

  async function product(name, priceRs, barcode, unitLabel) {
    const r = await request('POST', '/catalog/products', {
      token: owner,
      body: { name, priceRs, unit: 'piece', piecesPerCarton: 1, barcode, unitLabel, ...(unitLabel === 'kg' ? { productType: 'normal' } : {}) },
    });
    assert(r.json?.ok === true, `product ${name}: ${JSON.stringify(r.json)}`);
    const rc = await request('POST', '/stock/receive', {
      token: owner,
      body: { productId: r.json.product.id, qty: 200, unit: 'piece', amountRs: priceRs * 150, supplierId },
    });
    assert(rc.json?.ok === true, `receive ${name}: ${JSON.stringify(rc.json)}`);
    return r.json.product;
  }
  const atta = await product('Sunny Atta 5kg', 1480, '8964000111222', 'packet');
  const daal = await product('Daal Masoor', 250, '8964000333444', 'kg');
  const soap = await product('Lux Soap', 120, undefined, 'piece');

  const pr = await request('POST', '/parties', {
    token: owner,
    body: { name: 'Rashid Bhai', phone: '0300-1234567' },
  });
  const rashid = pr.json.party;
  ok(rashid?.id, 'party created');

  async function sell(token, body) {
    const r = await request('POST', '/sales', { token, body });
    assert(r.status === 201 && r.json?.ok, `sale: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.sale;
  }
  // 1. cash walk-in: atta x1 = 1480, tendered 2000
  const s1 = await sell(cashier, {
    paymentMethod: 'cash',
    tenderedPaisa: 200000,
    lines: [{ productId: atta.id, qty: 1 }],
  });
  // 2. khata Rashid: daal x2 + soap x1 = 620
  const s2 = await sell(owner, {
    paymentMethod: 'udhaar',
    partyId: rashid.id,
    lines: [{ productId: daal.id, qty: 2 }, { productId: soap.id, qty: 1 }],
  });
  // 3. split Rashid: atta x1 + daal x1 = 1730; cash 1000 + khata 730
  const s3 = await sell(owner, {
    paymentMethod: 'split',
    partyId: rashid.id,
    cashAmountPaisa: 100000,
    udhaarAmountPaisa: 73000,
    lines: [{ productId: atta.id, qty: 1 }, { productId: daal.id, qty: 1 }],
  });
  // 4. cash Rashid overpay kept on khata: soap x2 = 240, tendered 500 → 260 kept
  const s4 = await sell(owner, {
    paymentMethod: 'cash',
    partyId: rashid.id,
    tenderedPaisa: 50000,
    applySurplusToKhata: true,
    lines: [{ productId: soap.id, qty: 2 }],
  });
  // 5. old sale (3 days ago) and 6. very old (45 days ago) — backdated in SQLite
  const s5 = await sell(owner, { paymentMethod: 'cash', lines: [{ productId: daal.id, qty: 4 }] });
  const s6 = await sell(owner, { paymentMethod: 'cash', lines: [{ productId: soap.id, qty: 5 }] });

  const now = new Date();
  const today = karachiYmd(now);
  const threeAgo = new Date(now.getTime() - 3 * 86400000);
  const old = new Date(now.getTime() - 45 * 86400000);
  {
    const rw = new Database(dbPath);
    rw.prepare(`UPDATE sales SET recorded_at = ? WHERE id = ?`).run(threeAgo.toISOString(), s5.id);
    rw.prepare(`UPDATE sales SET recorded_at = ? WHERE id = ?`).run(old.toISOString(), s6.id);
    // Removed bill (as the Remove slice will write it).
    rw.prepare(
      `UPDATE sales SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?`,
    ).run(new Date().toISOString(), setup.json.user?.id ?? null, 'Wrong items', s1.id);
    // A part return on s2 (daal 1 of 2) to check return_state / returned_qty.
    const line = rw
      .prepare(`SELECT id, unit_price_paisa FROM sale_lines WHERE sale_id = ? AND product_id = ?`)
      .get(s2.id, daal.id);
    rw.prepare(
      `INSERT INTO sale_returns (id, short_id, sale_id, party_id, total_paisa,
         refund_cash_paisa, refund_khata_paisa, client_device_at, recorded_at)
       VALUES ('ret-1', 'R0000001', ?, ?, ?, 0, ?, ?, ?)`,
    ).run(s2.id, rashid.id, line.unit_price_paisa, line.unit_price_paisa, now.toISOString(), now.toISOString());
    rw.prepare(
      `INSERT INTO sale_return_lines (id, return_id, sale_line_id, product_id, product_name,
         qty_pieces, unit_price_paisa, line_total_paisa)
       VALUES ('retl-1', 'ret-1', ?, ?, 'Daal Masoor', 1, ?, ?)`,
    ).run(line.id, daal.id, line.unit_price_paisa, line.unit_price_paisa);
    rw.close();
  }
  console.log('seeded 6 sales (1 removed, 1 part returned, 2 backdated)');

  // ── Auth ──
  const anon = await request('GET', '/sales');
  ok(anon.status === 401, `no session → 401, got ${anon.status}`);

  // ── Owner: today ──
  const tToday = await request('GET', '/sales', { token: owner });
  ok(tToday.status === 200 && tToday.json?.ok, `owner list: ${tToday.status} ${tToday.raw.slice(0, 200)}`);
  ok(tToday.json.range === 'today' && tToday.json.from === today, 'default range today');
  ok(tToday.json.total === 4, `today total rows 4, got ${tToday.json.total}`);
  ok(tToday.json.sale_count === 3, `today counted bills 3 (removed left out), got ${tToday.json.sale_count}`);
  ok(tToday.json.total_paisa === 62000 + 173000 + 24000, `today Rs total ${tToday.json.total_paisa}`);
  ok(tToday.json.items[0].id === s4.id, 'newest first');
  const r1 = tToday.json.items.find((i) => i.id === s1.id);
  ok(r1.status === 'removed', 'removed bill tagged removed');
  ok(r1.party_name === null && r1.sold_by_name === 'Bilal Cashier', 'walk-in + cashier name');
  const r2 = tToday.json.items.find((i) => i.id === s2.id);
  ok(r2.return_state === 'part', `s2 part returned, got ${r2.return_state}`);
  ok(r2.item_count === 2 && r2.qty_total === 3, 'item count / qty');
  ok(r2.party_name === 'Rashid Bhai' && r2.payment_method === 'udhaar', 'party + method');

  // ── Ranges ──
  const t7 = await request('GET', `/sales?${q({ range: '7d' })}`, { token: owner });
  ok(t7.json.total === 5, `7d rows 5, got ${t7.json.total}`);
  ok(t7.json.items.some((i) => i.id === s5.id), '7d includes 3-days-ago');
  const tMonth = await request('GET', `/sales?${q({ range: 'month' })}`, { token: owner });
  const monthStart = `${today.slice(0, 8)}01`;
  const expectMonth = 4 + (karachiYmd(threeAgo) >= monthStart ? 1 : 0);
  ok(tMonth.json.total === expectMonth, `month rows ${expectMonth}, got ${tMonth.json.total}`);
  ok(tMonth.json.from === monthStart, 'month from = 1st');
  const oldYmd = karachiYmd(old);
  const tCustom = await request('GET', `/sales?${q({ range: 'custom', from: oldYmd, to: oldYmd })}`, { token: owner });
  ok(tCustom.json.total === 1 && tCustom.json.items[0].id === s6.id, 'custom day finds old sale');
  const tAll = await request('GET', `/sales?${q({ range: 'custom', from: oldYmd, to: today })}`, { token: owner });
  ok(tAll.json.total === 6, `custom wide = 6, got ${tAll.json.total}`);
  const tAllRange = await request('GET', `/sales?${q({ range: 'all' })}`, { token: owner });
  ok(tAllRange.json.range === 'all' && tAllRange.json.total === 6, `range=all lists every bill, got ${tAllRange.json.total}`);
  ok(tAllRange.json.from === oldYmd && tAllRange.json.to === today, 'range=all from first bill to today');
  ok(tAllRange.json.items[tAllRange.json.items.length - 1].id === s6.id && tAllRange.json.items[0].id === s4.id, 'range=all newest first');
  ok(tAllRange.json.sale_count === 5, 'range=all counts non-removed');
  const tAllP = await request('GET', `/sales?${q({ range: 'all', pageSize: 4, page: 2 })}`, { token: owner });
  ok(tAllP.json.items.length === 2 && tAllP.json.total === 6, 'range=all paged');
  const tAllC = await request('GET', `/sales?${q({ range: 'all' })}`, { token: cashier });
  ok(tAllC.json.range === 'today' && tAllC.json.total === 4, 'cashier range=all forced to today');
  const bad = await request('GET', `/sales?${q({ range: 'custom', from: today, to: oldYmd })}`, { token: owner });
  ok(bad.status === 400 && bad.json?.error === 'invalid_range', `reversed range 400, got ${bad.status}`);
  const bad2 = await request('GET', `/sales?${q({ range: 'custom', from: '2026-02-30', to: today })}`, { token: owner });
  ok(bad2.status === 400 && bad2.json?.error === 'invalid_date', 'bad date 400');
  const bad3 = await request('GET', `/sales?${q({ paid: 'card' })}`, { token: owner });
  ok(bad3.status === 400, 'bad paid 400');

  // ── Search ──
  const wide = { range: 'custom', from: oldYmd, to: today };
  const search = async (text, extra = {}) =>
    (await request('GET', `/sales?${q({ ...wide, ...extra, q: text })}`, { token: owner })).json;
  const ids = (j) => j.items.map((i) => i.id).sort();
  let j = await search(s3.shortId.slice(0, 5));
  ok(j.items.some((i) => i.id === s3.id), 'bill no prefix');
  j = await search(`#${s3.shortId.toLowerCase()}`);
  ok(j.items.length >= 1 && j.items[0].id === s3.id, 'bill no with # lowercase');
  j = await search('rashid');
  ok(JSON.stringify(ids(j)) === JSON.stringify([s2.id, s3.id, s4.id].sort()), `customer name, got ${j.total}`);
  j = await search('03001234567');
  ok(j.total === 3, `phone digits (no dash) → 3, got ${j.total}`);
  j = await search('1234567');
  ok(j.total === 3, `phone part → 3, got ${j.total}`);
  j = await search('atta');
  ok(JSON.stringify(ids(j)) === JSON.stringify([s1.id, s3.id].sort()), `product name, got ${j.total}`);
  j = await search('8964000333444');
  ok(JSON.stringify(ids(j)) === JSON.stringify([s2.id, s3.id, s5.id].sort()), `barcode exact, got ${j.total}`);
  j = await search('8964000');
  ok(j.total === 0, `barcode partial does not match, got ${j.total}`);
  j = await search('1,730');
  ok(j.total === 1 && j.items[0].id === s3.id, `amount 1,730, got ${j.total}`);
  j = await search('Rs 620');
  ok(j.total === 1 && j.items[0].id === s2.id, `amount Rs 620, got ${j.total}`);
  j = await search('600');
  ok(j.total === 1 && j.items[0].id === s6.id, `amount 600 (old soap x5), got ${j.total}`);
  j = await search('100%_');
  ok(j.total === 0, 'LIKE wildcards escaped');
  j = await search('zzzz');
  ok(j.total === 0 && j.sale_count === 0 && j.total_paisa === 0, 'no match');

  // ── Filters ──
  j = (await request('GET', `/sales?${q({ ...wide, paid: 'cash' })}`, { token: owner })).json;
  ok(j.total === 4 && j.items.every((i) => i.payment_method === 'cash'), `paid cash 4, got ${j.total}`);
  j = (await request('GET', `/sales?${q({ ...wide, paid: 'khata' })}`, { token: owner })).json;
  ok(j.total === 1 && j.items[0].id === s2.id, 'paid khata');
  j = (await request('GET', `/sales?${q({ ...wide, paid: 'both' })}`, { token: owner })).json;
  ok(j.total === 1 && j.items[0].id === s3.id, 'paid both');
  j = (await request('GET', `/sales?${q({ ...wide, status: 'removed' })}`, { token: owner })).json;
  ok(j.total === 1 && j.items[0].id === s1.id && j.sale_count === 0, 'status removed');
  j = (await request('GET', `/sales?${q({ ...wide, status: 'active' })}`, { token: owner })).json;
  ok(j.total === 5 && j.sale_count === 5, 'status active');
  j = (await request('GET', `/sales?${q({ ...wide, status: 'returned' })}`, { token: owner })).json;
  ok(j.total === 1 && j.items[0].id === s2.id, 'status returned');
  j = (await request('GET', `/sales?${q({ ...wide, q: 'rashid', paid: 'cash' })}`, { token: owner })).json;
  ok(j.total === 1 && j.items[0].id === s4.id, 'search + filter combine');

  // ── Paging ──
  const p1 = (await request('GET', `/sales?${q({ ...wide, pageSize: 2, page: 1 })}`, { token: owner })).json;
  const p3 = (await request('GET', `/sales?${q({ ...wide, pageSize: 2, page: 3 })}`, { token: owner })).json;
  ok(p1.items.length === 2 && p1.total === 6 && p1.page_size === 2, 'page 1 of 3');
  ok(p3.items.length === 2 && p3.items[1].id === s6.id, 'page 3 ends with oldest');
  const p4 = (await request('GET', `/sales?${q({ ...wide, pageSize: 2, page: 4 })}`, { token: owner })).json;
  ok(p4.items.length === 0, 'past last page empty');

  // ── Detail ──
  let d = await request('GET', `/sales/${s4.id}`, { token: owner });
  ok(d.status === 200 && d.json?.ok, 'detail 200');
  let sale = d.json.sale;
  ok(sale.short_id === s4.shortId && sale.status === 'active', 'detail id/status');
  ok(sale.total_paisa === 24000 && sale.tendered_paisa === 50000 && sale.change_paisa === 0, 'tender/change');
  ok(sale.kept_on_khata_paisa === 26000, `kept on khata 260, got ${sale.kept_on_khata_paisa}`);
  ok(sale.party?.name === 'Rashid Bhai' && sale.party.phone === '0300-1234567', 'party');
  ok(sale.sold_by?.name === 'Asim Owner', 'sold by owner');
  ok(sale.lines.length === 1 && sale.lines[0].qty === 2 && sale.lines[0].unit_label === 'piece', 'lines');

  d = await request('GET', `/sales/${s3.id}`, { token: owner });
  sale = d.json.sale;
  ok(sale.payment_method === 'split' && sale.cash_amount_paisa === 100000 && sale.udhaar_amount_paisa === 73000, 'split amounts');
  ok(sale.lines.map((l) => l.unit_label).join(',') === 'packet,kg', 'unit labels from product');
  ok(sale.lines[0].barcode === '8964000111222', 'line barcode');

  d = await request('GET', `/sales/${s1.id}`, { token: owner });
  sale = d.json.sale;
  ok(sale.status === 'removed' && sale.void_reason === 'Wrong items' && sale.voided_at, 'removed detail');
  ok(sale.party === null && sale.change_paisa === 52000 && sale.kept_on_khata_paisa === 0, 'walk-in change 520');

  d = await request('GET', `/sales/${s2.id}`, { token: owner });
  sale = d.json.sale;
  ok(sale.return_state === 'part', 'detail part returned');
  ok(sale.lines.find((l) => l.product_id === daal.id).returned_qty === 1, 'line returned qty');

  d = await request('GET', `/sales/${s3.shortId}`, { token: owner });
  ok(d.status === 200 && d.json.sale.id === s3.id, 'detail by bill no');
  d = await request('GET', `/sales/nope`, { token: owner });
  ok(d.status === 404, `missing 404, got ${d.status}`);
  d = await request('GET', `/sales/today`, { token: owner });
  ok(d.status === 200 && typeof d.json.sale_count === 'number', '/sales/today still the Today summary');

  // ── Cashier: today only ──
  j = (await request('GET', `/sales?${q(wide)}`, { token: cashier })).json;
  ok(j.range === 'today' && j.total === 4, `cashier forced to today, got ${j.range}/${j.total}`);
  j = (await request('GET', `/sales?${q({ range: '7d', q: 'daal' })}`, { token: cashier })).json;
  ok(j.total === 2 && j.from === today, 'cashier search inside today');
  d = await request('GET', `/sales/${s5.id}`, { token: cashier });
  ok(d.status === 403, `cashier old bill 403, got ${d.status}`);
  d = await request('GET', `/sales/${s2.id}`, { token: cashier });
  ok(d.status === 200 && d.json.sale.id === s2.id, 'cashier today bill 200');

  // ── Totals elsewhere unchanged by migration ──
  const ct = (await request('GET', '/cashier/today', { token: cashier })).json;
  ok(ct.sale_count === 3, `cashier today still excludes removed, got ${ct.sale_count}`);

  console.log(`\nPASS ${passed} checks`);
} catch (err) {
  console.error('\nFAIL after', passed, 'checks:', err.message);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
}
