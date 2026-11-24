#!/usr/bin/env node
/**
 * Licence API test: trial -> expired READ-ONLY (reads, exports, backup, restore, login work;
 * every change -> 402 READ_ONLY) -> wrong-machine / tampered / forged keys rejected ->
 * valid key unlocks at once (no restart); clock rollback -> read-only; deleting files does not
 * reset; DD_LICENSE_TEST_DAYS hook simulates expiry (ignored when DD_LICENSE_PACKAGED=1). Uses temp licence stores (DD_LICENSE_HOME) + temp SQLite.
 * Needs the owner keypair (tools/keygen init) to sign a key for this box.
 */
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));
const L = require(path.join(root, 'packages/license/src/index.js'));
const PORT = Number(process.env.API_PORT ?? 3871);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-lic-'));
const dbPath = path.join(tmp, 'db.sqlite');
const env = { ...process.env, DD_LICENSE_ENFORCE: '1', API_PORT: String(PORT), SQLITE_PATH: dbPath, DD_LICENSE_HOME: path.join(tmp, 'lic'), WEB_ORIGIN: 'http://127.0.0.1:5173' };
const distMain = process.env.API_DIST ?? path.join(root, 'apps/api/dist/main.js');
let fails = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };

let TOKEN = null;
function req(method, p, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    if (TOKEN) { headers.Authorization = `Bearer ${TOKEN}`; headers['x-dd-session'] = TOKEN; }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, (x) => {
      let s = ''; x.on('data', (c) => (s += c)); x.on('end', () => { let j = null; try { j = JSON.parse(s); } catch {} res({ status: x.statusCode, json: j, headers: x.headers }); });
    });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
