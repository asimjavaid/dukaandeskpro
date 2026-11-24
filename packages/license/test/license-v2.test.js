'use strict';
/** v2: usage cap, trial extension, PC transfer, updates-until, clock vs shop data, signed manifest. */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('../src');
const { evaluate, memoryStore, generateKeyPair, signKey, signLicense, verifyLicense, machineCodeFromSources, DAY } = L;

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', name); }

const kp = generateKeyPair();
const other = generateKeyPair();
const MC = machineCodeFromSources({ machineGuid: 'aaaa-1111', cpu: 'C1', bios: 'u1', disk: 'D1' });
const MC2 = machineCodeFromSources({ machineGuid: 'bbbb-2222', cpu: 'C2', bios: 'u2', disk: 'D2' });
const T0 = Date.parse('2026-10-01T00:00:00Z');
const stores = () => [memoryStore('a'), memoryStore('b'), memoryStore('c')];
const ev = (s, now, extra = {}) => evaluate({ stores: s, machineCode: MC, publicKeyPem: kp.publicKeyPem, now, ...extra });
const H = 60;

t('usage cap: 200 active hours ends the trial before day 14', () => {
  const s = stores(); ev(s, T0);
  let r = ev(s, T0 + DAY, { addUsageMinutes: 190 * H });
  assert.strictEqual(r.state, 'trial'); assert.strictEqual(r.hoursLeft, 10); assert.strictEqual(r.showHoursLeft, true);
  r = ev(s, T0 + 2 * DAY, { addUsageMinutes: 10 * H });
  assert.strictEqual(r.state, 'expired'); assert.strictEqual(r.reason, 'usage'); assert.strictEqual(r.readOnly, true);
});
t('usage: hours hint hidden when far from cap; deleting stores keeps the highest count', () => {
  const s = stores(); ev(s, T0);
  const r = ev(s, T0 + DAY, { addUsageMinutes: 20 * H });
  assert.strictEqual(r.showHoursLeft, false);
  s[0]._set(null); s[1]._set(null);
  assert.strictEqual(ev(s, T0 + DAY).usageMinutes, 20 * H);
});
t('usage is not counted once licensed', () => {
  const s = stores(); ev(s, T0);
  ev(s, T0, { newKey: signKey({ machineCode: MC, updatesUntil: '2027-12-31' }, kp.privateKeyPem) });
  assert.strictEqual(ev(s, T0 + DAY, { addUsageMinutes: 500 * H }).state, 'licensed');
});
t('extension +7 days: reopens an expired trial, scales the usage cap', () => {
  const s = stores(); ev(s, T0);
  assert.strictEqual(ev(s, T0 + 15 * DAY).state, 'expired');
  const ext = signKey({ type: 'ext', machineCode: MC, days: 7 }, kp.privateKeyPem);
  const r = ev(s, T0 + 15 * DAY, { newKey: ext });
  assert.strictEqual(r.activated, 'ext'); assert.strictEqual(r.state, 'trial'); assert.strictEqual(r.extDays, 7);
  assert.strictEqual(r.daysLeft, 6); assert.strictEqual(r.usageCapMinutes, 300 * H);
  assert.strictEqual(ev(s, T0 + 21 * DAY + 1).state, 'expired');
});
t('extension is one-time: the same code cannot be used twice', () => {
  const s = stores(); ev(s, T0);
  const ext = signKey({ type: 'ext', machineCode: MC, days: 7 }, kp.privateKeyPem);
  ev(s, T0 + DAY, { newKey: ext });
  const r = ev(s, T0 + 2 * DAY, { newKey: ext });
  assert.strictEqual(r.activationError, 'ext_used'); assert.strictEqual(r.extDays, 7);
});
t('extension bound to machine; useBy date enforced; ignored when licensed', () => {
  const s = stores(); ev(s, T0);
  const ext2 = signKey({ type: 'ext', machineCode: MC2, days: 7 }, kp.privateKeyPem);
  assert.strictEqual(ev(s, T0, { newKey: ext2 }).activationError, 'wrong_machine');
  const old = signKey({ type: 'ext', machineCode: MC, days: 7, useBy: '2026-10-05' }, kp.privateKeyPem);
  assert.strictEqual(ev(s, T0 + 10 * DAY, { newKey: old }).activationError, 'ext_too_old');
  ev(s, T0, { newKey: signKey({ machineCode: MC }, kp.privateKeyPem) });
  assert.strictEqual(ev(s, T0, { newKey: signKey({ type: 'ext', machineCode: MC }, kp.privateKeyPem) }).activationError, 'already_licensed');
});
t('extension key never counts as a licence', () => {
  const ext = signKey({ type: 'ext', machineCode: MC, days: 7 }, kp.privateKeyPem);
  const v = verifyLicense(ext, { publicKeyPem: kp.publicKeyPem, machineCode: MC });
  assert.ok(v.ok); assert.strictEqual(v.payload.type, 'ext'); assert.deepStrictEqual(v.payload.features, []);
});
t('PC transfer key licenses the NEW machine only, records the old code', () => {
  const tr = signKey({ type: 'transfer', machineCode: MC2, from: MC, shop: 'Madina', updatesUntil: '2027-10-01' }, kp.privateKeyPem);
  assert.strictEqual(verifyLicense(tr, { publicKeyPem: kp.publicKeyPem, machineCode: MC }).reason, 'wrong_machine');
  const v = verifyLicense(tr, { publicKeyPem: kp.publicKeyPem, machineCode: MC2 });
  assert.ok(v.ok); assert.strictEqual(v.payload.from, MC.replace(/-/g, ''));
  const s = stores();
  const r = evaluate({ stores: s, machineCode: MC2, publicKeyPem: kp.publicKeyPem, now: T0, newKey: tr });
  assert.strictEqual(r.state, 'licensed'); assert.strictEqual(r.licence.type, 'transfer');
});
t('updates-until: builds on/before the date are covered; newer build warns but stays read-write', () => {
  const k = signKey({ machineCode: MC, updatesUntil: '2027-06-30' }, kp.privateKeyPem);
  const s = stores();
  let r = ev(s, T0, { newKey: k, buildDate: '2027-06-30' });
  assert.strictEqual(r.state, 'licensed'); assert.strictEqual(r.updateCovered, true); assert.strictEqual(r.licence.updatesUntil, '2027-06-30');
  r = ev(s, T0, { buildDate: '2027-07-01' });
  assert.strictEqual(r.state, 'licensed'); assert.strictEqual(r.updateCovered, false); assert.strictEqual(r.readOnly, false);
});
t('renewal key with a later updates-until replaces the old one; an older key is refused', () => {
  const s = stores();
  ev(s, T0, { newKey: signKey({ machineCode: MC, updatesUntil: '2027-06-30' }, kp.privateKeyPem) });
  let r = ev(s, T0, { newKey: signKey({ machineCode: MC, updatesUntil: '2028-06-30' }, kp.privateKeyPem), buildDate: '2027-09-01' });
  assert.strictEqual(r.licence.updatesUntil, '2028-06-30'); assert.strictEqual(r.updateCovered, true);
  r = ev(s, T0, { newKey: signKey({ machineCode: MC, updatesUntil: '2027-01-01' }, kp.privateKeyPem) });
  assert.strictEqual(r.activationError, 'older_key'); assert.strictEqual(r.licence.updatesUntil, '2028-06-30');
});
t('DR1 (v1) keys still work: full licence, updates unlimited', () => {
  const k1 = signLicense({ machineCode: MC, shop: 'Old' }, kp.privateKeyPem);
  assert.ok(k1.startsWith('DR1.'));
  const r = ev(stores(), T0, { newKey: k1, buildDate: '2030-01-01' });
  assert.strictEqual(r.state, 'licensed'); assert.strictEqual(r.updateCovered, true); assert.strictEqual(r.licence.updatesUntil, '');
});
t('DR2 key edited or signed by someone else is rejected', () => {
  const k = signKey({ machineCode: MC, updatesUntil: '2027-01-01' }, kp.privateKeyPem);
  const [p, b, sig] = k.split('.');
  const body = JSON.parse(Buffer.from(b, 'base64url').toString()); body.updatesUntil = '2099-01-01';
  assert.strictEqual(verifyLicense(`${p}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${sig}`, { publicKeyPem: kp.publicKeyPem, machineCode: MC }).reason, 'bad_signature');
  assert.strictEqual(verifyLicense(signKey({ machineCode: MC }, other.privateKeyPem), { publicKeyPem: kp.publicKeyPem, machineCode: MC }).reason, 'bad_signature');
});
t('clock behind the newest sale/backup time -> clock_rollback (data_newer); licensed unaffected', () => {
  const s = stores(); ev(s, T0);
  const r = ev(s, T0 + DAY, { dataNewest: T0 + 5 * DAY });
  assert.strictEqual(r.state, 'clock_rollback'); assert.strictEqual(r.reason, 'data_newer'); assert.strictEqual(r.readOnly, true);
  assert.strictEqual(ev(s, T0 + 5 * DAY + 1000, { dataNewest: T0 + 5 * DAY }).state, 'trial');
  assert.strictEqual(ev(stores(), T0 + DAY, { dataNewest: T0 + DAY + 3600e3 }).state, 'trial', '1h ahead tolerated');
  ev(s, T0, { newKey: signKey({ machineCode: MC }, kp.privateKeyPem) });
  assert.strictEqual(ev(s, T0, { dataNewest: T0 + 9 * DAY }).state, 'licensed');
});
t('signed manifest: intact passes; edited, missing, extra file or bad signature fail', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-man-'));
  fs.mkdirSync(path.join(dir, 'dist/license'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'node_modules/@dukaandeskpro/license/src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist/main.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'dist/license/license.guard.js'), 'guard()');
  fs.writeFileSync(path.join(dir, 'node_modules/@dukaandeskpro/license/src/state.js'), 'state()');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const m = L.signManifest(L.createManifest(dir, '2026-11-02'), kp.privateKeyPem);
  fs.writeFileSync(path.join(dir, L.MANIFEST_NAME), JSON.stringify(m));
  assert.deepStrictEqual(L.verifyManifest(dir, kp.publicKeyPem), { ok: true, buildDate: '2026-11-02' });
  assert.strictEqual(Object.keys(m.files).length, 4);
  assert.strictEqual(L.verifyManifest(dir, other.publicKeyPem).reason, 'manifest_signature');
  fs.writeFileSync(path.join(dir, 'dist/license/license.guard.js'), 'return true');
  let r = L.verifyManifest(dir, kp.publicKeyPem);
  assert.strictEqual(r.reason, 'files_changed'); assert.deepStrictEqual(r.bad, ['dist/license/license.guard.js']);
  fs.writeFileSync(path.join(dir, 'dist/license/license.guard.js'), 'guard()');
  fs.writeFileSync(path.join(dir, 'dist/evil.js'), 'x');
  assert.deepStrictEqual(L.verifyManifest(dir, kp.publicKeyPem).bad, ['dist/evil.js']);
  fs.rmSync(path.join(dir, 'dist/evil.js'));
  fs.rmSync(path.join(dir, 'node_modules/@dukaandeskpro/license/src/state.js'));
  assert.deepStrictEqual(L.verifyManifest(dir, kp.publicKeyPem).bad, ['node_modules/@dukaandeskpro/license/src/state.js']);
  const edited = { ...m, buildDate: '2099-01-01' };
  fs.writeFileSync(path.join(dir, L.MANIFEST_NAME), JSON.stringify(edited));
  assert.strictEqual(L.verifyManifest(dir, kp.publicKeyPem).reason, 'manifest_signature');
  fs.rmSync(path.join(dir, L.MANIFEST_NAME));
  assert.strictEqual(L.verifyManifest(dir, kp.publicKeyPem).reason, 'manifest_missing');
  fs.rmSync(dir, { recursive: true, force: true });
});
t('failed integrity -> read-only "integrity" state, even when licensed', () => {
  const s = stores(); ev(s, T0, { newKey: signKey({ machineCode: MC }, kp.privateKeyPem) });
  const r = ev(s, T0, { integrityOk: false });
  assert.strictEqual(r.state, 'integrity'); assert.strictEqual(r.readOnly, true);
});
t('old records (no usage/ext fields) still decode', () => {
  const s = stores();
  const body = JSON.stringify({ f: T0, l: T0, k: '', m: MC });
  const crypto = require('node:crypto');
  const mac = crypto.createHmac('sha256', crypto.createHash('sha256').update(`dd-rt-v1|${MC}|kiryana`).digest()).update(body).digest('hex').slice(0, 32);
  for (const x of s) x._set(Buffer.from(JSON.stringify({ b: body, h: mac })).toString('base64'));
  const r = ev(s, T0 + DAY);
  assert.strictEqual(r.state, 'trial'); assert.strictEqual(r.usageMinutes, 0); assert.strictEqual(r.tampered, false);
});
t('web manifest: any changed, added or removed file is caught', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-webm-'));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(dir, 'assets/app.js'), 'app()');
  const m = L.signManifest(L.createManifest(dir, '2026-11-02', 'web'), kp.privateKeyPem);
  fs.writeFileSync(path.join(dir, L.MANIFEST_NAME), JSON.stringify(m));
  assert.strictEqual(L.verifyManifest(dir, kp.publicKeyPem).ok, true);
  fs.writeFileSync(path.join(dir, 'assets/app.js'), 'app(); unlock()');
  assert.deepStrictEqual(L.verifyManifest(dir, kp.publicKeyPem).bad, ['assets/app.js']);
  fs.writeFileSync(path.join(dir, 'assets/app.js'), 'app()');
  fs.writeFileSync(path.join(dir, 'assets/inject.js'), 'x');
  assert.deepStrictEqual(L.verifyManifest(dir, kp.publicKeyPem).bad, ['assets/inject.js']);
  fs.rmSync(dir, { recursive: true, force: true });
});
console.log(`\n${n} licence v2 tests passed`);
