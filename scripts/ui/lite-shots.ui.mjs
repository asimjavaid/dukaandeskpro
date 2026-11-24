#!/usr/bin/env node
/**
 * Lite screenshots (theme B): seeds a demo store through the API, then shoots the new screens.
 *   API (fresh PG db, DD_TILL_LIMIT=5) on API_URL, Vite on UI_URL.
 *   API_URL=http://127.0.0.1:3947 UI_URL=http://127.0.0.1:5273 OUT=/workspace node scripts/ui/lite-shots.ui.mjs
 */
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(path.join(process.env.PW_MODULES ?? '/tmp/pw/node_modules', 'x.js'));
const { chromium } = req('playwright-core');
const API = new URL(process.env.API_URL ?? 'http://127.0.0.1:3947');
const UI = process.env.UI_URL ?? 'http://127.0.0.1:5273';
const OUT = process.env.OUT ?? '/workspace';

const R = (method, p, { body, token, till } = {}) =>
  new Promise((res, rej) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
    if (token) headers['x-dd-session'] = token;
    if (till) headers['x-dd-till'] = till;
    const q = http.request({ hostname: API.hostname, port: API.port, path: p, method, headers }, (r) => {
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

// ---------- seed ----------
const owner = must(await R('POST', '/auth/setup', { body: { displayName: 'Asim Javaid', pin: '2468', storeName: 'Asim Super Store' } }), 'setup').sessionToken;
const cashier = must(await R('POST', '/owner/staff/cashiers', { token: owner, body: { displayName: 'Bilal', pin: '5678' } }), 'cashier').user;
const manager = must(await R('POST', '/owner/staff', { token: owner, body: { name: 'Mona', role: 'manager', pin: '1357' } }), 'manager').staff;
const sup = must(await R('POST', '/suppliers', { token: owner, body: { name: 'Haji Traders' } }), 'sup').supplier;
const prods = {};
for (const [name, rs, cost] of [['Sunny Atta 5 kg', 1480, 1300], ['Dalda Cooking Oil 1 L', 610, 540], ['Lux Soap 100 g', 120, 95], ['Nestle Milkpak 1 L', 340, 300], ['Tapal Danedar 190 g', 520, 450]]) {
  const p = must(await R('POST', '/catalog/products', { token: owner, body: { name, priceRs: rs, unit: 'piece', piecesPerCarton: 1 } }), name).product;
  must(await R('POST', '/stock/receive', { token: owner, body: { productId: p.id, qty: 200, unit: 'piece', amountRs: cost * 200, supplierId: sup.id } }), 'recv');
  prods[name] = p;
}
const pairTill = async (name, device) => {
  const a = must(await R('POST', '/tills', { token: owner, body: { name } }), 'add till');
  const p = must(await R('POST', '/tills/pair', { body: { code: a.pairCode, deviceName: device } }), 'pair');
  return { id: a.till.id, key: p.deviceKey };
};
const t2 = await pairTill('Counter 2', 'COUNTER-2');
const t3 = await pairTill('Counter 3', 'COUNTER-3');
must(await R('POST', '/tills', { token: owner, body: { name: 'Counter 4' } }), 'add till 4');
const sell = (token, till, lines) =>
  R('POST', '/sales', { token, till, body: { paymentMethod: 'cash', clientDeviceAt: new Date().toISOString(), lines } });
must(await R('POST', '/cashier/till/open', { token: owner, body: { floatRs: 5000 } }), 'open t1');
for (let i = 0; i < 6; i++) must(await sell(owner, undefined, [{ productId: prods['Sunny Atta 5 kg'].id, qty: 1 }, { productId: prods['Lux Soap 100 g'].id, qty: 2 }]), 'sell t1');
const cT2 = must(await R('POST', '/auth/login', { till: t2.key, body: { userId: cashier.id, pin: '5678' } }), 'login t2').sessionToken;
must(await R('POST', '/cashier/till/open', { token: cT2, till: t2.key, body: { floatRs: 3000 } }), 'open t2');
for (let i = 0; i < 9; i++) must(await sell(cT2, t2.key, [{ productId: prods['Dalda Cooking Oil 1 L'].id, qty: 1 }, { productId: prods['Nestle Milkpak 1 L'].id, qty: 1 }]), 'sell t2');
must(await R('POST', '/cashier/till/moves', { token: cT2, till: t2.key, body: { kind: 'out', amountRs: 1500, reason: 'Ice supplier' } }), 'move');
const mT3 = must(await R('POST', '/auth/login', { till: t3.key, body: { userId: manager.id, pin: '1357' } }), 'login t3').sessionToken;
for (let i = 0; i < 3; i++) must(await sell(mT3, t3.key, [{ productId: prods['Tapal Danedar 190 g'].id, qty: 2 }]), 'sell t3');
must(await R('POST', '/backup/auto/run', { token: owner, body: {} }), 'auto copy');
console.log('seeded');

// ---------- screenshots ----------
const b = await chromium.launch({ executablePath: process.env.PW_CHROME ?? '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1366, height: 800 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.error('pageerror', e.message));
const shots = [];
const shot = async (n) => {
  const f = path.join(OUT, `lite-${n}.png`);
  await p.screenshot({ path: f });
  shots.push(f);
};
const nav = async (label) => {
  await p.locator('.shell__nav-item', { hasText: label }).first().click();
  await p.waitForTimeout(1000);
};
const signIn = async (re, pin) => {
  const sel = p.locator('#user');
  await sel.waitFor();
  const opts = await sel.locator('option').allTextContents();
  await sel.selectOption({ label: opts.find((o) => re.test(o)) });
  await p.locator('#pin').fill(pin);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForTimeout(2000);
  if (await p.locator('text=I have saved this code').count()) {
    await p.locator('text=I have saved this code').click();
    await p.getByRole('button', { name: 'Done' }).click().catch(() => undefined);
    await p.waitForTimeout(500);
  }
};

try {
  await p.goto(UI);
  await p.evaluate(() => localStorage.setItem('dd-theme', 'B'));
  await p.reload();
  await p.waitForTimeout(1500);
  await signIn(/Asim/, '2468');
  // keep T2 / T3 online for the list
  await R('GET', '/tills/me', { till: t2.key });
  await nav('Tills');
  await p.waitForTimeout(800);
  await shot('p3-tills');
  await p.keyboard.press('n');
  await p.waitForTimeout(800);
  await shot('p3-pairing-code');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  await p.locator('tr[data-till-row="T2"] td').first().click();
  await p.waitForTimeout(300);
  await p.locator('tr[data-till-row="T2"]').getByRole('button', { name: 'Open till' }).click();
  await p.waitForTimeout(1200);
  await shot('p3-till-shift-t2');
  await nav('Backup');
  await p.waitForTimeout(800);
  const restoreBtn = p.locator('button', { hasText: 'Restore' }).first();
  if (await restoreBtn.count()) {
    await restoreBtn.click();
    await p.waitForTimeout(400);
  }
  await shot('p2-backup-full-restore');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  // cashier: price override + manager approval
  await p.locator('[data-sign-out], button:has-text("Sign out")').first().click().catch(() => undefined);
  await p.waitForTimeout(800);
  if (await p.locator('text=Sign out?').count()) await p.getByRole('button', { name: /Sign out/ }).last().click();
  await p.waitForTimeout(1200);
  await signIn(/Bilal/, '5678');
  await nav('Sell');
  await p.locator('#pos-search').fill('Sunny Atta');
  await p.waitForTimeout(700);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  await p.keyboard.press('F4');
  await p.waitForTimeout(500);
  await p.locator('#pos-override').fill('1400');
  await shot('p3-price-override');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  await p.locator('#pos-search').focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(800);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1200);
  if (!(await p.locator('[data-manager-approval]').count())) {
    await p.locator('button', { hasText: 'Cash received' }).first().click().catch(() => undefined);
    await p.waitForTimeout(1200);
  }
  await shot('p3-manager-approval');
  await p.locator('[data-manager-approval] input[type="password"], [data-manager-approval] input').first().fill('1357');
  await p.getByRole('button', { name: 'Approve' }).click();
  await p.waitForTimeout(1500);
  console.log('approval modal gone:', !(await p.locator('[data-manager-approval]').count()));
  await shot('p3-after-approval');
} catch (e) {
  console.error('FAIL', e.message);
  await shot('error-state').catch(() => undefined);
  process.exitCode = 1;
} finally {
  await b.close();
}
console.log(shots.join('\n'));
