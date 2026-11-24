'use strict';
/** Worker thread: owns ONE PostgreSQL connection; main thread blocks on Atomics.wait until each reply. */
const { workerData, receiveMessageOnPort } = require('node:worker_threads');
const pg = require('pg');

pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));   // int8
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric
pg.types.setTypeParser(16, (v) => (v === 't' ? 1 : 0));               // bool -> 1/0 like SQLite
pg.types.setTypeParser(1114, (v) => v);                               // timestamp as text
pg.types.setTypeParser(1184, (v) => v);
pg.types.setTypeParser(1082, (v) => v);

const { port, signal, url, tz } = workerData;
const flag = new Int32Array(signal);
const client = new pg.Client({ connectionString: url, application_name: 'dukaandeskpro' });
let ready = client.connect().then(() => client.query(`SET TIME ZONE 'UTC'; SELECT set_config('dd.tz', $$${String(tz || 'UTC').replace(/\$/g, '')}$$, false)`));

function reply(msg) {
  port.postMessage(msg);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

function shape(res) {
  const list = Array.isArray(res) ? res : [res];
  const last = [...list].reverse().find((r) => r.command && r.command !== 'RELEASE' && r.command !== 'SAVEPOINT') || list[list.length - 1];
  return { rows: last.rows || [], rowCount: last.rowCount || 0, command: last.command, fields: (last.fields || []).map((f) => f.name) };
}

async function handle(m) {
  try {
    await ready;
    if (m.op === 'close') { await client.end(); reply({ ok: true }); return false; }
    let sql = m.sql;
    if (m.guard) {
      // Inside a transaction: wrap each statement so a failed one does not abort the whole
      // transaction (SQLite semantics: only the failing statement is undone).
      try {
        const res = await client.query(`SAVEPOINT dd_stmt; ${sql}; RELEASE SAVEPOINT dd_stmt`);
        reply({ ok: true, res: shape(res) });
      } catch (e) {
        try { await client.query('ROLLBACK TO SAVEPOINT dd_stmt; RELEASE SAVEPOINT dd_stmt'); } catch { /* ignore */ }
        reply({ ok: false, err: errOf(e) });
      }
      return true;
    }
    const res = await client.query(sql);
    reply({ ok: true, res: shape(res) });
  } catch (e) {
    reply({ ok: false, err: errOf(e) });
  }
  return true;
}

function errOf(e) {
  return { message: e.message, code: e.code, detail: e.detail, table: e.table, column: e.column, constraint: e.constraint, schema: e.schema };
}

port.on('message', async (m) => { await handle(m); });
