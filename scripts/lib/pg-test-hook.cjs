'use strict';
/**
 * Test-only: run P1's test scripts against PostgreSQL.  NODE_OPTIONS="--require ./scripts/lib/pg-test-hook.cjs" DD_DB=pg
 * Redirects require('better-sqlite3') (and absolute .../better-sqlite3 paths) to the PostgreSQL adapter, so the
 * scripts' direct DB reads/writes hit the same mapped database the API uses.
 */
if (process.env.DD_DB === 'pg') {
  const Module = require('node:module');
  const path = require('node:path');
  const fake = path.join(__dirname, '__pg_better_sqlite3__.js');
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'better-sqlite3' || /[\\/]better-sqlite3[\\/]?$/.test(request)) {
      // the API's DbService and build tools that need real SQLite opt out with DD_REAL_SQLITE
      if (!process.env.DD_REAL_SQLITE) return fake;
    }
    return orig.call(this, request, parent, ...rest);
  };
}
