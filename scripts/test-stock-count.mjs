#!/usr/bin/env node
/**
 * S-SC1 + S-SC4 smoke: stock count draft → upsert → absolute post → ledger skip Δ0
 * + history aggregates, reason/cost snapshot, uncounted untouched, one-draft.
 * Fresh temp SQLite. Run: node scripts/test-stock-count.mjs
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

const API_PORT = Number(process.env.API_PORT ?? 3861);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-stock-count-${Date.now()}.sqlite`);

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

console.log('=== DukaanDesk Stock count S-SC1 + S-SC4 smoke ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
assert(
  mig.applied.includes('025_slice31_stock_count.sql') ||
    mig.skipped.includes('025_slice31_stock_count.sql'),
  '025_slice31_stock_count present',
);
assert(
  mig.applied.includes('026_slice32_stock_count_v2.sql') ||
    mig.skipped.includes('026_slice32_stock_count_v2.sql'),
  '026_slice32_stock_count_v2 present',
);
console.log('migrations applied:', mig.applied.slice(-4));

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
    SESSION_SECRET: 'stock-count-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '2468';
let exitCode = 0;

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: 'Count Owner', pin: PIN, storeName: 'Count Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;
  assert(token, 'sessionToken');

  const created = await request('POST', '/catalog/products', {
    token,
    body: { name: 'Count Chai', priceRs: 50, unit: 'piece' },
  });
  assert(created.json?.ok === true, `create: ${JSON.stringify(created.json)}`);
  const productId = created.json.product.id;

  const created2 = await request('POST', '/catalog/products', {
    token,
    body: { name: 'Count Biscuit', priceRs: 20, unit: 'piece' },
  });
  assert(created2.json?.ok === true, `create2: ${JSON.stringify(created2.json)}`);
  const productId2 = created2.json.product.id;

  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO stock_balances (product_id, qty_on_hand, updated_at)
     VALUES (?, 10, datetime('now'))
     ON CONFLICT(product_id) DO UPDATE SET qty_on_hand = 10`,
  ).run(productId);
  db.prepare(
    `INSERT INTO stock_balances (product_id, qty_on_hand, updated_at)
     VALUES (?, 5, datetime('now'))
     ON CONFLICT(product_id) DO UPDATE SET qty_on_hand = 5`,
  ).run(productId2);
  // Cost snapshot source (Q1=A)
  db.prepare(
    `UPDATE products SET last_unit_cost_paisa = 1500 WHERE id = ?`,
  ).run(productId);
  // productId2 stays uncosted
  db.close();

  const draftNull = await request('GET', '/stock/counts/draft', { token });
  assert(draftNull.json?.session == null, 'no draft yet');

  const start = await request('POST', '/stock/counts', {
    token,
    body: { source: 'full_screen' },
  });
  assert(start.json?.ok === true, `start: ${JSON.stringify(start.json)}`);
  const sessionId = start.json.session.id;

  const again = await request('POST', '/stock/counts', {
    token,
    body: { source: 'full_screen' },
  });
  assert(again.json?.ok === false, 'second start blocked');
  assert(again.json?.error === 'draft_exists', 'draft_exists');

  // Count product1 with reason; leave product2 uncounted (must stay untouched on post)
  const put = await request('PUT', `/stock/counts/${sessionId}/lines`, {
    token,
    body: {
      lines: [
        { productId, countedQty: 13, reasonCode: 'damaged' },
      ],
    },
  });
  assert(put.json?.ok === true, `upsert: ${JSON.stringify(put.json)}`);
  const line1 = put.json.lines.find((l) => l.product_id === productId);
  assert(line1?.reason_code === 'damaged', 'reason on line');
  assert(line1?.unit_cost_paisa_snapshot === 1500, 'cost snapshot on line');
  assert(line1?.system_qty_snapshot === 10, 'system snapshot');

  // Worksheet progress + uncounted filter
  const ws = await request(
    'GET',
    `/stock/counts/${sessionId}/items?filter=uncounted&page=1&pageSize=20`,
    { token },
  );
  assert(ws.json?.ok === true, `worksheet: ${JSON.stringify(ws.json)}`);
  assert(ws.json.progress.counted === 1, `progress counted ${ws.json.progress.counted}`);
  assert(ws.json.progress.total === 2, `progress total ${ws.json.progress.total}`);
  assert(
    ws.json.items.some((i) => i.product_id === productId2),
    'uncounted includes product2',
  );
  assert(
    !ws.json.items.some((i) => i.product_id === productId),
    'uncounted excludes counted product1',
  );

  const reportDraft = await request('GET', `/stock/counts/${sessionId}`, {
    token,
  });
  assert(reportDraft.json?.ok === true, 'draft report');
  assert(reportDraft.json.aggregates.items_counted === 1, 'draft agg counted');
  assert(reportDraft.json.aggregates.items_extra === 1, 'draft agg extra');

  const post = await request('POST', `/stock/counts/${sessionId}/post`, {
    token,
    body: { note: 'stock count' },
  });
  assert(post.json?.ok === true, `post: ${JSON.stringify(post.json)}`);
  assert(post.json.adjusted === 1, `adjusted ${post.json.adjusted}`);
  assert(post.json.totalAbsDelta === 3, `absΔ ${post.json.totalAbsDelta}`);
  assert(
    post.json.session.items_total_at_post === 2,
    `items_total_at_post ${post.json.session.items_total_at_post}`,
  );
  const adj0 = post.json.adjustments[0];
  assert(adj0?.reason_code === 'damaged', 'reason copied to adjustment');
  assert(adj0?.unit_cost_paisa === 1500, 'cost on adjustment');
  assert(adj0?.reason === 'stock_count', 'source reason unchanged');

  const db2 = new Database(dbPath);
  const bal = db2
    .prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`)
    .get(productId);
  assert(bal.qty_on_hand === 13, `on-hand ${bal.qty_on_hand}`);
  // Uncounted product2 untouched
  const bal2 = db2
    .prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`)
    .get(productId2);
  assert(bal2.qty_on_hand === 5, `uncounted untouched ${bal2.qty_on_hand}`);
  const adj = db2
    .prepare(
      `SELECT delta_pieces, qty_before, qty_after, reason, reason_code, unit_cost_paisa
       FROM stock_adjustments WHERE session_id = ?`,
    )
    .get(sessionId);
  assert(adj?.delta_pieces === 3, 'ledger delta');
  assert(adj.qty_after === 13, 'qty_after');
  assert(adj.reason === 'stock_count', 'reason');
  assert(adj.reason_code === 'damaged', 'reason_code db');
  assert(adj.unit_cost_paisa === 1500, 'unit_cost_paisa db');

  // Match count → skip ledger
  const start2 = await request('POST', '/stock/counts', {
    token,
    body: { source: 'full_screen' },
  });
  assert(start2.json?.ok === true, 'start2');
  const sid2 = start2.json.session.id;
  await request('PUT', `/stock/counts/${sid2}/lines`, {
    token,
    body: { lines: [{ productId, countedQty: 13 }] },
  });
  const post2 = await request('POST', `/stock/counts/${sid2}/post`, {
    token,
    body: {},
  });
  assert(post2.json?.ok === true, 'post2');
  assert(post2.json.adjusted === 0, 'no adjust');
  assert(post2.json.skipped === 1, 'skipped');
  const adj2 = db2
    .prepare(`SELECT COUNT(*) AS c FROM stock_adjustments WHERE session_id = ?`)
    .get(sid2);
  assert(adj2.c === 0, 'no zero-delta rows');

  // Quick count with reason (loss → shrinkage)
  const quick = await request('POST', '/stock/counts/quick', {
    token,
    body: { productId, countedQty: 11, reasonCode: 'stolen_lost' },
  });
  assert(quick.json?.ok === true, `quick: ${JSON.stringify(quick.json)}`);
  assert(quick.json.mode === 'posted', 'quick posted');
  assert(
    quick.json.adjustments?.[0]?.reason_code === 'stolen_lost',
    'quick reason',
  );
  const bal3 = db2
    .prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`)
    .get(productId);
  assert(bal3.qty_on_hand === 11, `quick on-hand ${bal3.qty_on_hand}`);

  // History list aggregates + lastFullCount + monthlyShrinkage
  const hist = await request('GET', '/stock/counts?limit=20', { token });
  assert(hist.json?.ok === true, `history: ${JSON.stringify(hist.json)}`);
  assert(hist.json.count >= 2, `history count ${hist.json.count}`);
  const fullItem = hist.json.items.find(
    (i) => i.session.id === sessionId,
  );
  assert(fullItem, 'posted full in history');
  assert(fullItem.count_type === 'Full', 'count_type Full');
  assert(fullItem.aggregates.items_extra === 1, 'hist extra');
  assert(fullItem.aggregates.abs_delta_units === 3, 'hist abs');
  assert(
    fullItem.aggregates.gain_paisa === 3 * 1500,
    `hist gain ${fullItem.aggregates.gain_paisa}`,
  );
  assert(hist.json.lastFullCount?.session?.id === sessionId || hist.json.lastFullCount?.session?.id === sid2, 'lastFullCount');
  // Quick loss: 13→11 = -2 × 1500 = 3000 loss
  assert(
    hist.json.monthlyShrinkage?.loss_paisa >= 3000,
    `shrinkage ${hist.json.monthlyShrinkage?.loss_paisa}`,
  );

  // Report for posted session
  const report = await request('GET', `/stock/counts/${sessionId}`, { token });
  assert(report.json?.ok === true, 'posted report');
  assert(report.json.adjustments.length === 1, 'report adjustments');
  assert(report.json.lines[0].reason_code === 'damaged', 'report reason');

  // One-draft still enforced while draft open
  const start3 = await request('POST', '/stock/counts', {
    token,
    body: { source: 'full_screen' },
  });
  assert(start3.json?.ok === true, 'start3');
  const blocked = await request('POST', '/stock/counts', {
    token,
    body: { source: 'full_screen' },
  });
  assert(blocked.json?.error === 'draft_exists', 'one-draft still');
  await request('POST', `/stock/counts/${start3.json.session.id}/cancel`, {
    token,
  });

  // SC7: Stock Count is Owner-only on the API too — Data Entry refused (403)
  const deoStaff = await request('POST', '/owner/staff', {
    token,
    body: { name: 'Count DEO', role: 'data_entry', pin: '4321' },
  });
  assert(deoStaff.json?.ok === true, `add DEO: ${JSON.stringify(deoStaff.json)}`);
  const deoLogin = await request('POST', '/auth/login', {
    body: { userId: deoStaff.json.staff.id, pin: '4321' },
  });
  const deo = deoLogin.json?.sessionToken;
  assert(deo, `DEO login: ${JSON.stringify(deoLogin.json)}`);
  const refused = [
    ['GET', '/stock/counts/draft'],
    ['GET', '/stock/counts?limit=5'],
    ['POST', '/stock/counts', { source: 'full_screen' }],
    ['POST', '/stock/counts/quick', { productId, countedQty: 1 }],
    ['GET', `/stock/counts/${sessionId}`],
    ['GET', `/stock/counts/${sessionId}/items?page=1&pageSize=5`],
    ['PUT', `/stock/counts/${sessionId}/lines`, { lines: [] }],
    ['POST', `/stock/counts/${sessionId}/post`, {}],
    ['POST', `/stock/counts/${sessionId}/cancel`, {}],
  ];
  for (const [m, u, b] of refused) {
    const r = await request(m, u, { token: deo, body: b });
    assert(r.status === 403, `Data Entry refused ${m} ${u} → ${r.status}`);
  }
  // Data Entry keeps non-count stock routes (receive/adjustments stay InventoryGuard)
  const deoAdj = await request('GET', '/stock/adjustments', { token: deo });
  assert(deoAdj.status === 200, `DEO adjustments ${deoAdj.status}`);
  const balDeo = db2
    .prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`)
    .get(productId);
  assert(balDeo.qty_on_hand === 11, `DEO refusal changed nothing ${balDeo.qty_on_hand}`);
  console.log('Data Entry refused on /stock/counts* (9 routes)');

  // last_unit_cost_paisa unchanged by post (no COGS rewrite)
  const costAfter = db2
    .prepare(`SELECT last_unit_cost_paisa FROM products WHERE id = ?`)
    .get(productId);
  assert(costAfter.last_unit_cost_paisa === 1500, 'cost unchanged');
  db2.close();

  console.log('OK stock-count S-SC1+S-SC4 smoke');
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  process.exit(exitCode);
}
