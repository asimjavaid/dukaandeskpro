'use strict';
/**
 * PostgreSQL entry points for DukaanDesk Pro.
 *
 * Modes:
 *   DATABASE_URL=postgres://user:pass@host:port/db   -> that database (main PC / production).
 *   DD_DB=pg (no DATABASE_URL)                       -> dev/test: each SQLITE_PATH-style file path maps to its own
 *        database "ddp_<hash>" on DD_PG_SERVER (default postgres://postgres@127.0.0.1:5433). A small marker
 *        file is written at the path; deleting the marker makes the next migrate() start from an empty database
 *        (that is how P1's test scripts ask for a fresh DB).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SyncPg } = require('./sync-client');
const { PgDatabase } = require('./database');

const DIR = __dirname;
const PG_MIGRATIONS_DIR = path.join(DIR, '..', '..', 'migrations-pg');
const MARK = 'DukaanDesk Pro PostgreSQL marker';

function isPgMode() {
  return !!process.env.DATABASE_URL || process.env.DD_DB === 'pg';
}
function server() {
  return (process.env.DD_PG_SERVER || 'postgres://postgres@127.0.0.1:5433').replace(/\/+$/, '');
}
function dbNameForPath(p) {
  return 'ddp_' + crypto.createHash('sha1').update(path.resolve(p)).digest('hex').slice(0, 20);
}
function resolvePgUrl(dbPath) {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return `${server()}/${dbNameForPath(dbPath || 'default')}`;
}
function admin(fn) {
  const c = new SyncPg(`${server()}/postgres`);
  try { return fn(c); } finally { c.close(); }
}
/** Path-mapped mode only: create (or recreate, when the marker file is gone) the database for a path. */
function ensureMappedDatabase(dbPath, { fresh } = {}) {
  if (process.env.DATABASE_URL || !dbPath) return;
  const name = dbNameForPath(dbPath);
  const marker = fs.existsSync(dbPath) && fs.readFileSync(dbPath, 'utf8').startsWith(MARK);
  admin((c) => {
    const exists = c.query(`SELECT 1 FROM pg_database WHERE datname = '${name}'`).rows.length > 0;
    if (exists && (fresh || !marker)) {
      c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`);
      c.query(`DROP DATABASE IF EXISTS ${name}`);
    }
    if (!exists || fresh || !marker) c.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8'`);
  });
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  if (!marker) fs.writeFileSync(dbPath, `${MARK}\n${server()}/${name}\n`);
}

function listPgMigrations() {
  if (!fs.existsSync(PG_MIGRATIONS_DIR)) return [];
  return fs.readdirSync(PG_MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

function migratePg(dbPath) {
  ensureMappedDatabase(dbPath);
  const url = resolvePgUrl(dbPath);
  const c = new SyncPg(url);
  const ran = [];
  const skipped = [];
  try {
    const has = c.query(`SELECT to_regclass('schema_migrations') IS NOT NULL AS ok`).rows[0].ok;
    if (!has) {
      const base = JSON.parse(fs.readFileSync(path.join(DIR, 'baseline-migrations.json'), 'utf8'));
      c.query('BEGIN');
      try {
        c.query(fs.readFileSync(path.join(DIR, 'compat.sql'), 'utf8'));
        c.query(`CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT sqlite_datetime('now'))`);
        c.query(fs.readFileSync(path.join(DIR, 'baseline.sql'), 'utf8'));
        c.query(`INSERT INTO schema_migrations (id) VALUES ${base.map((b) => `('${b}')`).join(', ')}`);
        c.query('COMMIT');
      } catch (e) { c.query('ROLLBACK'); throw e; }
      ran.push(...base);
    } else {
      // compat functions are CREATE OR REPLACE: refresh them on every start (cheap, keeps fixes flowing)
      c.query(fs.readFileSync(path.join(DIR, 'compat.sql'), 'utf8'));
    }
    const applied = new Set(c.query('SELECT id FROM schema_migrations').rows.map((r) => r.id));
    if (has) for (const id of applied) skipped.push(id);
    for (const f of listPgMigrations()) {
      if (applied.has(f)) continue;
      c.query('BEGIN');
      try {
        c.query(fs.readFileSync(path.join(PG_MIGRATIONS_DIR, f), 'utf8'));
        c.query(`INSERT INTO schema_migrations (id) VALUES ('${f.replace(/'/g, "''")}')`);
        c.query('COMMIT');
      } catch (e) { c.query('ROLLBACK'); throw new Error(`Migration ${f} failed: ${e.message}`); }
      ran.push(f);
    }
  } finally {
    c.close();
  }
  return { dbPath: url.replace(/:[^:@/]*@/, ':***@'), applied: ran, skipped, engine: 'postgres' };
}

/** better-sqlite3-compatible handle. `target` is a file path (mapped mode) or ignored when DATABASE_URL is set. */
function openDatabase(target, opts = {}) {
  if (!process.env.DATABASE_URL && target && /^postgres(ql)?:\/\//.test(target)) return new PgDatabase(target, opts);
  if (!process.env.DATABASE_URL) {
    const marker = target && fs.existsSync(target) && fs.readFileSync(target, 'utf8').startsWith(MARK);
    if (!marker) { if (opts.fileMustExist || opts.readonly) throw Object.assign(new Error(`unable to open database file: ${target}`), { code: 'SQLITE_CANTOPEN' }); migratePg(target); }
  }
  return new PgDatabase(resolvePgUrl(target), opts);
}

module.exports = { isPgMode, resolvePgUrl, migratePg, openDatabase, ensureMappedDatabase, dbNameForPath, PgDatabase, PG_MIGRATIONS_DIR };
