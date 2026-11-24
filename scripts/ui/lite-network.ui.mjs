#!/usr/bin/env node
/**
 * Lite P4 screenshots (theme B): a till-only PC (till-link) connecting to a LAN main PC.
 * Starts its own API (DD_LAN=1, fresh PG db) and a till-link, then: connect (found on the
 * network) → pair → cashier sells → main PC stops (till sells offline, T2-OFF numbers) → main PC back
 * → queue sent, Synced → normal numbers again.
 *   env -u NODE_OPTIONS node scripts/ui/lite-network.ui.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const req = createRequire(path.join(process.env.PW_MODULES ?? '/tmp/pw/node_modules', 'x.js'));
const { chromium } = req('playwright-core');
const { startTillLink } = createRequire(import.meta.url)(path.join(root, 'apps/desktop/src/till-link.js'));
const OUT = process.env.OUT ?? '/workspace';
const PORT = 3961;
const DISC = 3969;
const TILL_PORT = 4181;
const lanIp = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal).address;
const work = '/tmp/lite-net';
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const dbPath = path.join(work, 'shop.db');

let apiChild = null;
const startApi = async () => {
  apiChild = spawn('node', [path.join(root, 'apps/api/dist/main.js')], {
    cwd: path.join(root, 'apps/api'),
    env: { ...process.env, DD_DB: 'pg', DD_LAN: '1', DD_DISCOVERY_PORT: String(DISC), API_PORT: String(PORT), SQLITE_PATH: dbPath, SESSION_SECRET: 'net-shots', DD_TILL_LIMIT: '3', TAX_PROCESS_INTERVAL_MS: '0', AUTO_BACKUP_INTERVAL_MS: '0' },
    stdio: ['ignore', fs.openSync(path.join(work, 'api.log'), 'a'), fs.openSync(path.join(work, 'api.log'), 'a')],
  });
  for (let i = 0; i < 120; i++) {
    if ((await R('GET', '/health').catch(() => ({ status: 0 }))).status === 200) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('api did not start');
};
const stopApi = () => new Promise((res) => { apiChild.once('exit', res); apiChild.kill('SIGTERM'); });

const R = (method, p, { body, token, till } = {}) =>
  new Promise((res, rej) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
    if (token) headers['x-dd-session'] = token;
    if (till) headers['x-dd-till'] = till;
    const q = http.request({ hostname: '127.0.0.1', port: PORT, path: p, method, headers }, (r) => {
      let raw = '';
      r.on('data', (c) => (raw += c));
      r.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* */ }
        res({ status: r.statusCode, json, raw });
      });
    });
    q.on('error', rej);
    if (payload) q.write(payload);
    q.end();
  });
const must = (r, what) => {
  if (!(r.status < 300) || r.json?.ok === false) throw new Error(`${what}: ${r.status} ${r.raw.slice(0, 200)}`);
  return r.json;
};

await startApi();
const owner = must(await R('POST', '/auth/setup', { body: { displayName: 'Asim Javaid', pin: '2468', storeName: 'Asim Super Store' } }), 'setup').sessionToken;
must(await R('POST', '/owner/staff/cashiers', { token: owner, body: { displayName: 'Bilal', pin: '5678' } }), 'cashier');
const sup = must(await R('POST', '/suppliers', { token: owner, body: { name: 'Haji Traders' } }), 'sup').supplier;
for (const [name, rs, cost] of [['Sunny Atta 5 kg', 1480, 1300], ['Dalda Cooking Oil 1 L', 610, 540], ['Lux Soap 100 g', 120, 95]]) {
  const p = must(await R('POST', '/catalog/products', { token: owner, body: { name, priceRs: rs, unit: 'piece', piecesPerCarton: 1 } }), name).product;
  must(await R('POST', '/stock/receive', { token: owner, body: { productId: p.id, qty: 200, unit: 'piece', amountRs: cost * 200, supplierId: sup.id } }), 'recv');
}
const added = must(await R('POST', '/tills', { token: owner, body: { name: 'Counter 2' } }), 'add till');
const link = await startTillLink({ webDir: path.join(root, 'apps/web/dist'), port: TILL_PORT, configFile: path.join(work, 'till.json'), discoveryPort: DISC, discoveryTargets: [lanIp] });
console.log('seeded; main PC', `${lanIp}:${PORT}`);

