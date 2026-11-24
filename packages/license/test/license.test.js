'use strict';
const assert = require('node:assert');
const L = require('../src');
const { evaluate, memoryStore, generateKeyPair, signLicense, verifyLicense, machineCodeFromSources, DAY } = L;

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', name); }

const kp = generateKeyPair();
const other = generateKeyPair();
const MC = machineCodeFromSources({ machineGuid: 'aaaa-1111', cpu: 'BFEBFBFF000906EA', bios: 'uuid-1', disk: 'WD-123' });
const MC2 = machineCodeFromSources({ machineGuid: 'bbbb-2222', cpu: 'BFEBFBFF000906EA', bios: 'uuid-2', disk: 'WD-999' });
const T0 = Date.parse('2026-10-01T00:00:00Z');
const stores = () => [memoryStore('a'), memoryStore('b'), memoryStore('c')];
const ev = (s, now, extra = {}) => evaluate({ stores: s, machineCode: MC, publicKeyPem: kp.publicKeyPem, now, ...extra });

t('machine code is stable, grouped, differs per machine', () => {
  assert.match(MC, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  assert.strictEqual(MC, machineCodeFromSources({ machineGuid: 'aaaa-1111', cpu: 'BFEBFBFF000906EA', bios: 'uuid-1', disk: 'WD-123' }));
  assert.notStrictEqual(MC, MC2);
});
t('fresh install starts 14-day trial', () => {
  const r = ev(stores(), T0);
  assert.strictEqual(r.state, 'trial'); assert.strictEqual(r.daysLeft, 14); assert.strictEqual(r.locked, false);
});
t('trial runs out after 14 days -> hard lock', () => {
  const s = stores(); ev(s, T0);
  assert.strictEqual(ev(s, T0 + 13 * DAY).state, 'trial');
  const r = ev(s, T0 + 14 * DAY + 1);
  assert.strictEqual(r.state, 'expired'); assert.strictEqual(r.locked, true);
});
t('deleting some stores does not reset trial', () => {
  const s = stores(); ev(s, T0);
  s[0]._set(null); s[1]._set(null);
  const r = ev(s, T0 + 20 * DAY);
  assert.strictEqual(r.state, 'expired');
  assert.ok(s[0]._peek(), 'healed store 0');
});
t('edited record is treated as tampered and locks', () => {
  const s = stores(); ev(s, T0);
  const forged = L.encodeRecord({ firstRun: T0 + 30 * DAY, lastSeen: T0 + 30 * DAY }, MC).replace(/.$/, 'A');
  for (const x of s) x._set(Buffer.from(JSON.stringify({ b: JSON.stringify({ f: T0 + 30 * DAY, l: T0, k: '', m: MC }), h: '0'.repeat(32) })).toString('base64'));
  const r = ev(s, T0 + DAY);
  assert.strictEqual(r.tampered, true); assert.strictEqual(r.state, 'expired');
  void forged;
});
t('records copied from another PC are rejected', () => {
  const s = stores(); evaluate({ stores: s, machineCode: MC2, publicKeyPem: kp.publicKeyPem, now: T0 });
  const r = ev(s, T0 + DAY);
  assert.strictEqual(r.tampered, true); assert.strictEqual(r.locked, true);
});
t('clock rollback is detected', () => {
  const s = stores(); ev(s, T0); ev(s, T0 + 10 * DAY);
  const r = ev(s, T0 + 2 * DAY);
  assert.strictEqual(r.state, 'clock_rollback'); assert.strictEqual(r.locked, true);
  // lastSeen not pulled back; fixing the clock restores trial
  assert.strictEqual(ev(s, T0 + 10 * DAY + 1000).state, 'trial');
});
t('small clock correction (<2h) is tolerated', () => {
  const s = stores(); ev(s, T0 + 3600e3 * 5);
  assert.strictEqual(ev(s, T0 + 3600e3 * 4).state, 'trial');
});
const key = signLicense({ machineCode: MC, edition: 'standard', features: ['whatsapp', 'loyalty'], shop: 'Test Kiryana', issuedAt: '2026-10-13T00:00:00Z' }, kp.privateKeyPem);
t('valid key activates after expiry, no expiry, survives clock rollback', () => {
  const s = stores(); ev(s, T0);
  const r = ev(s, T0 + 40 * DAY, { newKey: key });
  assert.strictEqual(r.state, 'licensed'); assert.deepStrictEqual(r.licence.features, ['loyalty', 'whatsapp']);
  assert.strictEqual(ev(s, T0 + 4000 * DAY).state, 'licensed');
  assert.strictEqual(ev(s, T0).state, 'licensed');
  assert.ok(L.hasFeature(r, 'loyalty')); assert.ok(!L.hasFeature(r, 'scale'));
});
t('key accepts grouping/whitespace from WhatsApp paste', () => {
  assert.ok(verifyLicense(key.replace(/(.{40})/g, '$1\n '), { publicKeyPem: kp.publicKeyPem, machineCode: MC.toLowerCase() }).ok);
});
t('key on wrong machine is rejected (no two shops on one key)', () => {
  assert.strictEqual(verifyLicense(key, { publicKeyPem: kp.publicKeyPem, machineCode: MC2 }).reason, 'wrong_machine');
  const s = stores();
  const r = evaluate({ stores: s, machineCode: MC2, publicKeyPem: kp.publicKeyPem, now: T0 + 40 * DAY, newKey: key });
  assert.strictEqual(r.activationError, 'wrong_machine'); assert.notStrictEqual(r.state, 'licensed');
});
t('licensed record copied to another PC does not license it', () => {
  const s = stores(); ev(s, T0, { newKey: key });
  const r = evaluate({ stores: s, machineCode: MC2, publicKeyPem: kp.publicKeyPem, now: T0 + DAY });
  assert.notStrictEqual(r.state, 'licensed');
});
t('tampered key rejected (payload edited, sig edited, other signer)', () => {
  const [p, b, sig] = key.split('.');
  const body = JSON.parse(Buffer.from(b, 'base64url').toString());
  body.features.push('everything');
  const b2 = Buffer.from(JSON.stringify(body)).toString('base64url');
  assert.strictEqual(verifyLicense(`${p}.${b2}.${sig}`, { publicKeyPem: kp.publicKeyPem, machineCode: MC }).reason, 'bad_signature');
  const sigBad = Buffer.from(sig, 'base64url'); sigBad[5] ^= 1;
  assert.strictEqual(verifyLicense(`${p}.${b}.${sigBad.toString('base64url')}`, { publicKeyPem: kp.publicKeyPem, machineCode: MC }).reason, 'bad_signature');
  const forged = signLicense({ machineCode: MC }, other.privateKeyPem);
  assert.strictEqual(verifyLicense(forged, { publicKeyPem: kp.publicKeyPem, machineCode: MC }).reason, 'bad_signature');
  assert.strictEqual(verifyLicense('hello', { publicKeyPem: kp.publicKeyPem, machineCode: MC }).reason, 'bad_format');
});
t('stored key that stops verifying falls back to trial/expired', () => {
  const s = stores(); ev(s, T0, { newKey: key });
  const r = evaluate({ stores: s, machineCode: MC, publicKeyPem: other.publicKeyPem, now: T0 + 30 * DAY });
  assert.strictEqual(r.state, 'expired');
});
t('this machine yields a code', () => { assert.match(L.getMachineCode(), /^[0-9A-Z]{4}-/); });
console.log(`\n${n} licence tests passed`);
