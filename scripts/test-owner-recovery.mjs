#!/usr/bin/env node
/**
 * Owner PIN: reset staff PIN, change own PIN (current verified), recovery code
 * (hashed, one-time, rate-limited), CLI reset script.
 * Run: node scripts/test-owner-recovery.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { startApi, seed, makeChecks, root, Database } from './lib/sales-harness.mjs';

const c = makeChecks();
const { ok } = c;
let api = await startApi('owner-recovery', Number(process.env.API_PORT ?? 3883));
let R = api.request;
const login = (userId, pin) => R('POST', '/auth/login', { body: { userId, pin } });

try {
  const s = await seed(api);
  let { owner } = s;
  const { cashier } = s;
  const ownerId = (await R('GET', '/auth/users')).json.users.find((u) => u.role === 'owner').id;

  // Route protection
  ok((await R('GET', '/auth/recovery')).status === 401, 'recovery status needs session');
  ok((await R('POST', '/auth/recovery/generate', { token: cashier })).status === 403, 'cashier cannot issue code');

  // Staff PIN reset by owner
  let r = await R('POST', '/owner/staff', { token: owner, body: { name: 'Zara', role: 'cashier', pin: '1111' } });
  const zara = r.json.staff;
  r = await R('POST', `/owner/staff/${zara.id}/pin`, { token: owner, body: { pin: '2222' } });
  ok(r.json?.ok, 'owner resets staff PIN');
  ok(!(await login(zara.id, '1111')).json.ok && (await login(zara.id, '2222')).json.ok, 'new staff PIN works, old fails');
  r = await R('POST', `/owner/staff/${ownerId}/pin`, { token: owner, body: { pin: '9999' } });
  ok(!r.json?.ok, 'owner PIN not resettable via staff reset');

  // Own PIN change
  r = await R('POST', '/settings/pin', { token: owner, body: { current_pin: '0000', new_pin: '1357' } });
  ok(r.status === 401, 'wrong current PIN rejected');
  r = await R('POST', '/settings/pin', { token: owner, body: { current_pin: '2468', new_pin: '1357' } });
  ok(r.json?.ok, 'owner changes own PIN');
  ok(typeof r.json?.sessionToken === 'string', 'fresh session after own PIN change');
  owner = r.json.sessionToken;
  ok((await login(ownerId, '1357')).json.ok, 'owner logs in with new PIN');

  // Recovery code
  r = await R('GET', '/auth/recovery', { token: owner });
  ok(r.json.has_code === false && r.json.acknowledged === false, 'no code yet → prompt');
  r = await R('POST', '/auth/recovery/generate', { token: owner });
  const code1 = r.json.code;
  ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code1), 'code format XXXX-XXXX-XXXX');
  ok((await R('GET', '/auth/recovery', { token: owner })).json.acknowledged === false, 'unacknowledged until ack');
  ok((await R('POST', '/auth/recovery/ack', { token: owner })).json.ok, 'ack');
  ok((await R('GET', '/auth/recovery', { token: owner })).json.acknowledged === true, 'acknowledged');
  const db = new Database(api.dbPath, { readonly: true });
  const row = db.prepare('SELECT code_hash FROM owner_recovery WHERE user_id = ?').get(ownerId);
  ok(row.code_hash.startsWith('scrypt$') && !row.code_hash.includes(code1.replace(/-/g, '')), 'stored as hash only');
  db.close();

  r = await R('POST', '/auth/recover', { body: { code: code1, newPin: '4444', confirmPin: '5555' } });
  ok(r.json?.error === 'pin_mismatch', 'confirm mismatch');
  r = await R('POST', '/auth/recover', { body: { code: code1, newPin: '44a4' } });
  ok(r.json?.error === 'invalid_pin', 'bad PIN format');
  r = await R('POST', '/auth/recover', { body: { code: code1.toLowerCase().replace(/-/g, ' '), newPin: '4444', confirmPin: '4444' } });
  ok(r.json?.ok && r.json.session.role === 'owner' && r.json.sessionToken, 'recover with code (case/spacing tolerant) → owner session');
  const code2 = r.json.code;
  ok(code2 && code2 !== code1, 'fresh code issued');
  ok((await login(ownerId, '4444')).json.ok && !(await login(ownerId, '1357')).json.ok, 'owner PIN replaced');
  ok((await R('GET', '/auth/recovery', { token: r.json.sessionToken })).json.acknowledged === false, 'fresh code must be acknowledged');
  r = await R('POST', '/auth/recover', { body: { code: code1, newPin: '5555', confirmPin: '5555' } });
  ok(r.json?.error === 'bad_recovery_code', 'old code invalidated');

  // Rate limit: 5 fails in window (1 above + 4 more) → locked, even with good code
  for (let i = 0; i < 4; i++) {
    r = await R('POST', '/auth/recover', { body: { code: 'AAAA-BBBB-CCCC', newPin: '5555' } });
  }
  ok(r.json?.error === 'bad_recovery_code', 'bad codes rejected');
  r = await R('POST', '/auth/recover', { body: { code: code2, newPin: '5555', confirmPin: '5555' } });
  ok(r.json?.error === 'too_many_attempts' && r.json.retry_after_s > 0, 'rate limited after 5 fails');

  // CLI reset (API stopped)
  api.stop();
  await new Promise((res) => setTimeout(res, 800));
  const cli = path.join(root, 'scripts/reset-owner-pin.mjs');
  let p = spawnSync(process.execPath, [cli, '--db', api.dbPath, '--pin', '12'], { encoding: 'utf8' });
  ok(p.status !== 0 && /4 to 6 digits/.test(p.stderr), 'CLI rejects bad PIN');
  p = spawnSync(process.execPath, [cli, '--db', api.dbPath, '--pin', '8642'], { encoding: 'utf8' });
  const m = /New recovery code:\s+([A-Z2-9-]{14})/.exec(p.stdout);
  ok(p.status === 0 && m, 'CLI resets and prints code');

  // Restart same DB: CLI PIN works, CLI code works, rate limit cleared by the CLI reset
  const { spawn } = await import('node:child_process');
  const port = 3884;
  const child = spawn('node', [path.join(root, 'apps/api/dist/main.js')], {
    cwd: path.join(root, 'apps/api'),
    env: { ...process.env, API_PORT: String(port), SQLITE_PATH: api.dbPath, SESSION_SECRET: 'x', TAX_PROCESS_INTERVAL_MS: '0' },
    stdio: 'ignore',
  });
  const http = await import('node:http');
  R = (method, urlPath, { body } = {}) =>
    new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        { hostname: '127.0.0.1', port, path: urlPath, method, headers: payload ? { 'Content-Type': 'application/json' } : {} },
        (res) => {
          let raw = '';
          res.on('data', (d) => (raw += d));
          res.on('end', () => resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : null }));
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  for (let i = 0; i < 120; i++) {
    try { if ((await R('GET', '/health')).status === 200) break; } catch { /* */ }
    await new Promise((res) => setTimeout(res, 250));
  }
  try {
    ok((await login(ownerId, '8642')).json.ok, 'owner logs in with CLI PIN');
    r = await R('POST', '/auth/recover', { body: { code: m[1], newPin: '7777', confirmPin: '7777' } });
    ok(r.json?.ok, 'CLI recovery code works');
  } finally {
    child.kill('SIGTERM');
  }

  console.log(`\nOWNER PIN + RECOVERY OK (${c.passed} checks)`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  try { api.stop(); } catch { /* */ }
}
