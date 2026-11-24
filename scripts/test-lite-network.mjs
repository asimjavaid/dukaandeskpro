#!/usr/bin/env node
/**
 * DukaanDesk Pro slice P4: LAN mode with two simulated till PCs.
 * Main PC API listens on the LAN (DD_LAN=1); each till runs apps/desktop/src/till-link.js
 * (bundled UI + forwarding to the main PC), found by UDP discovery or typed IP.
 * Checks: LAN calls need a paired device key, discovery, connect, pairing through a till,
 * parallel selling on two tills (gap-free per-till numbers, stock right), turned-off till
 * refused, main PC down = till keeps selling (offline numbers) and catches up, restart = same key + session work.
 *   DD_DB=pg node scripts/test-lite-network.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startApi, startApiOn, seed, makeChecks, root } from './lib/sales-harness.mjs';

const require = createRequire(import.meta.url);
const { startTillLink, discover } = require(path.join(root, 'apps/desktop/src/till-link.js'));

const lanIp = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
if (!lanIp) {
  console.log('SKIP no non-loopback IPv4 address on this machine');
  process.exit(0);
}
const PORT = Number(process.env.API_PORT ?? 3951);
const DISC = 3959;
const env = { DD_LAN: '1', DD_DISCOVERY_PORT: String(DISC), DD_TILL_LIMIT: '3', SESSION_SECRET: 'lite-net-secret' };
let api = await startApi('lite-net', PORT, env);
const c = makeChecks();
const { ok } = c;
const at = () => new Date().toISOString();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-net-'));
const webDir = path.join(root, 'apps/web/dist');

function req(host, port, method, p, { body, token, till } = {}) {
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers['x-dd-session'] = token;
    if (till) headers['x-dd-till'] = till;
    const q = http.request({ host, port, path: p, method, headers, timeout: 20000 }, (r) => {
      let raw = '';
      r.on('data', (d) => (raw += d));
      r.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* */ }
        resolve({ status: r.statusCode, json, raw });
      });
    });
    q.on('timeout', () => q.destroy());
    q.on('error', (e) => resolve({ status: 0, json: null, raw: String(e.message) }));
    if (payload) q.write(payload);
    q.end();
  });
}
const LAN = (m, p, o) => req(lanIp, PORT, m, p, o);
const links = [];

