'use strict';
/**
 * Drop-in for the subset of the better-sqlite3 API that DukaanDesk uses, backed by PostgreSQL.
 *   const db = new PgDatabase(url)  |  db.prepare(sql).get/all/run(...)  |  db.transaction(fn)  |  db.exec(sql)
 * All access is synchronous and goes through ONE connection, so requests are serialised exactly like
 * P1's single SQLite handle (stock-safe for concurrent tills; see docs/PLAN.md for the async phase).
 */
const { SyncPg } = require('./sync-client');
const { translate } = require('./translate');

const MENTIONS_ROWID = /\browid\b/i;

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.source = sql;
    this.reader = /^\s*(SELECT|WITH|PRAGMA|VALUES)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
    this._pluck = false;
    this._raw = false;
  }
  _exec(args) {
    if (/^\s*PRAGMA\b/i.test(this.source)) return { rows: this.db.pragma(this.source.replace(/^\s*PRAGMA\s+/i, '')), rowCount: 0, fields: [] };
    let aliases = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const sql = translate(this.source, args, aliases ? { aliases } : {});
      try {
        return this.db._query(sql);
      } catch (e) {
        // SQLite allows result aliases inside WHERE/HAVING/ORDER BY expressions; retry with the alias inlined.
        const m = (e.pgCode === '42703' && /column "([^"]+)" does not exist/.exec(e.message))
          || (e.pgCode === '42803' && /column "(?:[^".]+\.)?([^".]+)" must appear in the GROUP BY/.exec(e.message));
        const nm = m && m[1].toLowerCase();
        if (!m || (aliases && aliases.has(nm)) || !new RegExp(`\\bAS\\s+"?${nm}"?\\b`, 'i').test(this.source)) throw e;
        aliases = new Set([...(aliases || []), nm]);
      }
    }
    throw new Error('alias retry limit');
  }
  _rows(res) {
    let rows = res.rows;
    if (!MENTIONS_ROWID.test(this.source) && rows.length && 'rowid' in rows[0]) rows = rows.map(({ rowid, ...r }) => r);
    if (this._pluck) return rows.map((r) => r[res.fields[0] || Object.keys(r)[0]]);
    if (this._raw) return rows.map((r) => res.fields.map((f) => r[f]));
    return rows;
  }
  get(...args) { return this._rows(this._exec(args))[0]; }
  all(...args) { return this._rows(this._exec(args)); }
  iterate(...args) { return this.all(...args)[Symbol.iterator](); }
  run(...args) { const res = this._exec(args); return { changes: res.rowCount, lastInsertRowid: 0 }; }
  pluck(on = true) { this._pluck = on; return this; }
  raw(on = true) { this._raw = on; return this; }
  expand() { return this; }
  safeIntegers() { return this; }
  bind() { throw new Error('bind() is not supported by the PostgreSQL adapter'); }
}

class PgDatabase {
  constructor(url, opts = {}) {
    this.url = url;
    this.name = url;
    this.readonly = !!opts.readonly;
    this.client = new SyncPg(url);
    this.depth = 0;
    this.open = true;
  }
  _query(sql) { return this.client.query(sql, this.depth > 0); }
  prepare(sql) { return new Statement(this, sql); }
  exec(sql) { this._query(translate(sql, [])); return this; }
  transaction(fn) {
    const db = this;
    const wrapped = function (...args) {
      const sp = `dd_tx_${db.depth}`;
      if (db.depth === 0) db.client.query('BEGIN');
      else db.client.query(`SAVEPOINT ${sp}`);
      db.depth++;
      let out;
      try {
        out = fn.apply(this, args);
      } catch (e) {
        db.depth--;
        try { db.client.query(db.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${sp}; RELEASE SAVEPOINT ${sp}`); } catch { /* keep original error */ }
        throw e;
      }
      db.depth--;
      try {
        db.client.query(db.depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${sp}`);
      } catch (e) {
        // e.g. a deferred foreign key fails at COMMIT: PostgreSQL has already rolled back; keep depth consistent.
        if (db.depth > 0) { try { db.client.query(`ROLLBACK TO SAVEPOINT ${sp}; RELEASE SAVEPOINT ${sp}`); } catch { /* ignore */ } }
        else { try { db.client.query('ROLLBACK'); } catch { /* ignore */ } }
        throw e;
      }
      return out;
    };
    wrapped.deferred = wrapped; wrapped.immediate = wrapped; wrapped.exclusive = wrapped;
    return wrapped;
  }
  get inTransaction() { return this.depth > 0; }
  pragma(text, opts = {}) {
    const p = String(text).trim().toLowerCase();
    let out = [];
    if (p.startsWith('defer_foreign_keys')) { if (this.depth > 0) this._query('SET CONSTRAINTS ALL DEFERRED'); }
    else if (p.startsWith('integrity_check') || p.startsWith('quick_check')) out = [{ integrity_check: 'ok' }];
    else if (p.startsWith('foreign_key_check')) out = [];
    else if (p.startsWith('table_info')) {
      const t = /\(\s*['"]?([\w]+)['"]?\s*\)/.exec(p)?.[1];
      out = this.prepare(`SELECT ordinal_position - 1 AS cid, column_name AS name, data_type AS type, CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull, column_default AS dflt_value, 0 AS pk FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name <> 'rowid' ORDER BY ordinal_position`).all(t);
    }
    // journal_mode, foreign_keys, busy_timeout, synchronous, wal_checkpoint: no-ops on PostgreSQL
    if (opts.simple) { const r = out[0]; return r ? Object.values(r)[0] : undefined; }
    return out;
  }
  function() { throw new Error('db.function() is not supported by the PostgreSQL adapter'); }
  close() { if (this.open) { this.client.close(); this.open = false; } }
}

module.exports = { PgDatabase, Statement };
