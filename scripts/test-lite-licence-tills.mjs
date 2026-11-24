#!/usr/bin/env node
/**
 * DukaanDesk Pro: the licence carries the till count. Licence enforced (DD_LICENSE_ENFORCE=1):
 * trial = 2 tills (Till 1 + one more), key tills=4 → 4, key tills=1 → extra tills stop selling.
 * Needs the owner keypair (tools/keygen init), same as test-license.
 *   DD_DB=pg node scripts/test-lite-licence-tills.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startApi, startApiOn, seed, makeChecks, root } from './lib/sales-harness.mjs';

const require = createRequire(import.meta.url);
const L = require(path.join(root, 'packages/license/src/index.js'));
const keysDir = process.env.DD_KEYS_DIR || path.join(os.homedir(), '.dukaandeskprokeys');
const priv = path.join(keysDir, 'private.pem');
if (!fs.existsSync(priv)) {
  console.log('SKIP no owner keypair (tools/keygen init)');
  process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-lictills-'));
const PORT = Number(process.env.API_PORT ?? 3971);
const env = { DD_LICENSE_ENFORCE: '1', DD_LICENSE_HOME: path.join(tmp, 'lic'), DD_TILL_LIMIT: '9' };
let api = await startApi('lite-lictills', PORT, env);
const c = makeChecks();
const { ok } = c;
const at = () => new Date().toISOString();

try {
  const s = await seed(api);
  const { owner } = s;
  let R = api.request;
  let r = await R('GET', '/license/status');
  ok(r.json?.state === 'trial', `trial (${r.json?.state})`);
  const mc = r.json.machineCode;
  r = await R('GET', '/tills', { token: owner });
  ok(r.json?.limit === 2 && r.json.used === 1, `trial: limit 2 (DD_TILL_LIMIT ignored when enforced) ${r.json?.limit}`);
  r = await R('POST', '/tills', { token: owner, body: { name: 'Counter 2' } });
  ok(r.json?.ok, 'trial: add Till 2');
  const p2 = await R('POST', '/tills/pair', { body: { code: r.json.pairCode } });
  const key2 = p2.json.deviceKey;
  r = await R('POST', '/tills', { token: owner, body: { name: 'Counter 3' } });
  ok(r.json?.ok === false && r.json.error === 'till_limit' && r.json.limit === 2, 'trial: Till 3 refused');

  const activate = async (tills) => {
    const key = L.signKey({ v: 2, type: 'full', machineCode: mc, tills, edition: 'standard', features: [], shop: 'Test Kiryana', updatesUntil: '' }, fs.readFileSync(priv, 'utf8'));
    return R('POST', '/license/activate', { body: { key } });
  };
  r = await activate(4);
  ok(r.json?.ok && r.json.status.state === 'licensed', `key with tills=4 activates ${JSON.stringify(r.json)}`);
  r = await R('GET', '/tills', { token: owner });
  ok(r.json?.limit === 4, `licensed: limit 4 (${r.json?.limit})`);
  for (const n of [3, 4]) {
    r = await R('POST', '/tills', { token: owner, body: { name: `Counter ${n}` } });
    ok(r.json?.ok && r.json.till.code === n, `licensed: add Till ${n}`);
  }
  r = await R('POST', '/tills', { token: owner, body: {} });
  ok(r.json?.ok === false && r.json.error === 'till_limit', 'licensed: Till 5 refused');

  // smaller key: Till 2 is past the limit and stops selling, Till 1 sells
  r = await activate(1);
  ok(r.json?.ok, 'key with tills=1 activates');
  const c2 = (await R('POST', '/auth/login', { till: key2, body: { userId: (await R('GET', '/auth/me', { token: s.cashier })).json.session.userId, pin: '5678' } })).json?.sessionToken;
  r = await R('POST', '/sales', { token: c2, till: key2, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.soap.id, qty: 1 }] } });
  ok(r.json?.ok === false && r.json.error === 'till_limit', `till past the licence cannot sell (${r.json?.error})`);
  r = await R('POST', '/sales', { token: owner, body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.soap.id, qty: 1 }] } });
  ok(r.json?.ok && r.json.sale.shortId.startsWith('T1-'), 'Till 1 still sells');

  // licence survives a restart
  api.stop();
  await new Promise((x) => setTimeout(x, 1000));
  api = await startApiOn(api.dbPath, PORT, { ...env, SESSION_SECRET: 'lite-lictills-secret' });
  R = api.request;
  r = await R('GET', '/tills', { token: owner });
  ok(r.json?.limit === 1, `after restart: limit 1 (${r.json?.limit})`);
} catch (e) {
  console.error('FAIL', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await api.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (!process.exitCode) console.log(`${c.passed} checks passed`);
process.exit(process.exitCode ?? 0);
