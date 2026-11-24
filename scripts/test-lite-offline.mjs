#!/usr/bin/env node
/**
 * DukaanDesk Pro: a till keeps selling while the main PC is down and catches up later.
 * Two till PCs (till-link): Till 2 reaches the main PC through a proxy we can cut (offline),
 * Till 3 stays online. Checks: offline cash sales with T2-OFF numbers, cash-only refusals,
 * offline PIN sign-in from cached hashes, manager approval offline, queue survives a till
 * restart, idempotent sync (retry + duplicate batch), oversell → negative stock + review,
 * nothing dropped, offline sign-in upgraded on reconnect, online clientUuid dedup.
 *   DD_DB=pg node scripts/test-lite-offline.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { startApi, seed, makeChecks, root } from './lib/sales-harness.mjs';

const require = createRequire(import.meta.url);
const { startTillLink } = require(path.join(root, 'apps/desktop/src/till-link.js'));

const PORT = Number(process.env.API_PORT ?? 3971);
const PROXY = PORT + 1;
const env = { DD_TILL_LIMIT: '3', SESSION_SECRET: 'lite-off-secret' };
const api = await startApi('lite-off', PORT, env);
const c = makeChecks();
const { ok } = c;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-off-'));
const webDir = path.join(root, 'apps/web/dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A cuttable wire between Till 2 and the main PC.
let cut = false;
const socks = new Set();
const proxy = net.createServer((a) => {
  if (cut) return a.destroy();
  const b = net.connect(PORT, '127.0.0.1');
  socks.add(a); socks.add(b);
  a.pipe(b); b.pipe(a);
  const end = () => { a.destroy(); b.destroy(); socks.delete(a); socks.delete(b); };
  a.on('error', end); b.on('error', end); a.on('close', end); b.on('close', end);
});
await new Promise((r) => proxy.listen(PROXY, '127.0.0.1', r));
const setCut = (v) => { cut = v; if (v) for (const s of socks) s.destroy(); };

function req(port, method, p, { body, token, till } = {}) {
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers['x-dd-session'] = token;
    if (till) headers['x-dd-till'] = till;
    const q = http.request({ host: '127.0.0.1', port, path: p, method, headers, timeout: 20000 }, (r) => {
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

const links = {};
async function openLink(n, serverPort) {
  const port = PORT + 20 + n;
  const configFile = path.join(tmp, `till${n}`, 'till.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  const srv = await startTillLink({ webDir, port, configFile, pingMs: 400, discoveryPort: PORT + 9 });
  const L = (m, p, o) => req(port, m, p, o);
  const prev = links[n] ?? {};
  links[n] = { ...prev, n, port, srv, L, serverPort };
  return links[n];
}
const waitFor = async (fn, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(150); }
  return false;
};
const state = async (x) => (await x.L('GET', '/__till/offline/state')).json;

try {
  const s = await seed(api);
  const { owner } = s;
  const R = api.request;
  const sqlOne = (q, ...a) => { const d = s.db(); const r = d.prepare(q).get(...a); d.close(); return r; };
  const saleCount = () => Number(sqlOne('SELECT COUNT(*) AS n FROM sales').n);

  let r = await R('POST', '/owner/staff', { token: owner, body: { name: 'Mona Manager', role: 'manager', pin: '1357' } });
  ok(r.json?.ok, 'manager added');
  r = await R('POST', '/owner/staff/cashiers', { token: owner, body: { displayName: 'Sara Cashier', pin: '4321' } });
  ok(r.json?.ok, 'second cashier added');
  const users = (await R('GET', '/auth/users')).json.users;
  const bilal = users.find((u) => u.displayName === 'Bilal Cashier');
  const mona = users.find((u) => u.displayName === 'Mona Manager');
  const sara = users.find((u) => u.displayName === 'Sara Cashier');
  const ownerU = users.find((u) => u.role === 'owner');
  const who = { 2: [bilal, '5678'], 3: [sara, '4321'] };

  // ---- two till PCs, paired ----
  const A = await openLink(2, PROXY);
  const B = await openLink(3, PORT);
  for (const x of [A, B]) {
    r = await R('POST', '/tills', { token: owner, body: { name: `Counter ${x.n}` } });
    x.tillId = r.json.till.id;
    await x.L('POST', '/__till/server', { body: { server: `127.0.0.1:${x.serverPort}` } });
    const p = await x.L('POST', '/tills/pair', { body: { code: r.json.pairCode, deviceName: `PC${x.n}` } });
    ok(p.json?.ok && p.json.deviceKey, `Till ${x.n} paired`);
    x.key = p.json.deviceKey;
    const li = await x.L('POST', '/auth/login', { till: x.key, body: { userId: who[x.n][0].id, pin: who[x.n][1] } });
    x.token = li.json.sessionToken;
    await x.L('GET', '/auth/me', { token: x.token, till: x.key });
    await x.L('POST', '/cashier/till/open', { token: x.token, till: x.key, body: { floatRs: 1000 } });
  }
  r = await A.L('POST', '/__till/offline/sync');
  ok(r.json?.online === true && r.json.ready === true && r.json.numbersLeft === 200, `Till 2 holds an offline copy + 200 numbers (${JSON.stringify(r.json)})`);
  const pack = JSON.parse(fs.readFileSync(path.join(tmp, 'till2', 'offline', 'pack.json'), 'utf8'));
  ok(pack.users.some((u) => u.id === mona.id && u.pinHash) && !pack.users.some((u) => u.role === 'owner'), 'offline copy: cashier/manager PIN hashes, no owner');
  const cfg2 = JSON.parse(fs.readFileSync(path.join(tmp, 'till2', 'till.json'), 'utf8'));
  ok(cfg2.deviceKey === A.key, 'device key kept with the till settings');

  // ---- Till 2 loses the main PC ----
  setCut(true);
  ok(await waitFor(async () => (await state(A))?.online === false), 'Till 2 sees the main PC gone');
  ok((await state(B))?.online === true, 'Till 3 still online');
  const before = saleCount();
  const soapBefore = Number(s.stock(s.soap.id));
  const cash = (x, lines, extra = {}) => x.L('POST', '/sales', { token: extra.token ?? x.token, till: x.key, body: { paymentMethod: 'cash', clientDeviceAt: new Date().toISOString(), lines, ...extra.body } });
  const daalLine = { productId: s.daal.id, qty: 2, unit: 'piece', expectedUnitPricePaisa: 25000 };

  const u1 = crypto.randomUUID();
  r = await cash(A, [daalLine], { body: { clientUuid: u1, tenderedPaisa: 50000 } });
  ok(r.status === 201 && r.json?.sale?.shortId === 'T2-OFF-000001' && r.json.offline === true, `offline sale T2-OFF-000001 (${r.status} ${r.raw.slice(0, 120)})`);
  r = await cash(A, [daalLine], { body: { clientUuid: u1, tenderedPaisa: 50000 } });
  ok(r.json?.sale?.shortId === 'T2-OFF-000001' && (await state(A)).queued === 1, 'same bill sent again: one queued sale');
  r = await A.L('GET', '/catalog/products', { token: A.token, till: A.key });
  ok(r.status === 200 && r.json.items.length >= 3, 'items from the copy');
  r = await cash(A, [daalLine], { body: { partyId: s.rashid.id } });
  ok(r.json?.error === 'offline_cash_only', 'no khata offline');
  r = await A.L('POST', '/returns', { token: A.token, till: A.key, body: {} });
  ok(r.status === 503 && r.json?.error === 'offline', 'no refunds offline');
  r = await A.L('POST', '/stock/receive', { token: A.token, till: A.key, body: {} });
  ok(r.status === 503 && r.json?.error === 'offline', 'no stock receiving offline');
  r = await cash(A, [{ productId: crypto.randomUUID(), qty: 1 }]);
  ok(r.json?.error === 'offline_item_not_cached', 'unknown item refused');

  // Offline sign-in from cached hashes.
  r = await A.L('POST', '/auth/login', { till: A.key, body: { userId: bilal.id, pin: '0000' } });
  ok(r.json?.ok === false, 'wrong PIN refused offline');
  r = await A.L('POST', '/auth/login', { till: A.key, body: { userId: ownerU.id, pin: '2468' } });
  ok(r.json?.ok === false, 'owner cannot sign in offline');
  r = await A.L('POST', '/auth/login', { till: A.key, body: { userId: bilal.id, pin: '5678' } });
  ok(r.json?.ok && /^off_/.test(r.json.sessionToken) && r.json.session.till?.code === 2, 'cashier signs in offline');
  const offTok = r.json.sessionToken;
  r = await cash(A, [{ ...daalLine, qty: 1 }], { token: offTok, body: { tenderedPaisa: 25000 } });
  ok(r.json?.sale?.shortId === 'T2-OFF-000002', 'offline sign-in sells');

  // Price override needs a manager (cached hash).
  const ov = { productId: s.atta.id, qty: 1, unit: 'piece', expectedUnitPricePaisa: 148000, overridePricePaisa: 140000 };
  r = await cash(A, [ov], { token: offTok, body: { tenderedPaisa: 140000 } });
  ok(r.status === 403 && r.json?.error === 'manager_approval_needed', 'price change needs a manager offline');
  r = await A.L('POST', '/auth/approve', { token: offTok, till: A.key, body: { userId: bilal.id, pin: '5678', action: 'price_override' } });
  ok(r.json?.ok === false, 'cashier PIN does not approve');
  r = await A.L('POST', '/auth/approve', { token: offTok, till: A.key, body: { userId: mona.id, pin: '1357', action: 'price_override' } });
  ok(r.json?.ok && /^offap_/.test(r.json.approval), 'manager PIN approves offline');
  r = await cash(A, [ov], { token: offTok, body: { tenderedPaisa: 140000, approval: r.json.approval } });
  ok(r.json?.sale?.shortId === 'T2-OFF-000003' && r.json.sale.totalPaisa === 140000, 'approved price sale');

  // Oversell: Till 3 (online) sells 99 soap while Till 2 (offline) sells 3.
  r = await cash(B, [{ productId: s.soap.id, qty: 99, unit: 'piece', expectedUnitPricePaisa: 12000 }], { body: { tenderedPaisa: 99 * 12000 } });
  ok(r.status === 201 && r.json?.sale?.shortId === 'T3-000001', `Till 3 sells online meanwhile (${r.json?.sale?.shortId})`);
  r = await cash(A, [{ productId: s.soap.id, qty: 3, unit: 'piece', expectedUnitPricePaisa: 12000 }], { body: { tenderedPaisa: 36000 } });
  ok(r.json?.sale?.shortId === 'T2-OFF-000004', 'offline soap sale');
  ok(saleCount() === before + 1, 'main PC has only Till 3 sale so far');

  // ---- Till 2 app restarts while offline ----
  await new Promise((res) => A.srv.close(res));
  const A2 = await openLink(2, PROXY);
  await sleep(600);
  let st = await state(A2);
  ok(st.online === false && st.ready === true && st.queued === 4, `after restart: 4 sales still queued (${JSON.stringify(st)})`);
  r = await cash(A2, [{ ...daalLine, qty: 1 }], { body: { tenderedPaisa: 25000 } });
  ok(r.json?.sale?.shortId === 'T2-OFF-000005', 'same sign-in keeps selling after restart, next number');
  r = await A2.L('GET', '/auth/me', { token: offTok, till: A2.key });
  ok(r.status === 401, 'offline sign-in from before the restart asks for the PIN again');
  r = await A2.L('POST', '/auth/login', { till: A2.key, body: { userId: bilal.id, pin: '5678' } });
  const offTok2 = r.json.sessionToken;

  // ---- back online ----
  setCut(false);
  ok(await waitFor(async () => { const x = await state(A2); return x.online && x.queued === 0; }), 'Till 2 back: queue empty');
  ok(saleCount() === before + 6, `all 5 offline sales on the main PC (${saleCount() - before - 1})`);
  const off1 = sqlOne(`SELECT short_id, bill_no, offline_no, client_uuid, total_paisa FROM sales WHERE client_uuid = ?`, u1);
  ok(off1?.short_id === 'T2-OFF-000001' && off1.bill_no == null && Number(off1.offline_no) === 1 && Number(off1.total_paisa) === 50000, 'offline bill kept its number');
  const atta = sqlOne(`SELECT l.unit_price_paisa AS p FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE s.short_id = 'T2-OFF-000003'`);
  ok(Number(atta?.p) === 140000, 'approved price synced');
  const soapNow = Number(s.stock(s.soap.id));
  ok(soapNow === soapBefore - 102 && soapNow < 0, `stock went negative, sale kept (${soapNow})`);
  r = await R('GET', '/stock/reviews', { token: owner });
  const rv = r.json?.items ?? [];
  ok(rv.length === 1 && rv[0].product_id === s.soap.id && rv[0].short_id === 'T2-OFF-000004' && rv[0].qty_after === soapNow, `stock review flagged (${JSON.stringify(rv)})`);
  r = await R('GET', '/stock/reviews', { token: B.token });
  ok(r.status === 403, `cashier cannot see stock review (${r.status} ${r.raw.slice(0, 80)})`);
  r = await R('POST', `/stock/reviews/${rv[0].id}/resolve`, { token: owner, body: { note: 'counted' } });
  ok(r.json?.ok && (await R('GET', '/stock/reviews', { token: owner })).json.items.length === 0, 'manager resolves the review');

  // Duplicate sync: the same batch again changes nothing.
  const q = JSON.parse(fs.readFileSync(path.join(tmp, 'till2', 'offline', 'queue.json'), 'utf8'));
  ok(q.sales.length === 0 && q.synced.length === 5, 'queue on disk: 5 sent, none left');
  const dupe = await req(PORT, 'POST', '/sales/offline-sync', {
    till: A2.key,
    body: { sales: [{ clientUuid: u1, offlineNo: 1, cashierId: bilal.id, deviceAt: new Date().toISOString(), tenderedPaisa: 50000, lines: [{ productId: s.daal.id, qty: 2, unitPricePaisa: 25000 }] }] },
  });
  ok(dupe.json?.results?.[0]?.status === 'duplicate' && saleCount() === before + 6, 'duplicate sync recorded once');
  const bad = await req(PORT, 'POST', '/sales/offline-sync', {
    till: A2.key,
    body: { sales: [{ clientUuid: crypto.randomUUID(), offlineNo: 9999, cashierId: bilal.id, deviceAt: new Date().toISOString(), tenderedPaisa: 25000, lines: [{ productId: s.daal.id, qty: 1, unitPricePaisa: 25000 }] }] },
  });
  ok(bad.json?.results?.[0]?.status === 'rejected', 'number outside the till block refused');
  r = await req(PORT, 'POST', '/sales/offline-sync', { body: { sales: [] } });
  ok(r.status === 403 || r.status === 401, `offline sync needs a remote till key (${r.status})`);

  // Offline sign-in upgraded on reconnect.
  r = await A2.L('GET', '/auth/me', { token: offTok2, till: A2.key });
  ok(r.status === 200 && r.json?.session?.userId === bilal.id && !r.json.offline, 'offline sign-in turned into a real one');

  // Online: a lost answer retried with the same clientUuid is one sale.
  const u2 = crypto.randomUUID();
  const s1 = await cash(B, [{ ...daalLine, qty: 1 }], { body: { clientUuid: u2, tenderedPaisa: 25000 } });
  const s2 = await cash(B, [{ ...daalLine, qty: 1 }], { body: { clientUuid: u2, tenderedPaisa: 25000 } });
  ok(s1.status === 201 && s2.json?.duplicate === true && s2.json.sale?.shortId === s1.json?.sale?.shortId, `online retry not doubled (${s1.status} ${s1.raw.slice(0, 150)} / ${s2.raw.slice(0, 150)})`);
  r = await cash(A2, [{ ...daalLine, qty: 1 }], { token: offTok2, body: { tenderedPaisa: 25000 } });
  ok(r.status === 201 && r.json?.sale?.shortId === 'T2-000001' && !r.json.offline, `Till 2 online again: normal numbers (${r.json?.sale?.shortId})`);
} catch (e) {
  console.error('FAIL', e.stack || e.message);
  process.exitCode = 1;
} finally {
  for (const x of Object.values(links)) x.srv.close();
  proxy.close();
  for (const s of socks) s.destroy();
  await api.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (!process.exitCode) console.log(`${c.passed} checks passed`);
process.exit(process.exitCode ?? 0);