const b = await chromium.launch({ executablePath: process.env.PW_CHROME ?? '/usr/bin/google-chrome' });
const p = await (await b.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
p.on('pageerror', (e) => console.error('pageerror', e.message));
const shots = [];
const shot = async (n) => { const f = path.join(OUT, `lite-${n}.png`); await p.screenshot({ path: f }); shots.push(f); };
const checks = [];
const check = (cond, msg) => { checks.push(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };

try {
  await p.goto(`http://127.0.0.1:${TILL_PORT}/`);
  await p.evaluate(() => localStorage.setItem('dd-theme', 'B'));
  await p.reload();
  await p.locator('.link-list__item').first().waitFor({ timeout: 8000 });
  check(await p.locator('.link-list__item', { hasText: `${lanIp}:${PORT}` }).count() === 1, 'connect screen lists the main PC found on the network');
  await shot('p4-connect');
  await p.keyboard.press('Enter');
  await p.locator('#link-code').waitFor();
  await p.locator('#link-code').fill(added.pairCode);
  await p.locator('#link-name').fill('COUNTER-2');
  await shot('p4-pair');
  await p.keyboard.press('Enter');
  const sel = p.locator('#user');
  await sel.waitFor({ timeout: 10000 });
  check(true, 'paired: sign-in screen');
  const opts = await sel.locator('option').allTextContents();
  await sel.selectOption({ label: opts.find((o) => /Bilal/.test(o)) });
  await p.locator('#pin').fill('5678');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForTimeout(2000);
  await p.locator('.shell__nav-item', { hasText: 'Sell' }).first().click();
  await p.waitForTimeout(1000);
  for (const q of ['Sunny Atta', 'Lux Soap']) {
    await p.locator('#pos-search').fill(q);
    await p.waitForTimeout(600);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
  }
  const lines = () => p.locator('[data-bill-row-key]').count();
  check((await lines()) === 2, 'two items on the bill');

  const pay = async () => {
    await p.locator('#pos-search').focus();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(800);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1500);
  };
  check(await p.locator('[data-link-status="synced"]').count() === 1, 'top bar: Synced');

  // Main PC stops: the till keeps selling from its copy.
  await stopApi();
  await p.locator('[data-link-status="offline"]').waitFor({ timeout: 8000 });
  check(await p.locator('[data-link-down]').count() === 0, 'main PC stopped: no block, Offline shown');
  check((await lines()) === 2, 'bill kept');
  await pay();
  check(await p.locator('text=/Sale complete · T2-OFF-000001/').count() === 1, 'offline sale T2-OFF-000001');
  await p.locator('#pos-search').fill('Dalda');
  await p.waitForTimeout(600);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  await pay();
  check(await p.locator('text=/Sale complete · T2-OFF-000002/').count() === 1, 'second offline sale');
  await p.waitForTimeout(800);
  check((await p.locator('[data-link-status="offline"]').innerText()).includes('2'), 'top bar: Offline 2');
  const nav = (await p.locator('.shell__nav-item').allInnerTexts()).filter((x) => x.trim() && !/Sign out/.test(x));
  check(nav.length === 1 && /Sell/.test(nav[0]), `only Sell in the menu while offline (${nav.join('|')})`);
  check(/\b199\b/.test(await p.locator('body').innerText()), 'copy stock moves with offline sales');
  await shot('offline-selling');

  await startApi();
  await p.locator('[data-link-status="synced"]').waitFor({ timeout: 15000 });
  check(true, 'main PC back: queue sent, Synced');
  const n = must(await R('GET', '/sales?limit=10', { token: owner }), 'sales');
  const all = JSON.stringify(n);
  check(all.includes('T2-OFF-000001') && all.includes('T2-OFF-000002'), 'main PC has the offline bills');
  await p.locator('#pos-search').fill('Lux Soap');
  await p.waitForTimeout(600);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  await pay();
  check(await p.locator('text=/Sale complete · T2-000001/').count() === 1, 'online again: T2-000001');
  await shot('offline-synced');
} catch (e) {
  console.error('FAIL', e.message);
  await shot('p4-error-state').catch(() => undefined);
  process.exitCode = 1;
} finally {
  await b.close();
  link.close();
  if (apiChild && apiChild.exitCode === null) await stopApi();
}
console.log(checks.join('\n'));
console.log(shots.join('\n'));
