#!/usr/bin/env node
/**
 * UI test (Playwright): New order, PO receive and New bill share one line table.
 * Needs the app running (API + Vite) with an owner (PIN 2468), supplier "Haji Traders" and products
 * "Basmati Rice Loose" (kg, bulk), "Adams Cheddar 200 g" (carton), "7up 1.5 L" (crate).
 *   UI_URL=http://127.0.0.1:5173 PW_MODULES=/tmp/pw/node_modules PW_CHROME=/usr/bin/google-chrome SHOT=/workspace/ux node scripts/ui/purchase-lines.ui.mjs
 * Checks: keyboard flow (search autofocus, Enter qty → price → pieces / total → next row / search, Ctrl+S / Ctrl+Enter),
 * price per carton / crate, kg by total, delivery / extra charges and landed cost, paid separately, no sideways scroll at 1280x800.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const req = createRequire(path.join(process.env.PW_MODULES ?? '/tmp/pw/node_modules', 'x.js'));
const { chromium } = req('playwright-core');
const URL = process.env.UI_URL ?? 'http://127.0.0.1:5173';
const SHOT = process.env.SHOT ?? '';
let passed = 0;
const ok = (c, m) => {
  if (!c) throw new Error(`FAIL ${m}`);
  passed++;
};

const b = await chromium.launch({ executablePath: process.env.PW_CHROME ?? '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  window.open = () => null;
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const shot = async (n) => SHOT && p.screenshot({ path: `${SHOT}-${n}.png`, fullPage: true });
const active = () => p.evaluate(() => document.activeElement?.id ?? '');
const noSideways = () =>
  p.evaluate(
    () =>
      document.documentElement.scrollWidth <= window.innerWidth &&
      [...document.querySelectorAll('.pl-card, .pl-head, .pl-foot')].every((e) => e.scrollWidth <= e.clientWidth + 1),
  );
const wide = () =>
  p.evaluate(() => JSON.stringify({ doc: [document.documentElement.scrollWidth, window.innerWidth], els: [...document.querySelectorAll('.pl-card, .pl-head, .pl-foot')].map((e) => [e.className, e.scrollWidth, e.clientWidth]) }));
const enter = async () => {
  await p.keyboard.press('Enter');
  await p.waitForTimeout(120);
};

try {
  await p.goto(URL);
  await p.waitForTimeout(1500);
  const sel = p.locator('#user');
  const opts = await sel.locator('option').allTextContents();
  await sel.selectOption({ label: opts.find((o) => /Owner/.test(o)) });
  await p.locator('#pin').fill('2468');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForTimeout(2000);
  if (await p.locator('text=I have saved this code').count()) {
    await p.locator('text=I have saved this code').click();
    await p.getByRole('button', { name: 'Done' }).click();
  }
  await p.locator('.shell__nav-item', { hasText: 'Purchases' }).first().click();
  await p.waitForTimeout(1000);

  // ---- New order ----
  await p.getByRole('button', { name: 'New order' }).click();
  await p.waitForTimeout(500);
  ok((await active()) === 'po-add', 'order: product search has focus');
  await p.locator('#po-supplier').selectOption({ label: 'Haji Traders' });
  const addOrder = async (q, n) => {
    await p.locator('#po-add').fill(q);
    await p.waitForTimeout(800);
    await enter();
    await p.waitForTimeout(250);
    ok((await active()).startsWith('po-qty-'), `order: qty focused after picking ${q}`);
    await p.keyboard.type(n);
    await enter();
    ok((await active()) === 'po-add', 'order: Enter on qty goes back to search');
  };
  await addOrder('Adams Cheddar', '2');
  await addOrder('7up 1.5', '3');
  const units = await p.locator('.pl-table select[data-measure]').evaluateAll((els) => els.map((e) => e.value));
  ok(JSON.stringify(units) === JSON.stringify(['carton', 'crate']), `order: carton / crate units ${JSON.stringify(units)}`);
  ok((await p.locator('.pl-table [data-col="units"]').count()) === 0, 'order: no pieces-per-package box');
  ok(await noSideways(), 'order: no sideways scroll at 1280');
  await shot('po-after');
  await p.keyboard.press('Control+s');
  await p.waitForTimeout(1200);
  ok((await p.getByRole('button', { name: 'Receive' }).count()) === 1, 'order saved with Ctrl+S');

  // ---- Receive: price per carton / crate, pieces prefilled, delivery Rs 300 ----
  await p.getByRole('button', { name: 'Receive' }).click();
  await p.waitForTimeout(800);
  ok(JSON.stringify(await p.locator('.pl-table td.pl-c-ord').allTextContents()) === JSON.stringify(['2 ctn', '3 crates']), 'receive: Ordered column 2 ctn / 3 crates');
  ok((await active()).startsWith('po-qty-'), 'receive: first qty focused');
  await enter();
  ok((await active()).startsWith('po-cost-'), 'receive: cartons → price per carton');
  ok((await p.locator(`#${await active()}`).inputValue()) === '1200', 'receive: Rs 1,200/ctn prefilled from last bill');
  await enter();
  ok((await active()).startsWith('po-units-'), 'receive: price → pieces per carton');
  ok((await p.locator(`#${await active()}`).inputValue()) === '12', 'receive: 12 per carton prefilled');
  await enter();
  ok((await active()).startsWith('po-qty-'), 'receive: pieces → next row qty');
  await enter();
  await p.keyboard.type('1800');
  await enter();
  await p.keyboard.type('6');
  await enter();
  ok((await active()) === 'po-recv-add', 'receive: last pieces → product search');
  ok((await p.locator('.pl-table [id^="po-total-"]').count()) === 0, 'receive: carton / crate line total is read-only');
  ok(JSON.stringify(await p.locator('.pl-table .pl-total-text').allTextContents()) === JSON.stringify(['Rs 2,400', 'Rs 5,400']), 'receive: line total = cartons × price');
  ok((await p.locator('#po-xa-0').count()) === 1 && (await p.locator('.pl-extras legend').textContent()) === 'Delivery / extra charges (Rs)', 'receive: extra charges box');
  await p.locator('#po-xa-0').fill('300');
  await p.waitForTimeout(200);
  let rs = await p.locator('.pl-table [data-line-summary]').allTextContents();
  ok(rs[0].startsWith('24 pcs · Rs 103.85/pc') && rs[1].startsWith('18 pcs · Rs 311.54/pc'), `receive: landed ${rs.join(' | ')}`);
  ok((await p.locator('[data-sum="subtotal"]').textContent()) === 'Rs 7,800' && (await p.locator('[data-sum="extras"]').textContent()) === 'Rs 300', 'receive: subtotal Rs 7,800 + extra Rs 300');
  ok((await p.locator('[data-sum="remaining"]').textContent()) === 'Rs 8,100', 'receive: remaining Rs 8,100');
  await p.locator('#po-xs-0').check();
  await p.waitForTimeout(150);
  ok((await p.locator('[data-sum="remaining"]').textContent()) === 'Rs 7,800' && (await p.locator('[data-sum="extras"]').count()) === 0, 'receive: paid separately → not owed');
  rs = await p.locator('.pl-table [data-line-summary]').allTextContents();
  ok(rs[0].startsWith('24 pcs · Rs 103.85/pc'), 'receive: paid separately still in landed cost');
  await p.locator('#po-xs-0').uncheck();
  ok(await noSideways(), `receive: no sideways scroll at 1280 ${await wide()}`);
  await shot('receive-after');
  await p.locator('#po-recv-add').focus();
  await p.keyboard.press('Control+Enter');
  await p.waitForTimeout(2500);
  if (await p.locator('[data-price-check]').count()) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(600);
  }
  await p.waitForSelector('.po-status:has-text("Received")', { timeout: 5000 }).catch(() => undefined);
  ok((await p.locator('.po-status', { hasText: 'Received' }).count()) >= 1, `receive saved with Ctrl+Enter ${await p.locator('.form-error, [role=alert]').allTextContents()} ${(await p.locator('main').innerText()).slice(0, 300)}`);
  ok((await p.locator('.po-bill', { hasText: 'Rs 8,100' }).count()) >= 1, 'receive: bill Rs 8,100 incl. delivery');

  // ---- New bill: rice by total + 7up by crate, delivery + paid-separately loading ----
  await p.getByRole('tab', { name: 'New bill' }).click();
  await p.waitForTimeout(900);
  ok((await active()) === 'pur-search', 'bill: product search has focus');
  await p.locator('#pur-supplier').selectOption({ label: 'Haji Traders' });
  await p.locator('#pur-search').fill('Basmati Rice Loose');
  await p.waitForTimeout(800);
  await enter();
  await p.waitForTimeout(500);
  ok((await active()).startsWith('pur-qty-'), 'bill: qty focused after pick');
  await p.keyboard.type('50');
  await enter();
  ok((await active()).startsWith('pur-total-'), 'bill: kg qty → total');
  await p.keyboard.type('15000');
  await enter();
  ok((await active()) === 'pur-search', 'bill: total → search');
  await p.locator('#pur-search').fill('7up 1.5');
  await p.waitForTimeout(800);
  await enter();
  await p.waitForTimeout(600);
  await p.keyboard.type('3');
  await enter();
  ok((await active()).startsWith('pur-cost-'), 'bill: crates → price per crate');
  ok((await p.locator(`#${await active()}`).inputValue()) === '1800', 'bill: Rs 1,800/crate prefilled');
  await enter();
  ok((await active()).startsWith('pur-units-') && (await p.locator(`#${await active()}`).inputValue()) === '6', 'bill: 6 per crate prefilled');
  await enter();
  ok((await active()) === 'pur-search', 'bill: back to search');
  ok((await p.locator('.purchases-lines__result, .purchases-aside, .purchases-savebar, #pur-perunit').count()) === 0, 'bill: no old panels / per-unit toggle');
  await p.locator('#pur-xa-0').fill('300');
  await p.locator('#pur-xadd').click();
  await p.locator('#pur-xl-1').fill('Loading');
  await p.locator('#pur-xa-1').fill('100');
  await p.locator('#pur-xs-1').check();
  await p.waitForTimeout(200);
  const bs = await p.locator('.pl-table [data-line-summary]').allTextContents();
  ok(bs[0].startsWith('Rs 305.88/kg') && bs[1].startsWith('18 pcs · Rs 305.88/pc'), `bill landed ${bs.join(' | ')}`);
  ok((await p.locator('[data-sum="subtotal"]').textContent()) === 'Rs 20,400' && (await p.locator('[data-sum="extras"]').textContent()) === 'Rs 300', 'bill: subtotal Rs 20,400, owed extra Rs 300');
  ok((await p.locator('[data-sum="remaining"]').textContent()) === 'Rs 20,700', 'bill: remaining Rs 20,700');
  ok(await noSideways(), `bill: no sideways scroll at 1280 ${await wide()}`);
  await shot('bill-after');
  await p.locator('#pur-search').focus();
  await p.keyboard.press('Control+Enter');
  await p.waitForTimeout(2500);
  if (await p.locator('[data-price-check]').count()) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(600);
  }
  ok((await p.locator('.pl-table').count()) === 0, 'bill saved with Ctrl+Enter');
  if (!(await p.locator('[data-bill-extra]').count())) {
    await p.getByRole('button', { name: 'Open' }).first().click();
    await p.waitForSelector('[data-bill-extra]', { timeout: 5000 }).catch(() => undefined);
  }
  await shot('bill-detail');
  const ex = await p.locator('[data-bill-extra]').allTextContents();
  ok(ex.length === 2 && ex[0].includes('Delivery') && ex[0].includes('Rs 300') && ex[1].includes('Loading (paid separately)'), `bill detail shows extras ${ex.join(' | ')}`);
  ok((await p.locator('[data-landed]').allTextContents()).sort().join('|') === 'Rs 305.88/kg|Rs 305.88/pc', 'bill detail shows landed cost');
  ok(errs.length === 0, `no page errors ${errs.join('; ')}`);
  console.log(`ui purchase-lines: ${passed} checks passed`);
} finally {
  await b.close();
}
