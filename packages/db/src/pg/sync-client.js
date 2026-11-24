'use strict';
/** Synchronous PostgreSQL access for code written against better-sqlite3 (one dedicated connection). */
const path = require('node:path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('node:worker_threads');

class SyncPg {
  constructor(url) {
    this.url = url;
    this.signal = new SharedArrayBuffer(4);
    this.flag = new Int32Array(this.signal);
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    let tz = 'UTC';
    try { tz = process.env.DD_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* default */ }
    this.worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { port: port2, signal: this.signal, url, tz }, transferList: [port2] });
    this.worker.unref();
    this.port.unref();
    this.open = true;
  }

  call(msg, timeoutMs = 120000) {
    if (!this.open) throw new Error('The database connection is not open');
    Atomics.store(this.flag, 0, 0);
    this.port.postMessage(msg);
    const r = Atomics.wait(this.flag, 0, 0, timeoutMs);
    if (r === 'timed-out') throw Object.assign(new Error('Database did not answer in time'), { code: 'SQLITE_BUSY' });
    const got = receiveMessageOnPort(this.port);
    if (!got) throw new Error('Database reply missing');
    return got.message;
  }

  query(sql, guard = false) {
    const m = this.call({ op: 'query', sql, guard });
    if (!m.ok) throw toSqliteError(m.err, sql);
    for (const row of m.res.rows) for (const k in row) if (row[k] instanceof Uint8Array && !Buffer.isBuffer(row[k])) row[k] = Buffer.from(row[k]);
    return m.res;
  }

  close() {
    if (!this.open) return;
    try { this.call({ op: 'close' }, 10000); } catch { /* ignore */ }
    this.open = false;
    this.worker.terminate();
  }
}

/** Map PostgreSQL errors to better-sqlite3-like codes/messages so P1 error handling keeps working. */
function toSqliteError(e, sql) {
  let code = 'SQLITE_ERROR';
  let message = e.message;
  const col = (() => { const m = /Key \(([^)]+)\)/.exec(e.detail || ''); return m ? m[1].split(',').map((c) => `${e.table}.${c.trim()}`).join(', ') : ''; })();
  switch (e.code) {
    case '23505': code = 'SQLITE_CONSTRAINT_UNIQUE'; message = `UNIQUE constraint failed: ${col || e.constraint}`; break;
    case '23503': code = 'SQLITE_CONSTRAINT_FOREIGNKEY'; message = 'FOREIGN KEY constraint failed'; break;
    case '23514': code = 'SQLITE_CONSTRAINT_CHECK'; message = `CHECK constraint failed: ${e.constraint}`; break;
    case '23502': code = 'SQLITE_CONSTRAINT_NOTNULL'; message = `NOT NULL constraint failed: ${e.table}.${e.column}`; break;
    case 'P0001': code = 'SQLITE_CONSTRAINT_TRIGGER'; break;
    case '40001': case '40P01': case '55P03': code = 'SQLITE_BUSY'; break;
    default: break;
  }
  const err = new Error(message);
  err.code = code;
  err.pgCode = e.code;
  err.pgDetail = e.detail;
  if (process.env.DD_PG_DEBUG && code === 'SQLITE_ERROR') {
    err.message += `\n  SQL: ${sql.slice(0, 2000)}`;
    console.error('[pg]', err.message);
  }
  return err;
}

module.exports = { SyncPg, toSqliteError };