try {
  const s = await seed(api);
  const { owner } = s;
  const R = api.request;

  // ---- LAN gate ----
  let r = await LAN('GET', '/health');
  ok(r.status === 200 && r.json?.product === 'DukaanDesk Pro' && !('dbPath' in (r.json ?? {})), `LAN health answers, no file path (${r.status})`);
  r = await LAN('GET', '/catalog/products');
  ok(r.status === 401 && r.json?.error === 'till_not_paired', `LAN call without device key refused (${r.status} ${r.json?.error})`);
  r = await LAN('GET', '/catalog/products', { token: owner });
  ok(r.status === 401 && r.json?.error === 'till_not_paired', 'owner session alone is not enough from another PC');
  r = await LAN('POST', '/auth/login', { body: { userId: 'x', pin: '1234' } });
  ok(r.status === 401, 'LAN login without device key refused');
  r = await LAN('GET', '/tills/me', { till: 'bogus' });
  ok(r.status === 200 && r.json?.till === null && r.json.keyRejected === true, 'LAN /tills/me with an unknown key');
  r = await LAN('GET', '/catalog/products', { till: 'bogus' });
  ok(r.status === 401 && r.json?.error === 'till_key_rejected', 'LAN call with an unknown key refused');
  r = await R('GET', '/catalog/products', { token: owner });
  ok(r.status === 200, 'main PC itself still works without a key');

  // ---- discovery ----
  const found = await discover({ port: DISC, waitMs: 1200, extraTargets: [lanIp] });
  const hit = found.find((f) => f.port === PORT);
  ok(Boolean(hit) && hit.name === 'Test Kiryana' && hit.mode === 'main_till', `UDP discovery finds the main PC ${JSON.stringify(found)}`);

  // ---- two till PCs ----
  for (const n of [2, 3]) {
    const port = PORT + 10 + n;
    const configFile = path.join(tmp, `till${n}.json`);
    const srv = await startTillLink({ webDir, port, configFile, discoveryPort: DISC, discoveryTargets: [lanIp] });
    links.push({ n, port, srv, L: (m, p, o) => req('127.0.0.1', port, m, p, o) });
  }
  const [A, B] = links;
  r = await A.L('GET', '/__till/status');
  ok(r.json?.tillMode === true && r.json.server === null, 'new till: no main PC yet');
  r = await A.L('GET', '/catalog/products');
  ok(r.status === 503 && r.json?.error === 'no_server', 'till without main PC answers no_server');
  r = await A.L('POST', '/__till/discover');
  ok((r.json?.found ?? []).some((f) => f.port === PORT), 'till finds the main PC from the UI endpoint');
  r = await A.L('POST', '/__till/server', { body: { server: 'not an address!' } });
  ok(r.status === 400 && r.json?.error === 'bad_address', 'typed address checked');
  r = await A.L('POST', '/__till/server', { body: { server: `${lanIp}:1` } });
  ok(r.status === 502 && r.json?.error === 'server_unreachable', 'wrong port: not reachable');
  for (const x of links) {
    r = await x.L('POST', '/__till/server', { body: { server: `${lanIp}:${PORT}` } });
    ok(r.json?.ok && r.json.server === `${lanIp}:${PORT}`, `till ${x.n} connects by typed IP`);
  }
  r = await A.L('GET', '/index.html');
  ok(r.status === 200 && /<div id="root">/.test(r.raw), 'till serves its own UI');
  r = await A.L('GET', '/catalog/products');
  ok(r.status === 401 && r.json?.error === 'till_not_paired', 'unpaired till refused through the link');
  r = await A.L('GET', '/__till/status');
  ok(r.json?.reachable === true, 'till sees the main PC');

  // ---- pair through each till ----
  for (const x of links) {
    r = await R('POST', '/tills', { token: owner, body: { name: `Counter ${x.n}` } });
    ok(r.json?.ok && r.json.till.code === x.n, `owner adds Till ${x.n}`);
    x.tillId = r.json.till.id;
    const p = await x.L('POST', '/tills/pair', { body: { code: r.json.pairCode, deviceName: `COUNTER${x.n}-PC` } });
    ok(p.json?.ok && p.json.deviceKey && p.json.till.code === x.n, `Till ${x.n} paired over the LAN`);
    x.key = p.json.deviceKey;
    const me = await x.L('GET', '/tills/me', { till: x.key });
    ok(me.json?.till?.code === x.n, `Till ${x.n} knows itself`);
  }
  r = await R('GET', '/tills', { token: owner });
  const row2 = r.json?.tills?.find((t) => t.code === 2);
  ok(row2?.paired && row2.device_name === 'COUNTER2-PC' && row2.online, 'tills list: Till 2 paired + online');

  // ---- a cashier per till ----
  for (const x of links) {
    const u = await R('POST', '/owner/staff/cashiers', { token: owner, body: { displayName: `Cashier ${x.n}`, pin: `${x.n}${x.n}${x.n}${x.n}` } });
    const li = await x.L('POST', '/auth/login', { till: x.key, body: { userId: u.json.user.id, pin: `${x.n}${x.n}${x.n}${x.n}` } });
    ok(li.json?.ok && li.json.sessionToken, `cashier signs in on Till ${x.n}`);
    x.token = li.json.sessionToken;
    const op = await x.L('POST', '/cashier/till/open', { token: x.token, till: x.key, body: { floatRs: 1000 } });
    ok(op.json?.ok, `shift opened on Till ${x.n}`);
  }

  // ---- parallel selling on two tills ----
  const N = 15;
  const before = s.stock(s.daal.id);
  const sell = (x) => x.L('POST', '/sales', { token: x.token, till: x.key, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.daal.id, qty: 1 }] } });
  const results = await Promise.all(Array.from({ length: N }, () => [sell(A), sell(B)]).flat());
  ok(results.every((x) => x.status === 201 && x.json?.ok), `${2 * N} parallel sales through two tills all saved`);
  for (const x of links) {
    const nums = results.map((y) => y.json?.sale?.shortId).filter((id) => id?.startsWith(`T${x.n}-`)).sort();
    const want = Array.from({ length: N }, (_, i) => `T${x.n}-${String(i + 1).padStart(6, '0')}`);
    ok(JSON.stringify(nums) === JSON.stringify(want), `Till ${x.n} bills T${x.n}-000001…${N}, no gaps`);
  }
  ok(s.stock(s.daal.id) === before - 2 * N, `stock down by ${2 * N}`);
  r = await A.L('GET', '/cashier/till', { token: A.token, till: A.key });
  ok(r.json?.till?.code === 2 && r.json?.summary?.cash_sales_paisa === N * 25000, `Till 2 shift cash = its own sales (${r.json?.summary?.cash_sales_paisa})`);

  // ---- turned-off till ----
  r = await B.L('POST', '/cashier/till/close', { token: B.token, till: B.key, body: { countedRs: 1000 + N * 250 } });
  ok(r.json?.ok, 'Till 3 shift closed');
  r = await R('POST', `/tills/${B.tillId}`, { token: owner, body: { active: false } });
  ok(r.json?.ok, 'owner turns Till 3 off');
  r = await sell(B);
  ok(r.status === 401 && r.json?.error === 'till_key_rejected', `turned-off till cannot sell (${r.status} ${r.json?.error})`);
  r = await B.L('GET', '/tills/me', { till: B.key });
  ok(r.json?.keyRejected === true, 'till sees it was turned off');

  // ---- main PC down ----
  const saleCount = () => { const d = s.db(); const n = d.prepare('SELECT COUNT(*) AS n FROM sales').get().n; d.close(); return Number(n); };
  const countBefore = saleCount();
  await new Promise((res) => { api.stop(); setTimeout(res, 1500); });
  r = await A.L('GET', '/__till/status');
  ok(r.json?.reachable === false, 'till sees main PC down');
  r = await sell(A);
  ok(r.status === 201 && /^T2-OFF-\d{6}$/.test(r.json?.sale?.shortId ?? ''), `sale while main PC down is kept on the till (${r.status} ${r.json?.sale?.shortId})`);
  r = await A.L('GET', '/health');
  ok(r.status === 503 && r.json?.error === 'offline', 'health while down: offline');
  ok(saleCount() === countBefore, 'main PC has nothing yet');

  // ---- reconnect ----
  api = await startApiOn(api.dbPath, PORT, env);
  r = await A.L('GET', '/tills/me', { till: A.key });
  ok(r.json?.till?.code === 2, 'after restart: same device key works');
  for (let i = 0; i < 40 && saleCount() !== countBefore + 1; i++) await new Promise((res) => setTimeout(res, 250));
  ok(saleCount() === countBefore + 1, 'offline sale caught up');
  r = await sell(A);
  ok(r.status === 201 && r.json?.sale?.shortId === `T2-${String(N + 1).padStart(6, '0')}`, `after restart: same session sells, next number ${r.json?.sale?.shortId}`);
} catch (e) {
  console.error('FAIL', e.stack || e.message);
  process.exitCode = 1;
} finally {
  for (const x of links) x.srv.close();
  await api.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (!process.exitCode) console.log(`${c.passed} checks passed`);
process.exit(process.exitCode ?? 0);
