#!/usr/bin/env node
/**
 * Slice 15 smoke: setup locale ur|en; sample creates 1 product+stock; skip creates 0.
 *
 * Run:  node scripts/test-slice15-empty-firstrun.mjs
 * Or:   pnpm test:slice15
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

const API_PORT = Number(process.env.API_PORT ?? 3865);

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

function freshDb(label) {
  const dbPath = path.join(
    os.tmpdir(),
    `dukaandesk-slice15-${label}-${Date.now()}.sqlite`,
  );
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  for (const suffix of ['-wal', '-shm']) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  migrate(dbPath);
  return dbPath;
}

function startApi(dbPath) {
  const apiCwd = path.join(root, 'apps/api');
  const distMain = path.join(apiCwd, 'dist/main.js');
  const child = spawn('node', [distMain], {
    cwd: apiCwd,
    env: {
      ...process.env,
      API_PORT: String(API_PORT),
      SQLITE_PATH: dbPath,
      SESSION_SECRET: 'slice15-smoke-secret',
      TAX_MODE: 'simulate',
      TAX_PROCESS_INTERVAL_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));
  return child;
}

async function stopApi(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  try {
    child.kill('SIGKILL');
  } catch {
    /* ignore */
  }
}

console.log('=== DukaanDesk Slice 15 smoke (empty states + first-run) ===');

// Grep: EmptyState component + offline chip present; no sync copy on first-run
const webSrc = path.join(root, 'apps/web/src');
assert(
  fs.existsSync(path.join(webSrc, 'features/shared/EmptyState.tsx')),
  'EmptyState.tsx missing',
);
const setupSrc = fs.readFileSync(
  path.join(webSrc, 'features/setup/FirstRunSetup.tsx'),
  'utf8',
);
assert(setupSrc.includes('locale_default'), 'setup must send locale_default');
assert(setupSrc.includes('sample'), 'setup must offer sample step');
assert(
  !/sync\s+(now|cloud|online)/i.test(setupSrc),
  'setup must not mention sync',
);
const appSrc = fs.readFileSync(path.join(webSrc, 'app/App.tsx'), 'utf8');
// The always-on "offline" chip was removed (clean UI, no explanatory copy); just guard against cloud/sync copy.
assert(!/sync\s+(now|cloud|online)/i.test(appSrc), 'App must not mention cloud sync');
assert(!appSrc.includes('Enqueue stub'), 'no Enqueue stub');
console.log('grep smoke OK — EmptyState + locale/sample + no sync copy');

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

const PIN = '1357';
let child;

try {
  // --- Locale ur ---
  {
    const dbPath = freshDb('ur');
    console.log('migrate ur →', dbPath);
    child = startApi(dbPath);
    await waitHealth();
    console.log('health ok (ur)');

    const setup = await request('POST', '/auth/setup', {
      body: {
        displayName: 'Slice15 Ur Owner',
        pin: PIN,
        storeName: 'Slice15 Urdu Store',
        locale_default: 'ur',
      },
    });
    assert(setup.json?.ok === true, `setup ur: ${JSON.stringify(setup.json)}`);
    assert(
      setup.json.store?.locale_default === 'ur',
      `store locale ur got ${setup.json.store?.locale_default}`,
    );
    const status = await request('GET', '/auth/status');
    assert(
      status.json?.store?.locale_default === 'ur',
      `status locale ur got ${status.json?.store?.locale_default}`,
    );
    console.log('setup locale=ur OK');

    // skip → 0 products
    const list0 = await request('GET', '/catalog/products', {
      token: setup.json.sessionToken,
    });
    assert(list0.status === 200, `list0 status ${list0.status}`);
    assert(
      list0.json?.count === 0 && (list0.json?.items?.length ?? -1) === 0,
      `skip must leave 0 products, got ${list0.json?.count}`,
    );
    console.log('skip path: catalog count=0');

    await stopApi(child);
    child = null;
  }

  // --- Locale en + sample ---
  {
    const dbPath = freshDb('en-sample');
    console.log('migrate en+sample →', dbPath);
    child = startApi(dbPath);
    await waitHealth();
    console.log('health ok (en)');

    const setup = await request('POST', '/auth/setup', {
      body: {
        displayName: 'Slice15 En Owner',
        pin: PIN,
        storeName: 'Slice15 En Store',
        locale: 'en',
      },
    });
    assert(setup.json?.ok === true, `setup en: ${JSON.stringify(setup.json)}`);
    assert(
      setup.json.store?.locale_default === 'en',
      `store locale en got ${setup.json.store?.locale_default}`,
    );
    console.log('setup locale=en OK');

    const token = setup.json.sessionToken;
    const before = await request('GET', '/catalog/products', { token });
    assert(before.json?.count === 0, 'before sample count=0');

    const sample = await request('POST', '/catalog/sample', { token });
    assert(
      sample.json?.ok === true,
      `sample: ${JSON.stringify(sample.json)}`,
    );
    assert(sample.json.created === true, 'sample created=true');
    assert(sample.json.product?.id, 'sample product id');
    assert(
      sample.json.product.unit_label === 'piece',
      `unit=${sample.json.product.unit_label}`,
    );
    assert(
      Number(sample.json.product.price_paisa) > 0,
      'sample price > 0',
    );
    assert(
      Number(sample.json.product.qty_on_hand) > 0,
      `sample stock>0 got ${sample.json.product.qty_on_hand}`,
    );

    const after = await request('GET', '/catalog/products', { token });
    assert(after.json?.count === 1, `after sample count=${after.json?.count}`);
    assert(
      after.json.items[0].qty_on_hand > 0,
      'listed stock > 0',
    );
    console.log(
      `sample path: 1 product stock=${after.json.items[0].qty_on_hand}`,
    );

    // idempotent second call
    const sample2 = await request('POST', '/catalog/sample', { token });
    assert(sample2.json?.ok === true, 'sample2 ok');
    assert(sample2.json.created === false, 'sample2 created=false');
    const after2 = await request('GET', '/catalog/products', { token });
    assert(after2.json?.count === 1, 'still 1 product after idempotent sample');
    console.log('sample idempotent OK');

    // invalid locale rejected on fresh would need new DB — quick check via settings already covered;
    // setup already done so second setup fails:
    const badLocaleDb = freshDb('bad-locale');
    await stopApi(child);
    child = startApi(badLocaleDb);
    await waitHealth();
    const bad = await request('POST', '/auth/setup', {
      body: {
        displayName: 'Bad Locale',
        pin: PIN,
        locale_default: 'fr',
      },
    });
    assert(
      bad.json?.ok === false && bad.json?.error === 'invalid_locale',
      `invalid locale: ${JSON.stringify(bad.json)}`,
    );
    console.log('invalid locale rejected');

    await stopApi(child);
    child = null;
  }

  // UI dictionary keys present
  const dict = fs.readFileSync(
    path.join(webSrc, 'i18n/dictionary.ts'),
    'utf8',
  );
  for (const key of [
    'emptyStateCatalogTitle',
    'emptyStatePartiesTitle',
    'emptyStateCashierTodayTitle',
    'emptyStateTaxTitle',
    'emptyStateAnalyticsTitle',
    'sampleAdd',
    'sampleSkip',
    'setupLanguage',
  ]) {
    assert(dict.includes(`${key}:`), `dictionary missing ${key}`);
  }
  console.log('dictionary EN+UR keys present');

  console.log('=== Slice 15 smoke PASSED ===');
} catch (e) {
  console.error('FAILED:', e.message ?? e);
  process.exitCode = 1;
} finally {
  await stopApi(child);
}
