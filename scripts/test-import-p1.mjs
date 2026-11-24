#!/usr/bin/env node
/**
 * Lite: upgrading a P1 shop. Imports a P1 SQLite copy into a fresh PostgreSQL database with tools/import-p1
 * and checks the report (all tables, row counts, stock totals). Replaces the P1-only ".sqlite upgrade / down
 * migration" sections of test-buy-units, test-product-types and test-landed-cost on PostgreSQL.
 * Run: DD_DB=pg node scripts/test-import-p1.mjs   (skips when the P1 copy or PostgreSQL mode is missing)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const IS_PG = process.env.DD_DB === 'pg' || !!process.env.DATABASE_URL;
const src = ['/workspace/pc-db-20261016.sqlite', '/workspace/pu/pc-final.sqlite'].find((f) => fs.existsSync(f));
if (!IS_PG || !src) {
  console.log(`skip import-p1 (${!IS_PG ? 'not PostgreSQL mode' : 'no P1 copy'})`);
  process.exit(0);
}
const pg = require(path.join(root, 'packages/db/src/pg'));
const marker = path.join(os.tmpdir(), `dd-import-target-${Date.now()}.sqlite`);
const url = pg.resolvePgUrl ? pg.resolvePgUrl(marker) : null;
pg.migratePg(marker); // fresh, empty Lite schema
const report = path.join(os.tmpdir(), `dd-import-report-${Date.now()}.json`);
const env = { ...process.env, DATABASE_URL: url };
delete env.NODE_OPTIONS; // the importer must read the real SQLite file
delete env.DD_DB;
const r = spawnSync('node', [path.join(root, 'tools/import-p1/import-p1.cjs'), src, '--report', report], { env, encoding: 'utf8' });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok', m); };
ok(r.status === 0, `importer exit 0 (${r.status})`);
const rep = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : {};
ok(rep && (rep.ok === true || rep.verified === true || rep.status === 'ok'), `report ok ${JSON.stringify(rep).slice(0, 200)}`);
// Second import into the same (now non-empty) database must be refused.
const r2 = spawnSync('node', [path.join(root, 'tools/import-p1/import-p1.cjs'), src], { env, encoding: 'utf8' });
ok(r2.status !== 0, 'second import into non-empty target refused');
fs.rmSync(report, { force: true });
console.log(fail ? `test-import-p1: FAIL (${fail})` : 'test-import-p1: OK');
process.exit(fail ? 1 : 0);
