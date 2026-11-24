#!/usr/bin/env node
/**
 * UI test (Playwright) for the P1 UX eng items:
 *  S1  open Sell bills survive leaving Sell; Sign Out asks first and then clears them
 *  PU2 half-typed New bill / order: Orders/Bills switch asks (Stay keeps it), leaving Purchases asks
 *  SC2 "Not Counted" pill has no ✓; SC3 Execution / Review are cards; SC4 Approve confirm is primary
 *  CM1 ConfirmModal takes focus, traps Tab, gives focus back
 *  ST1 Salary Run closes on Esc without clicking inside first
 *  P2  standard page header on Catalog / Customers / Suppliers / Expenses / Settings / Repack / Sell / Stock Count
 * Needs the app running (API + Vite) with the lc/mkdemo.mjs demo shop (owner PIN 2468).
 *   UI_URL=http://127.0.0.1:5173 PW_MODULES=/tmp/pw/node_modules SHOT=/workspace/ux3 node scripts/ui/ux-p1-eng.ui.mjs
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
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const dialogs = [];
let dialogMode = 'dismiss';
p.on('dialog', async (d) => {
  dialogs.push(d.message());
  if (dialogMode === 'accept') await d.accept();
  else await d.dismiss();
});
const shot = async (n, full = false) => SHOT && p.screenshot({ path: `${SHOT}-${n}.png`, fullPage: full });
const nav = async (label) => {
  await p.locator('.shell__nav-item', { hasText: label }).first().click();
  await p.waitForTimeout(900);
};
const tabsState = () =>
  p.evaluate(() => [...document.querySelectorAll('.pos-sale-tab')].map((e) => e.textContent?.replace(/\s+/g, ' ').trim()));
const signIn = async () => {
  const sel = p.locator('#user');
  await sel.waitFor();
  const opts = await sel.locator('option').allTextContents();
  await sel.selectOption({ label: opts.find((o) => /Owner/.test(o)) });
  await p.locator('#pin').fill('2468');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForTimeout(2000);
  if (await p.locator('text=I have saved this code').count()) {
    await p.locator('text=I have saved this code').click();
    await p.getByRole('button', { name: 'Done' }).click();
  }
};
const addToBill = async (q) => {
  await p.locator('#pos-search').fill(q);
  await p.waitForTimeout(700);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
};

try {
  await p.goto(URL);
  await p.waitForTimeout(1500);
  await signIn();

  // ---------- S1 ----------
  await nav('Sell');
  await addToBill('Adams Cheddar');
  await p.getByRole('button', { name: 'New bill', exact: true }).click();
  await p.waitForTimeout(300);
  await addToBill('Adams Cheddar');
  await addToBill('Adams Cheddar');
  const before = await tabsState();
  ok(before.length === 2, `S1: two open bills (${JSON.stringify(before)})`);
  ok(before.every((x) => /Rs|\d/.test(x ?? '')), 'S1: both bills have a total');
  await nav('Catalog');
  ok(dialogs.length === 0, 'S1: leaving Sell with open bills does not prompt');
  ok((await p.locator('.page-head').count()) >= 1, 'S1: Catalog opened');
  await nav('Sell');
  const after = await tabsState();
  ok(JSON.stringify(after) === JSON.stringify(before), `S1: bills kept after Catalog → Sell (${JSON.stringify(after)})`);
  await nav('Purchases');
  await nav('Sell');
  ok(JSON.stringify(await tabsState()) === JSON.stringify(before), 'S1: bills kept after Purchases → Sell');
  await shot('sell-bills-kept');

  // ---------- P2 headers ----------
  ok((await p.locator('.pos-card > .page-head .page-head__title').count()) === 1, 'P2: Sell uses PageHeader');
  for (const [label, sel] of [
    ['Catalog', '.catalog > .page-head'],
    ['Customers', '.parties > .page-head'],
    ['Suppliers', '.parties > .page-head'],
    ['Expenses', '.analytics > .page-head'],
    ['Settings', '.settings > .page-head'],
    ['Repack', '.repack-shell > .page-head'],
  ]) {
    if (label === 'Expenses' && !(await p.locator('.shell__nav-item', { hasText: 'Expenses' }).count())) continue;
    await nav(label);
    ok((await p.locator(sel).count()) === 1, `P2: ${label} uses PageHeader`);
    // UI S1: no user-name subtitle under page titles (name shows once, in the header chip).
    ok((await p.locator(`${sel} .page-head__subtitle`).count()) === 0, `P2: ${label} has no subtitle`);
    if (label === 'Catalog') await shot('headers-catalog');
    if (label === 'Settings') await shot('headers-settings');
  }

  // ---------- PU2 ----------
  await nav('Purchases');
  await p.getByRole('tab', { name: 'New bill' }).click();
  await p.waitForTimeout(900);
  await p.locator('#pur-supplier').selectOption({ label: 'Haji Traders' });
  await p.locator('#pur-search').fill('Basmati Rice Loose');
  await p.waitForTimeout(800);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  await p.keyboard.type('5');
  const lines = () => p.locator('.pl-table tbody tr[data-row], .pl-table tbody tr:has(input[data-col="qty"])').count();
  const n0 = await lines();
  ok(n0 >= 1, 'PU2: New bill has a line');
  await p.getByRole('tab', { name: 'Orders' }).click();
  await p.waitForTimeout(400);
  ok((await p.locator('.pos-modal[role="dialog"]').count()) === 1, 'PU2: Orders switch asks before dropping the bill');
  ok((await p.locator('.pos-modal h3').textContent())?.includes('Leave'), 'PU2: leave dialog title');
  // CM1 on this ConfirmModal: focus inside, Tab stays inside
  ok(await p.evaluate(() => !!document.activeElement?.closest('.pos-modal')), 'CM1: focus moved into the dialog');
  ok(await p.evaluate(() => document.activeElement?.hasAttribute('data-confirm-cancel')), 'CM1: Cancel (Stay) has focus');
  for (let i = 0; i < 4; i++) await p.keyboard.press('Tab');
  ok(await p.evaluate(() => !!document.activeElement?.closest('.pos-modal')), 'CM1: Tab is trapped in the dialog');
  await p.keyboard.press('Shift+Tab');
  ok(await p.evaluate(() => !!document.activeElement?.closest('.pos-modal')), 'CM1: Shift+Tab is trapped in the dialog');
  await shot('purchase-leave-warning');
  await p.getByRole('button', { name: 'Stay' }).click();
  await p.waitForTimeout(300);
  ok((await p.locator('.pos-modal').count()) === 0, 'PU2: Stay closes the dialog');
  ok((await p.getByRole('tab', { name: 'New bill' }).getAttribute('aria-selected')) === 'true', 'PU2: Stay keeps New bill');
  ok((await lines()) === n0, 'PU2: Stay keeps the typed line');
  ok((await p.locator('#pur-search').count()) === 1 && (await p.locator('input[data-col="qty"]').first().inputValue()) !== '', 'PU2: qty still typed');
  // Escape on the dialog = Stay, and must not also leave the bill (screen Escape)
  await p.getByRole('tab', { name: 'Bills' }).click();
  await p.waitForTimeout(300);
  ok((await p.locator('.pos-modal').count()) === 1, 'PU2: Bills switch asks too');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok((await p.locator('.pos-modal').count()) === 0 && (await lines()) === n0, 'PU2: Esc on the dialog keeps the bill');
  // Leaving Purchases from the rail: native confirm (dismiss = stay)
  dialogs.length = 0;
  dialogMode = 'dismiss';
  await nav('Catalog');
  ok(dialogs.some((m) => /unsaved/.test(m)), `PU2: leaving Purchases asks (${dialogs.join('|')})`);
  ok((await lines()) === n0, 'PU2: dismiss keeps you on the bill');
  // Leave for real via the tab dialog
  await p.getByRole('tab', { name: 'Orders' }).click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: 'Leave', exact: true }).click();
  await p.waitForTimeout(700);
  ok((await p.getByRole('tab', { name: 'Orders' }).getAttribute('aria-selected')) === 'true', 'PU2: Leave switches to Orders');
  // Orders: new order with a line is dirty too
  await p.getByRole('button', { name: 'New order' }).click();
  await p.waitForTimeout(500);
  await p.locator('#po-supplier').selectOption({ label: 'Haji Traders' });
  await p.locator('#po-add').fill('Adams Cheddar');
  await p.waitForTimeout(800);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  await p.getByRole('tab', { name: 'Bills' }).click();
  await p.waitForTimeout(300);
  ok((await p.locator('.pos-modal').count()) === 1, 'PU2: half-typed order asks on Bills switch');
  await p.getByRole('button', { name: 'Leave', exact: true }).click();
  await p.waitForTimeout(600);
  // Clean Orders → Bills: no prompt
  await p.getByRole('tab', { name: 'Orders' }).click();
  await p.waitForTimeout(500);
  await p.getByRole('tab', { name: 'Bills' }).click();
  await p.waitForTimeout(300);
  ok((await p.locator('.pos-modal').count()) === 0, 'PU2: clean tab switch does not ask');
  // Opening a saved order for receive without typing is not dirty
  await p.getByRole('tab', { name: 'Orders' }).click();
  await p.waitForTimeout(700);
  const row = p.locator('.po-list tbody tr').first();
  if (await row.count()) {
    await row.click();
    await p.waitForTimeout(700);
    const recv = p.getByRole('button', { name: 'Receive', exact: true });
    if (await recv.count()) {
      await recv.click();
      await p.waitForTimeout(800);
      await p.getByRole('tab', { name: 'Bills' }).click();
      await p.waitForTimeout(300);
      ok((await p.locator('.pos-modal').count()) === 0, 'PU2: untouched receive does not ask');
    }
  }

  // ---------- ST1 ----------
  await nav('Staff');
  await p.getByRole('button', { name: 'Run salary' }).click();
  await p.waitForTimeout(400);
  ok((await p.locator('.staff-run-modal').count()) === 1, 'ST1: Salary Run open');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok((await p.locator('.staff-run-modal').count()) === 0, 'ST1: Esc closes Salary Run without a click inside');

  // ---------- Stock Count: SC2 / SC3 / SC4 / CM1 ----------
  await nav('Stock Count');
  ok((await p.locator('.stock-count--dashboard > .page-head').count()) === 1, 'P2: Stock Count uses PageHeader');
  await p.locator('.stock-count__start').click();
  await p.waitForTimeout(1200);
  ok((await p.locator('section.card.stock-count--exec').count()) === 1, 'SC3: Execution is a card');
  const pills = await p.locator('.stock-count-pill:not(.stock-count-pill--done)').allTextContents();
  ok(pills.length > 0 && pills.every((x) => !x.includes('✓')), 'SC2: Not Counted pill has no ✓');
  await p.locator('.stock-count-stepper__btn[aria-label^="+1 "]').first().click();
  await p.waitForTimeout(1500);
  const done = await p.locator('.stock-count-pill--done').allTextContents();
  ok(done.length >= 1 && done.every((x) => x.includes('✓')), 'SC2: Counted pill keeps ✓');
  await shot('stock-count-exec-card');
  await p.getByRole('button', { name: /Review & submit/i }).first().click();
  await p.waitForTimeout(1500);
  ok((await p.locator('section.card.stock-count--review').count()) === 1, 'SC3: Review is a card');
  await shot('stock-count-review-card');
  const approve = p.getByRole('button', { name: /Approve/ }).first();
  await approve.focus();
  await approve.click();
  await p.waitForTimeout(400);
  ok((await p.locator('.pos-modal').count()) === 1, 'SC4: Approve confirm open');
  ok((await p.locator('.pos-modal .pos-modal__actions button').first().getAttribute('class'))?.includes('btn--teal'), 'SC4: Approve confirm is primary (teal)');
  ok(await p.evaluate(() => !!document.activeElement?.closest('.pos-modal')), 'CM1: Approve dialog takes focus');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok((await p.locator('.pos-modal').count()) === 0, 'CM1: Esc closes');
  ok(await p.evaluate(() => /Approve/.test(document.activeElement?.textContent ?? '')), 'CM1: focus returns to Approve');

  // ---------- S1: Sign Out asks, then clears ----------
  dialogs.length = 0;
  dialogMode = 'dismiss';
  await nav('Sell'); // Stock count review is clean → no prompt
  ok(JSON.stringify(await tabsState()) === JSON.stringify(before), 'S1: bills kept across Stock Count / Staff');
  dialogs.length = 0;
  await p.getByRole('button', { name: /Sign Out/i }).click();
  await p.waitForTimeout(600);
  ok(dialogs.some((m) => /open bill/.test(m)), `S1: Sign Out asks (${dialogs.join('|')})`);
  ok((await p.locator('#pin').count()) === 0, 'S1: dismiss keeps you signed in');
  ok(JSON.stringify(await tabsState()) === JSON.stringify(before), 'S1: dismiss keeps the bills');
  dialogMode = 'accept';
  await p.getByRole('button', { name: /Sign Out/i }).click();
  await p.waitForTimeout(1200);
  ok((await p.locator('#pin').count()) === 1, 'S1: accept signs out');
  dialogMode = 'dismiss';
  await signIn();
  await nav('Sell');
  const fresh = await tabsState();
  ok(fresh.length === 1, `S1: after Sign Out the bills are cleared (${JSON.stringify(fresh)})`);

  ok(errs.length === 0, `no page errors: ${errs.join(' | ')}`);
  console.log(`ui ux-p1-eng: ${passed} checks passed`);
} catch (e) {
  console.error(e.message);
  console.error(`(after ${passed} passing checks)`);
  if (SHOT) await p.screenshot({ path: `${SHOT}-fail.png`, fullPage: true }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await b.close();
}
