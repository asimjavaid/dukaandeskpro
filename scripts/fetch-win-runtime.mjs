#!/usr/bin/env node
/**
 * Lite Windows runtime for the installer (run on the build PC before `pnpm package:win`):
 *   apps/desktop/staged/pgsql  <- PostgreSQL 17 Windows x64 binaries zip (EDB), only bin/ lib/ share/
 *   apps/desktop/staged/winsw  <- WinSW-x64.exe renamed DukaanDeskProServer.exe + build/win/DukaanDeskProServer.xml
 * Downloads are checked against the SHA-256 below. First time: run with DD_PIN_HASHES=1 to print
 * the hashes, compare them with the publisher's, paste them here, commit.
 * UNTESTED ON WINDOWS (needs `tar` that reads zip: Windows 10+ tar.exe does).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staged = path.join(root, 'apps/desktop/staged');
const cache = path.join(root, '.cache/win-runtime');
const ITEMS = {
  pg: {
    url: process.env.DD_PG_ZIP_URL ?? 'https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip',
    sha256: '', // TODO pin
  },
  winsw: {
    url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe',
    sha256: '', // TODO pin
  },
};

async function get(name, { url, sha256 }) {
  fs.mkdirSync(cache, { recursive: true });
  const file = path.join(cache, path.basename(new URL(url).pathname));
  if (!fs.existsSync(file)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${name}: ${r.status} ${url}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  const got = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (process.env.DD_PIN_HASHES === '1') console.log(`${name} sha256 ${got}`);
  else if (!sha256) throw new Error(`${name}: no pinned SHA-256 yet (run once with DD_PIN_HASHES=1)`);
  else if (got !== sha256) throw new Error(`${name}: SHA-256 mismatch ${got}`);
  return file;
}

const pgZip = await get('pg', ITEMS.pg);
const winsw = await get('winsw', ITEMS.winsw);

const pgOut = path.join(staged, 'pgsql');
fs.rmSync(pgOut, { recursive: true, force: true });
const tmp = path.join(cache, 'pg-unzip');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
execFileSync('tar', ['-xf', pgZip, '-C', tmp], { stdio: 'inherit' });
const src = path.join(tmp, 'pgsql');
fs.mkdirSync(pgOut, { recursive: true });
for (const d of ['bin', 'lib', 'share']) fs.cpSync(path.join(src, d), path.join(pgOut, d), { recursive: true });
// Not needed at the shop: pgAdmin, docs, symbols, headers.
for (const d of ['pgAdmin 4', 'doc', 'symbols', 'include', 'StackBuilder']) fs.rmSync(path.join(pgOut, d), { recursive: true, force: true });

const swOut = path.join(staged, 'winsw');
fs.rmSync(swOut, { recursive: true, force: true });
fs.mkdirSync(swOut, { recursive: true });
fs.copyFileSync(winsw, path.join(swOut, 'DukaanDeskProServer.exe'));
fs.copyFileSync(path.join(root, 'apps/desktop/build/win/DukaanDeskProServer.xml'), path.join(swOut, 'DukaanDeskProServer.xml'));
console.log('staged', pgOut, swOut);
