#!/usr/bin/env node
/**
 * DukaanDesk Pro main PC service entry (apps/desktop/src/server-service.js) with an installer-style
 * server.json: DATABASE_URL database, LAN on, server-only mode, backup folder, licence home,
 * session secret file. Linux stand-in for the Windows service (WinSW itself is untested).
 *   DD_DB=pg node scripts/test-lite-server-service.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { root, makeChecks } from './lib/sales-harness.mjs';

const PORT = Number(process.env.API_PORT ?? 3981);
const lanIp = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address;
const server = (process.env.DD_PG_SERVER || 'postgres://postgres@127.0.0.1:5433').replace(/\/+$/, '');
const dbName = 'dd_service_test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-svc-'));
const pgBin = process.env.DD_PG_BIN;
const psql = (sql) => execFileSync(path.join(pgBin, 'psql'), [`${server}/postgres`, '-Atc', sql], { env: { ...process.env, LD_LIBRARY_PATH: process.env.DD_PG_LIB ?? '' } }).toString().trim();
if (!pgBin) {
  console.log('SKIP DD_PG_BIN not set');
  process.exit(0);
}
psql(`DROP DATABASE IF EXISTS ${dbName}`);
psql(`CREATE DATABASE ${dbName} TEMPLATE template0 ENCODING 'UTF8'`);
fs.writeFileSync(path.join(tmp, 'session.secret'), 'svc-secret-123');
const cfgFile = path.join(tmp, 'server.json');
fs.writeFileSync(cfgFile, JSON.stringify({
  databaseUrl: `${server}/${dbName}`, pgBin, pgLib: process.env.DD_PG_LIB, lan: true, installMode: 'server-only', apiPort: PORT,
  backupDir: path.join(tmp, 'backups'), licenceHome: path.join(tmp, 'lic'), sessionSecretFile: path.join(tmp, 'session.secret'),
}));
const env = { ...process.env, DD_SERVER_CONFIG: cfgFile, DD_API_MAIN: path.join(root, 'apps/api/dist/main.js'), TAX_PROCESS_INTERVAL_MS: '0' };
for (const k of ['DD_DB', 'SQLITE_PATH', 'API_PORT', 'DATABASE_URL', 'DD_LAN', 'DD_INSTALL_MODE', 'DD_BACKUP_DIR', 'SESSION_SECRET', 'DD_LICENSE_HOME']) delete env[k];

let child;
const start = async () => {
  child = spawn(process.execPath, [path.join(root, 'apps/desktop/src/server-service.js')], { cwd: path.join(root, 'apps/api'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => process.stderr.write(`[svc] ${d}`));
  for (let i = 0; i < 160; i++) {
    if ((await R('127.0.0.1', 'GET', '/health')).status === 200) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('service did not start');
};
const stop = () => new Promise((res) => { child.once('exit', res); child.kill('SIGTERM'); });
function R(host, method, p, { body, token } = {}) {
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
    if (token) headers['x-dd-session'] = token;
    const q = http.request({ host, port: PORT, path: p, method, headers }, (r) => {
      let raw = '';
      r.on('data', (d) => (raw += d));
      r.on('end', () => { let json = null; try { json = JSON.parse(raw); } catch { /* */ } resolve({ status: r.statusCode, json, raw }); });
    });
    q.on('error', () => resolve({ status: 0, json: null, raw: '' }));
    if (payload) q.write(payload);
    q.end();
  });
}
const c = makeChecks();
const { ok } = c;
try {
  await start();
  let r = await R('127.0.0.1', 'GET', '/health');
  ok(/^(pg|postgres)/.test(r.json?.engine ?? ''), `service runs on PostgreSQL from server.json (${r.json?.engine})`);
  if (lanIp) {
    r = await R(lanIp, 'GET', '/health');
    ok(r.status === 200, 'service listens on the LAN');
  }
  r = await R('127.0.0.1', 'GET', '/license/status');
  ok(r.json?.state === 'trial', `licence enforced: trial (${r.json?.state})`);
  ok(fs.existsSync(path.join(tmp, 'lic')), 'licence home from server.json used');
  r = await R('127.0.0.1', 'POST', '/auth/setup', { body: { displayName: 'Asim Javaid', pin: '2468', storeName: 'Asim Super Store' } });
  ok(r.json?.ok, 'first-run setup');
  const owner = r.json.sessionToken;
  r = await R('127.0.0.1', 'GET', '/tills/me');
  ok(r.json?.mode === 'server_only' && r.json.till === null, `installer mode server-only applied right after setup (${r.json?.mode})`);
  r = await R('127.0.0.1', 'GET', '/tills', { token: owner });
  ok(r.json?.used === 0 && r.json.limit === 2, `server-only: Till 1 off, 0 of 2 used (${r.json?.used}/${r.json?.limit})`);
  r = await R('127.0.0.1', 'POST', '/tills/mode', { token: owner, body: { mode: 'main_till' } });
  ok(r.json?.ok, 'owner switches to main PC sells');
  await stop();
  await start();
  r = await R('127.0.0.1', 'GET', '/tills/me');
  ok(r.json?.mode === 'main_till', `owner's switch kept after restart (installer value applied once) (${r.json?.mode})`);
  r = await R('127.0.0.1', 'GET', '/auth/me', { token: owner });
  ok(r.status === 200, 'session survives restart (secret from file)');
  r = await R('127.0.0.1', 'POST', '/backup/auto/run', { token: owner, body: {} });
  const files = fs.existsSync(path.join(tmp, 'backups')) ? fs.readdirSync(path.join(tmp, 'backups')) : [];
  ok(files.some((f) => f.endsWith('.ddpro')), `daily full copy goes to the backup folder from server.json (${files.join(',') || r.status})`);
} catch (e) {
  console.error('FAIL', e.stack || e.message);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) await stop();
  try { psql(`DROP DATABASE IF EXISTS ${dbName}`); } catch { /* */ }
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (!process.exitCode) console.log(`${c.passed} checks passed`);
process.exit(process.exitCode ?? 0);
