#!/usr/bin/env node
/**
 * Slice 1 smoke: migrate → signup owner → login → create product → list
 *
 * Run:  node scripts/test-slice1-auth-catalog.mjs
 * Or:   pnpm test:slice1
 *
 * Uses a fresh temp SQLite file so it does not touch the default DB.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { scryptSync, timingSafeEqual } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));

const API_PORT = Number(process.env.API_PORT ?? 3851);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice1-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function verifyScryptStored(pin, stored) {
  const [algo, salt, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !salt || !hashHex) return false;
  const derived = scryptSync(pin, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}

function request(method, urlPath, { body, token, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      headers['x-dd-session'] = token;
    }
    if (cookie) headers.Cookie = cookie;

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: API_PORT,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          const setCookie = res.headers['set-cookie'];
          resolve({
            status: res.statusCode,
            json,
            raw,
            setCookie: Array.isArray(setCookie)
              ? setCookie
              : setCookie
                ? [setCookie]
                : [],
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitHealth(ms = 60000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await request('GET', '/health');
      if (r.status === 200 && r.json?.status === 'ok') return r.json;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('health timeout');
}

function cookieHeader(setCookie) {
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

console.log('=== DukaanDesk Slice 1 smoke ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
console.log('migrations:', mig);
assert(
  mig.applied.includes('001_init.sql') || mig.skipped.includes('001_init.sql'),
  '001 present',
);
assert(
  mig.applied.includes('002_slice1_auth.sql') ||
    mig.skipped.includes('002_slice1_auth.sql'),
  '002 present',
);

const apiCwd = path.join(root, 'apps/api');
const distMain = path.join(apiCwd, 'dist/main.js');

console.log('building API…');
const build = spawn('pnpm', ['--filter', '@dukaandeskpro/api', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
await new Promise((resolve, reject) => {
  build.on('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`build exit ${code}`)),
  );
});

const child = spawn('node', [distMain], {
  cwd: apiCwd,
  env: {
    ...process.env,
    API_PORT: String(API_PORT),
    SQLITE_PATH: dbPath,
    SESSION_SECRET: 'slice1-smoke-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '2468';
const DISPLAY = 'Slice1 Owner';
const STORE = 'Slice1 Kiryana';
const PRODUCT = 'Slice1 Soap';

try {
  await waitHealth();
  console.log('health ok');

  const status0 = await request('GET', '/auth/status');
  assert(status0.status === 200, 'status http');
  assert(status0.json?.needsSetup === true, 'needsSetup true on fresh DB');
  console.log('status: needsSetup');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: PIN, storeName: STORE },
  });
  assert(setup.status === 200 || setup.status === 201, `setup http ${setup.status}`);
  // Nest default 201 for POST? Actually default is 201 for @Post in some versions, but Nest returns 201 by default for POST. Our controller doesn't set code so it's 201.
  assert(setup.json?.ok === true, `setup ok: ${JSON.stringify(setup.json)}`);
  assert(setup.json?.session?.role === 'owner', 'setup role owner');
  assert(setup.json?.sessionToken, 'sessionToken present');
  assert(
    setup.setCookie.some((c) => c.startsWith('dd_session=')),
    'httpOnly dd_session Set-Cookie',
  );
  const token = setup.json.sessionToken;
  const cookie = cookieHeader(setup.setCookie);
  console.log('setup ok; cookie + sessionToken');

  // Verify scrypt pin_hash in SQLite
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const userRow = db
    .prepare(
      `SELECT pin_hash, display_name FROM users WHERE id = ?`,
    )
    .get(setup.json.session.userId);
  db.close();
  assert(userRow?.pin_hash?.startsWith('scrypt$'), 'pin_hash scrypt$…');
  assert(verifyScryptStored(PIN, userRow.pin_hash), 'scrypt verifies PIN');
  assert(!userRow.pin_hash.includes(PIN), 'PIN not stored plaintext');
  console.log('pin_hash scrypt verified');

  const status1 = await request('GET', '/auth/status');
  assert(status1.json?.needsSetup === false, 'needsSetup false after setup');

  const setupAgain = await request('POST', '/auth/setup', {
    body: { displayName: 'Other', pin: '1111', storeName: 'X' },
  });
  assert(setupAgain.json?.ok === false, 'second setup rejected');
  console.log('second setup rejected');

  // Logout cookie then login again
  await request('POST', '/auth/logout', { cookie });
  const login = await request('POST', '/auth/login', {
    body: { userId: setup.json.session.userId, pin: PIN },
  });
  assert(login.json?.ok === true, 'login ok');
  assert(login.json?.sessionToken, 'login sessionToken');
  const token2 = login.json.sessionToken;
  console.log('login ok');

  const badLogin = await request('POST', '/auth/login', {
    body: { userId: setup.json.session.userId, pin: '0000' },
  });
  assert(badLogin.json?.ok === false, 'bad PIN rejected');

  const me = await request('GET', '/auth/me', { token: token2 });
  assert(me.status === 200, 'me http');
  assert(me.json?.session?.displayName === DISPLAY, 'me displayName');

  const empty = await request('GET', '/catalog/products', { token: token2 });
  assert(empty.status === 200, 'catalog list http');
  assert(empty.json?.count === 0, 'catalog empty');
  console.log('catalog empty');

  const created = await request('POST', '/catalog/products', {
    token: token2,
    body: { name: PRODUCT, priceRs: 50, unit: 'piece' },
  });
  assert(created.json?.ok === true, `create product: ${JSON.stringify(created.json)}`);
  assert(created.json?.product?.name === PRODUCT, 'product name');
  assert(created.json?.product?.unit_label === 'piece', 'unit piece');
  assert(created.json?.product?.price_paisa === 5000, 'price 50 Rs → 5000 paisa');
  console.log('product created');

  const carton = await request('POST', '/catalog/products', {
    token: token2,
    body: { name: 'Slice1 Carton Oil', priceRs: 1200, unit: 'carton' },
  });
  assert(carton.json?.ok === true, 'carton product');
  // Current behaviour (13 Oct 2026): no carton sell mode; `unit: 'carton'` is ignored, product sells per piece.
  assert(carton.json?.product?.unit_label === 'piece', 'carton unit ignored -> piece');

  const listed = await request('GET', '/catalog/products', { token: token2 });
  assert(listed.json?.count === 2, 'catalog count 2');
  assert(
    listed.json.items.some((p) => p.name === PRODUCT),
    'list contains soap',
  );
  console.log('catalog list ok:', listed.json.count);

  const unauth = await request('GET', '/catalog/products');
  assert(unauth.status === 401, 'catalog requires session');

  console.log('SLICE1 SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SLICE1 SMOKE FAIL', err);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  setTimeout(() => {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      for (const suffix of ['-wal', '-shm']) {
        const p = dbPath + suffix;
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch {
      /* ignore */
    }
    process.exit(process.exitCode ?? 0);
  }, 800);
}
