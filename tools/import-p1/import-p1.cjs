#!/usr/bin/env node
'use strict';
/**
 * Import a DukaanDesk P1 SQLite database into an EMPTY DukaanDesk Pro PostgreSQL database.
 *
 *   DATABASE_URL=postgres://... node tools/import-p1/import-p1.cjs C:\path\dukaandesk.sqlite [--report out.json]
 *
 * - The P1 file is never changed: it is copied to a temp file, the copy is brought up to P1 migration 045, then read.
 * - Target must be empty (no store row). Everything is copied in one transaction; any error leaves the target empty.
 * - Verifies row counts per table and total stock on hand afterwards.
 */
process.env.DD_REAL_SQLITE = '1';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const Database = require(require.resolve('better-sqlite3', { paths: [path.join(root, 'packages/db')] }));
const sqliteMigrate = require(path.join(root, 'packages/db/src/migrate.js'));
const pgmod = require(path.join(root, 'packages/db/src/pg'));
const { lit } = require(path.join(root, 'packages/db/src/pg/translate.js'));

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
if (!src || !fs.existsSync(src)) { console.error('Usage: import-p1.cjs <P1 dukaandesk.sqlite> [--report out.json]'); process.exit(1); }
if (!process.env.DATABASE_URL && process.env.DD_DB !== 'pg') { console.error('Set DATABASE_URL to the Lite database'); process.exit(1); }

// 1. private copy of the P1 file, upgraded to 045 with P1's own SQLite migrations
const tmp = path.join(os.tmpdir(), `ddpro-import-${Date.now()}.sqlite`);
const s0 = new Database(src, { readonly: true, fileMustExist: true });
s0.backup ? null : null;
s0.close();
fs.copyFileSync(src, tmp);
for (const sfx of ['-wal', '-shm']) if (fs.existsSync(src + sfx)) fs.copyFileSync(src + sfx, tmp + sfx);
{ const d = new Database(tmp); d.pragma('wal_checkpoint(TRUNCATE)'); d.close(); }
const saved = process.env.DD_DB; const savedUrl = process.env.DATABASE_URL;
delete process.env.DD_DB; delete process.env.DATABASE_URL;
const up = sqliteMigrate.migrate(tmp);
process.env.DD_DB = saved || ''; if (savedUrl) process.env.DATABASE_URL = savedUrl; if (!saved) delete process.env.DD_DB;
const base = JSON.parse(fs.readFileSync(path.join(root, 'packages/db/src/pg/baseline-migrations.json'), 'utf8'));
const sdb = new Database(tmp, { readonly: true });
const have = sdb.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id);
const extra = have.filter((h) => !base.includes(h));
if (extra.length) { console.error('P1 file has migrations Lite does not know: ' + extra.join(', ')); process.exit(2); }
const integ = sdb.pragma('integrity_check', { simple: true });
if (integ !== 'ok') { console.error('P1 file failed integrity_check: ' + integ); process.exit(2); }

// 2. target
const targetPath = process.env.DATABASE_URL ? undefined : path.join(os.tmpdir(), 'ddpro-import-target.marker');
pgmod.migratePg(targetPath);
const pdb = pgmod.openDatabase(targetPath);
if (pdb.prepare('SELECT COUNT(*) AS n FROM store').get().n > 0) { console.error('Target Lite database is not empty (store exists). Nothing imported.'); process.exit(3); }

const order = [...fs.readFileSync(path.join(root, 'packages/db/src/pg/baseline.sql'), 'utf8').matchAll(/^CREATE TABLE "?(\w+)"?/gm)].map((m) => m[1]);
const pgCols = (t) => pdb.prepare(`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name <> 'rowid'`).all(t).map((r) => r.c);
const report = { source: src, upgraded_from: have.length - up.applied.length, migrations_applied_to_copy: up.applied, tables: {} };
const t0 = Date.now();
pdb.transaction(() => {
  pdb.pragma('defer_foreign_keys = ON');
  // tables seeded by the Lite baseline are replaced by the P1 rows
  for (const t of [...order].reverse()) pdb.prepare(`DELETE FROM "${t}"`).run();
  for (const t of order) {
    const exists = sdb.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(t);
    if (!exists) { report.tables[t] = { source: 0, copied: 0, note: 'not in P1 file' }; continue; }
    const target = new Set(pgCols(t));
    const cols = sdb.prepare(`SELECT name FROM pragma_table_info(?)`).all(t).map((r) => r.name).filter((c) => target.has(c));
    const rows = sdb.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${t}" ORDER BY rowid`).raw().all();
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      // raw SQL (already PostgreSQL): bypass the dialect translator
      pdb._query(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${chunk.map((r) => '(' + r.map(lit).join(', ') + ')').join(',\n')}`);
    }
    report.tables[t] = { source: rows.length, copied: rows.length };
  }
  pdb.pragma('defer_foreign_keys = ON');
})();
// 3. verify
let ok = true;
for (const t of order) {
  if (!report.tables[t] || report.tables[t].note) continue;
  const n = pdb.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
  report.tables[t].in_pro = n;
  if (n !== report.tables[t].source) { ok = false; report.tables[t].mismatch = true; }
}
const sStock = sdb.prepare('SELECT COALESCE(SUM(qty_on_hand),0) AS q FROM stock_balances').get().q;
const pStock = pdb.prepare('SELECT COALESCE(SUM(qty_on_hand),0) AS q FROM stock_balances').get().q;
report.stock_on_hand = { p1: sStock, pro: pStock };
if (Number(sStock) !== Number(pStock)) ok = false;
report.ok = ok;
report.seconds = Math.round((Date.now() - t0) / 100) / 10;
sdb.close(); pdb.close();
for (const f of [tmp, tmp + '-wal', tmp + '-shm']) fs.rmSync(f, { force: true });
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
const total = Object.values(report.tables).reduce((a, r) => a + (r.copied || 0), 0);
console.log(`${ok ? 'IMPORT OK' : 'IMPORT MISMATCH'}: ${total} rows, ${Object.keys(report.tables).length} tables, stock ${pStock}, ${report.seconds}s`);
process.exit(ok ? 0 : 4);