async function startApi(extra = {}) {
  const child = spawn(process.execPath, [distMain], { cwd: path.join(root, 'apps/api'), env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 120; i++) { try { if ((await req('GET', '/health')).status === 200) return child; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('api did not start');
}
async function stop(c) { c.kill(); await new Promise((r) => c.once('exit', r)); }
/** Seed every store (files + DB) as if first run was `daysAgo` and last seen `lastSeenOffsetMs` from now. */
function seed(daysAgo, lastSeenOffsetMs = 0) {
  process.env.DD_LICENSE_HOME = env.DD_LICENSE_HOME;
  const Database = require(path.join(root, 'apps/api/node_modules/better-sqlite3'));
  const db = new Database(dbPath);
  const stores = L.defaultStores(db);
  const mc = L.getMachineCode();
  const now = Date.now();
  const enc = L.encodeRecord({ firstRun: now - daysAgo * L.DAY, lastSeen: now + lastSeenOffsetMs }, mc);
  for (const s of stores) s.write(enc);
  db.close();
}

migrate(dbPath);
const keysDir = process.env.DD_KEYS_DIR || path.join(os.homedir(), '.dukaandeskprokeys');
const signFor = (mc) => L.signLicense({ machineCode: mc, edition: 'standard', features: ['reports_plus'], shop: 'Test Shop' }, fs.readFileSync(path.join(keysDir, 'private.pem'), 'utf8'));

// 1. Fresh -> trial
let api = await startApi();
let s = await req('GET', '/license/status');
check(s.json.state === 'trial' && s.json.daysLeft === 14 && s.json.readOnly === false, `fresh install -> trial 14 days (${s.json.state}, ${s.json.daysLeft})`);
check((await req('GET', '/catalog/products')).status === 401, 'trial: business route reachable (401 = needs login, not 402)');
await stop(api);

// 2. Expired -> READ-ONLY (not a lock)
seed(15);
api = await startApi();
s = await req('GET', '/license/status');
check(s.json.state === 'expired' && s.json.locked && s.json.readOnly, 'day 15 -> expired + readOnly');
check((await req('GET', '/catalog/products')).status === 401, 'read-only: GET business route open (401 = needs login, not 402)');
check((await req('GET', '/health')).status === 200, 'read-only: /health open');
const PIN = '2468';
const setup = await req('POST', '/auth/setup', { displayName: 'RO Owner', pin: PIN, storeName: 'RO Kiryana' });
check(setup.json?.ok === true && !!setup.json.sessionToken, `read-only: POST /auth/setup allowed (${setup.status})`);
TOKEN = setup.json?.sessionToken;
const pin = await req('POST', '/auth/pin-login', { userId: setup.json?.user?.id ?? setup.json?.session?.userId, pin: PIN });
check(pin.status !== 402 && pin.json?.sessionToken, `read-only: POST /auth/pin-login allowed (${pin.status})`);
if (pin.json?.sessionToken) TOKEN = pin.json.sessionToken;
check((await req('GET', '/catalog/products')).status === 200, 'read-only: GET /catalog/products 200 when signed in');
check((await req('GET', '/opening-stock/template.xlsx')).status === 200, 'read-only: Excel export (GET .xlsx) works');
check((await req('GET', '/backup')).status === 200, 'read-only: GET /backup status works');
const isRO = (r) => r.status === 402 && r.json?.code === 'READ_ONLY';
const blockedCalls = [
  ['POST', '/catalog/products', { name: 'X', sellPricePaisa: 100 }],
  ['POST', '/sales', {}],
  ['PATCH', '/settings/store', { name: 'New' }],
  ['POST', '/settings/reset-data', {}],
  ['POST', '/expenses', { amountPaisa: 100 }],
  ['DELETE', '/expenses/1', null],
  ['PUT', '/opening-stock/draft/1', {}],
  ['POST', '/cashier/till/open', {}],
  ['POST', '/parties', { name: 'Y' }],
  ['POST', '/stock/receive', {}],
  ['POST', '/backup/auto', { enabled: true }],
];
for (const [m, p, b] of blockedCalls) {
  const r = await req(m, p, b ?? undefined);
  check(isRO(r), `read-only: ${m} ${p} -> 402 READ_ONLY (${r.status} ${r.json?.code ?? ''})`);
}
const exp = await req('POST', '/backup/export', { pin: PIN });
check((exp.status === 200 || exp.status === 201) && exp.json?.header?.product === 'DukaanDesk', `read-only: POST /backup/export works (${exp.status})`);
const copyId = exp.headers['x-backup-copy-id'];
const saved = await req('POST', '/backup/saved', { copy_id: copyId });
check(saved.status === 200 || saved.status === 201, `read-only: POST /backup/saved works (${saved.status})`);
const rest = await req('POST', '/backup/restore', { pin: PIN, bundle: exp.json });
check((rest.status === 200 || rest.status === 201) && rest.json?.ok === true, `read-only: POST /backup/restore works (${rest.status})`);
const autoRun = await req('POST', '/backup/auto/run', {});
check(!isRO(autoRun), `read-only: POST /backup/auto/run not refused (${autoRun.status})`);
s = await req('GET', '/license/status');
check(s.json.state === 'expired', 'restore does not reset the trial');

// 3. Bad keys
const other = signFor('ZZZZ-ZZZZ-ZZZZ-ZZZZ');
let a = await req('POST', '/license/activate', { key: other });
check(a.json.ok === false && a.json.reason === 'wrong_machine', `key for another PC rejected (${a.json.reason})`);
const good = signFor(s.json.machineCode);
const [p, b, sig] = good.split('.');
const body = JSON.parse(Buffer.from(b, 'base64url').toString()); body.features.push('everything');
a = await req('POST', '/license/activate', { key: `${p}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${sig}` });
check(a.json.ok === false && a.json.reason === 'bad_signature', `tampered key rejected (${a.json.reason})`);
const forger = L.generateKeyPair();
a = await req('POST', '/license/activate', { key: L.signLicense({ machineCode: s.json.machineCode }, forger.privateKeyPem) });
check(a.json.ok === false && a.json.reason === 'bad_signature', 'key signed by someone else rejected');
check(isRO(await req('POST', '/sales', {})), 'still read-only after bad keys');

// 4. Good key -> full mode at once (same API process, no restart)
a = await req('POST', '/license/activate', { key: good.replace(/(.{50})/g, '$1 ') });
check(a.json.ok === true && a.json.status.state === 'licensed' && a.json.status.readOnly === false, 'correct key (with spaces from paste) activates');
const after = await req('POST', '/catalog/products', { name: 'Licensed Chai 250 g', sellPricePaisa: 25000 });
check(!isRO(after) && after.status < 500, `licensed without restart: POST /catalog/products no longer refused (${after.status})`);
check(!isRO(await req('PATCH', '/settings/store', { name: 'RO Kiryana' })), 'licensed: PATCH /settings/store no longer refused');
await stop(api);
api = await startApi();
s = await req('GET', '/license/status');
check(s.json.state === 'licensed' && s.json.licence.features.includes('reports_plus'), 'licence survives restart; feature flags present');
await stop(api);
TOKEN = null;

// 5. Clock rollback (fresh stores, last seen 3 days in the future) -> read-only too
fs.rmSync(env.DD_LICENSE_HOME, { recursive: true, force: true });
{ const Database = require(path.join(root, 'apps/api/node_modules/better-sqlite3')); const db = new Database(dbPath); db.exec('DELETE FROM license_state'); db.close(); }
seed(2, 3 * L.DAY);
api = await startApi();
s = await req('GET', '/license/status');
check(s.json.state === 'clock_rollback' && s.json.readOnly, 'clock set back 3 days -> clock_rollback, read-only');
check((await req('GET', '/catalog/products')).status === 401, 'rollback: GET business route open (401 needs login)');
check(isRO(await req('POST', '/sales', {})), 'rollback: POST /sales -> 402 READ_ONLY');
await stop(api);

// 6. Deleting the licence files alone does not reset an expired trial (DB copy remains)
{ const Database = require(path.join(root, 'apps/api/node_modules/better-sqlite3')); const db = new Database(dbPath); db.exec('DELETE FROM license_state'); db.close(); }
fs.rmSync(env.DD_LICENSE_HOME, { recursive: true, force: true });
seed(20);
fs.rmSync(env.DD_LICENSE_HOME, { recursive: true, force: true });
api = await startApi();
s = await req('GET', '/license/status');
check(s.json.state === 'expired', `files deleted, DB copy keeps trial expired (${s.json.state})`);
await stop(api);

// 7. Test hook DD_LICENSE_TEST_DAYS (fresh stores + fresh DB)
{
  const t2 = path.join(tmp, 'hook'); fs.mkdirSync(t2, { recursive: true });
  const db2 = path.join(t2, 'db.sqlite'); migrate(db2);
  api = await startApi({ SQLITE_PATH: db2, DD_LICENSE_HOME: path.join(t2, 'lic'), DD_LICENSE_TEST_DAYS: '15' });
  s = await req('GET', '/license/status');
  check(s.json.state === 'expired' && s.json.readOnly, `DD_LICENSE_TEST_DAYS=15 -> expired read-only (${s.json.state})`);
  check(isRO(await req('POST', '/sales', {})), 'hook: POST /sales -> 402 READ_ONLY');
  await stop(api);
  const t3 = path.join(tmp, 'hook2'); fs.mkdirSync(t3, { recursive: true });
  const db3 = path.join(t3, 'db.sqlite'); migrate(db3);
  api = await startApi({ SQLITE_PATH: db3, DD_LICENSE_HOME: path.join(t3, 'lic'), DD_LICENSE_TEST_DAYS: '15', DD_LICENSE_PACKAGED: '1' });
  s = await req('GET', '/license/status');
  check(s.json.state === 'trial', `hook ignored in packaged app (${s.json.state})`);
  await stop(api);
  api = await startApi({ SQLITE_PATH: db3, DD_LICENSE_HOME: path.join(t3, 'lic'), DD_LICENSE_TEST_DAYS: '-100' });
  s = await req('GET', '/license/status');
  check(s.json.state === 'trial' && s.json.daysLeft === 14, `negative hook ignored (cannot extend) (${s.json.state} ${s.json.daysLeft})`);
  await stop(api);
}

// 8. v2 features (fresh DB + stores per block)
const privPem = fs.readFileSync(path.join(keysDir, 'private.pem'), 'utf8');
const MC = L.getMachineCode();
const fresh = (name) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); const db = path.join(d, 'db.sqlite'); migrate(db); return { SQLITE_PATH: db, DD_LICENSE_HOME: path.join(d, 'lic'), _db: db }; };
const envOf = (f, more = {}) => ({ SQLITE_PATH: f.SQLITE_PATH, DD_LICENSE_HOME: f.DD_LICENSE_HOME, ...more });
const activate = (key) => req('POST', '/license/activate', { key });
TOKEN = null;
{
  // usage cap: 200 h of active use ends the trial early
  const f = fresh('usage');
  api = await startApi(envOf(f, { DD_LICENSE_TEST_USAGE_MIN: String(200 * 60) }));
  s = await req('GET', '/license/status');
  check(s.json.state === 'expired' && s.json.reason === 'usage' && s.json.readOnly, `usage cap 200 h -> read-only on day 1 (${s.json.state}/${s.json.reason})`);
  check(isRO(await req('POST', '/sales', {})), 'usage cap: POST /sales -> 402 READ_ONLY');
  await stop(api);
  const g = fresh('usage2');
  api = await startApi(envOf(g, { DD_LICENSE_TEST_USAGE_MIN: String(190 * 60) }));
  s = await req('GET', '/license/status');
  check(s.json.state === 'trial' && s.json.showHoursLeft === true && s.json.hoursLeft === 10, `190 h used -> trial, hours-left hint shown (${s.json.hoursLeft} h)`);
  check((await req('GET', '/license/heartbeat')).status === 200, 'GET /license/heartbeat 200');
  await stop(api);
  const h = fresh('usage3');
  api = await startApi(envOf(h, { DD_LICENSE_TEST_USAGE_MIN: '600' }));
  s = await req('GET', '/license/status');
  check(s.json.state === 'trial' && s.json.showHoursLeft === false, 'far from the cap -> no hours hint');
  await stop(api);
}
{
  // trial extension: +7 days once, this machine only
  const f = fresh('ext');
  api = await startApi(envOf(f, { DD_LICENSE_TEST_DAYS: '15' }));
  check((await req('GET', '/license/status')).json.state === 'expired', 'ext: trial expired first');
  const other = await activate(L.signKey({ v: 2, type: 'ext', machineCode: 'XXXX-XXXX-XXXX-XXXX', days: 7, shop: 'T' }, privPem));
  check(other.json?.ok !== true, `ext for another PC rejected (${other.json?.reason ?? other.status})`);
  const extKey = L.signKey({ v: 2, type: 'ext', machineCode: MC, days: 7, shop: 'Test Shop' }, privPem);
  let a = await activate(extKey);
  check(a.json?.ok === true && a.json.kind === 'ext' && a.json.status.state === 'trial' && a.json.status.daysLeft === 6, `ext key reopens the trial (+7 -> ${a.json?.status?.daysLeft} days left)`);
  check((await req('GET', '/catalog/products')).status === 401, 'ext: business routes open again');
  a = await activate(extKey);
  check(a.json?.ok !== true && a.json?.reason === 'ext_used', `same ext key twice -> ext_used (${a.json?.reason})`);
  const old = await activate(L.signKey({ v: 2, type: 'ext', machineCode: MC, days: 7, useBy: '2020-01-01' }, privPem));
  check(old.json?.reason === 'ext_too_old', `ext past use-by -> ext_too_old (${old.json?.reason})`);
  await stop(api);
  api = await startApi(envOf(f));
  s = await req('GET', '/license/status');
  check(s.json.state === 'trial' && s.json.extDays === 7, 'extension survives restart');
  await stop(api);
}
{
  // transfer + updates-until (DD2 full)
  const f = fresh('transfer');
  api = await startApi(envOf(f, { DD_LICENSE_TEST_DAYS: '20' }));
  const t = await activate(L.signKey({ v: 2, type: 'transfer', machineCode: MC, from: 'AAAA-BBBB-CCCC-DDDD', edition: 'standard', features: [], shop: 'Moved Shop', updatesUntil: '2099-12-31' }, privPem));
  check(t.json?.ok === true && t.json.kind === 'transfer' && t.json.status.state === 'licensed', `transfer key activates on the new PC (${t.json?.kind})`);
  s = await req('GET', '/license/status');
  check(s.json.licence?.type === 'transfer' && s.json.licence?.shop === 'Moved Shop' && s.json.licence?.updatesUntil === '2099-12-31' && s.json.updateCovered === true, 'licence shows type, shop, updates-until; build covered');
  const older = await activate(L.signKey({ v: 2, type: 'full', machineCode: MC, edition: 'standard', features: [], shop: 'Moved Shop', updatesUntil: '2030-01-01' }, privPem));
  check(older.json?.reason === 'older_key' || (older.json?.ok && older.json.status.licence.updatesUntil === '2099-12-31'), `older renewal key does not replace newer (${older.json?.reason ?? 'kept'})`);
  const extNow = await activate(L.signKey({ v: 2, type: 'ext', machineCode: MC, days: 7 }, privPem));
  check(extNow.json?.reason === 'already_licensed', `ext when licensed -> already_licensed (${extNow.json?.reason})`);
  await stop(api);
  // integrity failure reported by the desktop app -> read-only even when licensed
  api = await startApi(envOf(f, { DD_INTEGRITY_FAIL: '1' }));
  s = await req('GET', '/license/status');
  check(s.json.state === 'integrity' && s.json.readOnly, `DD_INTEGRITY_FAIL=1 -> integrity read-only (${s.json.state})`);
  check(isRO(await req('POST', '/sales', {})), 'integrity: POST /sales -> 402 READ_ONLY');
  await stop(api);
  api = await startApi(envOf(f));
  check((await req('GET', '/license/status')).json.state === 'licensed', 'integrity ok again -> licensed');
  await stop(api);
}
{
  // clock rollback against the newest sale: a sale recorded 3 days "in the future"
  const f = fresh('salerb');
  api = await startApi(envOf(f));
  check((await req('GET', '/license/status')).json.state === 'trial', 'salerb: trial');
  await stop(api);
  const Database = require(path.join(root, 'apps/api/node_modules/better-sqlite3'));
  const db = new Database(f._db);
  db.pragma('foreign_keys = OFF');
  const fut = new Date(Date.now() + 3 * L.DAY).toISOString();
  db.prepare("INSERT INTO sales (id, short_id, payment_method, total_paisa, cash_amount_paisa, udhaar_amount_paisa, client_device_at, recorded_at, created_at) VALUES ('s-fut','F1','cash',100,100,0,?,?,?)").run(fut, fut, fut.replace('T', ' ').slice(0, 19));
  db.close();
  api = await startApi(envOf(f));
  s = await req('GET', '/license/status');
  check(s.json.state === 'clock_rollback' && s.json.reason === 'data_newer' && s.json.readOnly, `sale newer than the clock -> clock_rollback (${s.json.state}/${s.json.reason})`);
  await stop(api);
}
{
  // DD1 keys still work
  const f = fresh('dd1');
  api = await startApi(envOf(f, { DD_LICENSE_TEST_DAYS: '20' }));
  const a = await activate(signFor(MC));
  check(a.json?.ok === true && a.json.status.licence.type === 'full' && a.json.status.licence.updatesUntil === '', 'DR1 key activates (full, updates unlimited)');
  await stop(api);
}
{
  // Exports allowed in read-only: POST /export/xlsx
  const f = fresh('xlsx');
  api = await startApi(envOf(f, { DD_LICENSE_TEST_DAYS: '20' }));
  const st = await req('POST', '/auth/setup', { displayName: 'X', pin: '2468', storeName: 'X' });
  TOKEN = st.json?.sessionToken;
  const r = await req('POST', '/export/xlsx', { fileName: 'r.xlsx', sheets: [{ name: 'S', rows: [['a', 1]] }] });
  check(r.status === 200 && /spreadsheetml/.test(r.headers['content-type'] || ''), `read-only: POST /export/xlsx works (${r.status})`);
  TOKEN = null;
  await stop(api);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nAll licence API checks passed');
process.exit(fails ? 1 : 0);
