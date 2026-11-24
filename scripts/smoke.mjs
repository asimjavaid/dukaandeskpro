#!/usr/bin/env node
/**
 * Slice 0 smoke: migrate SQLite → start Nest briefly → hit /health + empty catalog.
 * Does not launch Electron (needs display). Use pnpm dev:desktop separately.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));

const API_PORT = Number(process.env.API_PORT ?? 3847);
const dbPath =
  process.env.SQLITE_PATH ??
  path.join(root, 'apps/api/data/dukaandesk.sqlite');

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${API_PORT}${urlPath}`, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, body });
          }
        });
      })
      .on('error', reject);
  });
}

async function waitHealth(ms = 45000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await get('/health');
      if (r.status === 200 && r.json?.status === 'ok') return r.json;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('health timeout');
}

console.log('migrate →', dbPath);
const mig = migrate(dbPath);
console.log('migrations:', mig);

const apiCwd = path.join(root, 'apps/api');
const distMain = path.join(apiCwd, 'dist/main.js');
let child;
if (fs.existsSync(distMain)) {
  child = spawn('node', [distMain], {
    cwd: apiCwd,
    env: { ...process.env, API_PORT: String(API_PORT), SQLITE_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} else {
  child = spawn(
    'pnpm',
    ['--filter', '@dukaandeskpro/api', 'start:dev'],
    {
      cwd: root,
      env: { ...process.env, API_PORT: String(API_PORT), SQLITE_PATH: dbPath },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    },
  );
}
child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));

try {
  const health = await waitHealth();
  console.log('health:', health);
  const catalog = await get('/catalog/products');
  console.log('catalog:', catalog.json);
  const tax = await get('/tax');
  console.log('tax:', tax.json);
  console.log('SMOKE OK');
  process.exitCode = 0;
} catch (err) {
  console.error('SMOKE FAIL', err);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
