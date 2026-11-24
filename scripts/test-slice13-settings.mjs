#!/usr/bin/env node
/**
 * Slice 13 smoke: Owner patches store; PIN change; cashier 403 on mutate;
 * about version (no tax mode — FBR out, Tax V1).
 *
 * Run:  node scripts/test-slice13-settings.mjs
 * Or:   pnpm test:slice13
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));

const API_PORT = Number(process.env.API_PORT ?? 3863);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(os.tmpdir(), `dukaandesk-slice13-${Date.now()}.sqlite`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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
          resolve({
            status: res.statusCode,
            json,
            raw,
            headers: res.headers,
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

console.log('=== DukaanDesk Slice 13 smoke (Settings shell) ===');
console.log('migrate →', dbPath);
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
for (const suffix of ['-wal', '-shm']) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
const mig = migrate(dbPath);
console.log('migrations:', mig);
assert(
  mig.applied.includes('011_slice13_settings.sql') ||
    mig.skipped.includes('011_slice13_settings.sql'),
  '011_slice13_settings present',
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
    SESSION_SECRET: 'slice13-smoke-secret',
    TAX_MODE: 'simulate',
    TAX_PROCESS_INTERVAL_MS: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

const PIN = '2468';
const NEW_PIN = '8642';
const CASHIER_PIN = '1357';
const DISPLAY = 'Slice13 Owner';

try {
  await waitHealth();
  console.log('health ok');

  const setup = await request('POST', '/auth/setup', {
    body: { displayName: DISPLAY, pin: PIN, storeName: 'Slice13 Kiryana' },
  });
  assert(setup.json?.ok === true, `setup: ${JSON.stringify(setup.json)}`);
  const token = setup.json.sessionToken;
  assert(token, 'sessionToken');
  console.log('setup ok');

  // GET store profile
  const getStore = await request('GET', '/settings/store', { token });
  assert(getStore.status === 200, `get store status ${getStore.status}`);
  assert(getStore.json?.ok === true, 'get store ok');
  assert(getStore.json.store.name === 'Slice13 Kiryana', 'store name');
  assert(getStore.json.store.locale_default === 'en', 'locale default en');
  console.log('GET /settings/store ok');

  // Owner PATCH store
  const patch = await request('PATCH', '/settings/store', {
    token,
    body: {
      name: 'Slice13 Updated',
      phone: '03001112233',
      address: 'Lahore Cantt',
      receipt_footer: 'Shukriya — thank you',
      locale_default: 'ur',
    },
  });
  assert(patch.status === 200, `patch status ${patch.status} ${patch.raw}`);
  assert(patch.json?.ok === true, `patch ok: ${JSON.stringify(patch.json)}`);
  assert(patch.json.store.name === 'Slice13 Updated', 'patched name');
  assert(patch.json.store.phone === '03001112233', 'patched phone');
  assert(patch.json.store.address === 'Lahore Cantt', 'patched address');
  assert(
    patch.json.store.receipt_footer === 'Shukriya — thank you',
    'patched footer',
  );
  assert(patch.json.store.locale_default === 'ur', 'patched locale');
  console.log('Owner PATCH /settings/store ok');

  // auth/status includes receipt_footer for POS
  const status = await request('GET', '/auth/status');
  assert(
    status.json?.store?.receipt_footer === 'Shukriya — thank you',
    'auth status receipt_footer',
  );
  console.log('auth/status receipt_footer ok');

  // About — version + redacted sqlite
  const about = await request('GET', '/settings/about', { token });
  assert(about.status === 200, `about status ${about.status}`);
  assert(about.json?.ok === true, 'about ok');
  assert(about.json.about.product === 'DukaanDesk Pro', 'about product');
  assert(
    typeof about.json.about.version === 'string' &&
      about.json.about.version.length > 0,
    'about version',
  );
  // Tax V1 (D30 LOCK): FBR out — no TAX_MODE in About.
  assert(!('tax_mode' in about.json.about), 'about has no tax_mode (FBR out)');
  assert(
    String(about.json.about.tagline).includes('local SQLite'),
    'about tagline',
  );
  const redacted = about.json.about.sqlite_path_redacted;
  assert(typeof redacted === 'string' && redacted.includes('…/'), 'redacted path');
  assert(!redacted.includes(os.tmpdir()) || redacted.startsWith('…/'), 'no full tmp path');
  assert(!redacted.includes(dbPath), 'sqlite path redacted (not full path)');
  console.log('GET /settings/about ok — version', about.json.about.version);

  // PIN change — bad current → 401
  const badPin = await request('POST', '/settings/pin', {
    token,
    body: { current_pin: '0000', new_pin: NEW_PIN },
  });
  assert(badPin.status === 401, `bad pin status ${badPin.status}`);
  console.log('bad current PIN → 401 ok');

  // PIN change — success
  const pinOk = await request('POST', '/settings/pin', {
    token,
    body: { current_pin: PIN, new_pin: NEW_PIN },
  });
  assert(pinOk.status === 200 || pinOk.status === 201, `pin change status ${pinOk.status} ${pinOk.raw}`);
  assert(pinOk.json?.ok === true, 'pin change ok');

  // Login with new PIN
  const ownerId = setup.json.session?.userId;
  const loginNew = await request('POST', '/auth/login', {
    body: { userId: ownerId, pin: NEW_PIN },
  });
  assert(loginNew.json?.ok === true, `login new pin: ${JSON.stringify(loginNew.json)}`);
  const token2 = loginNew.json.sessionToken;
  assert(token2, 'token after pin change');

  // Old PIN fails
  const loginOld = await request('POST', '/auth/login', {
    body: { userId: ownerId, pin: PIN },
  });
  assert(loginOld.json?.ok !== true, 'old pin must fail');
  console.log('PIN change ok');

  // Create cashier → 403 on settings mutate
  const cashier = await request('POST', '/owner/staff/cashiers', {
    token: token2,
    body: { displayName: 'Slice13 Cashier', pin: CASHIER_PIN },
  });
  assert(cashier.json?.ok === true, `cashier create: ${JSON.stringify(cashier.json)}`);
  const cashierId = cashier.json.user.id;

  const cashLogin = await request('POST', '/auth/login', {
    body: { userId: cashierId, pin: CASHIER_PIN },
  });
  assert(cashLogin.json?.ok === true, 'cashier login');
  const cashToken = cashLogin.json.sessionToken;

  const cashPatch = await request('PATCH', '/settings/store', {
    token: cashToken,
    body: { name: 'Hacked' },
  });
  assert(cashPatch.status === 403, `cashier patch ${cashPatch.status}`);

  const cashPin = await request('POST', '/settings/pin', {
    token: cashToken,
    body: { current_pin: CASHIER_PIN, new_pin: '9999' },
  });
  assert(cashPin.status === 403, `cashier pin ${cashPin.status}`);

  const cashAbout = await request('GET', '/settings/about', {
    token: cashToken,
  });
  assert(cashAbout.status === 403, `cashier about ${cashAbout.status}`);
  console.log('cashier 403 on settings mutate/read (owner-gated) ok');

  // invalid locale
  const badLocale = await request('PATCH', '/settings/store', {
    token: token2,
    body: { locale_default: 'fr' },
  });
  assert(badLocale.status === 400, `bad locale ${badLocale.status}`);

  console.log('=== Slice 13 smoke PASSED ===');
} catch (e) {
  console.error('FAILED', e);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath + suffix;
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}
