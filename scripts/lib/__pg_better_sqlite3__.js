'use strict';
/** Test-only stand-in for better-sqlite3 when DD_DB=pg (see pg-test-hook.cjs). */
const path = require('node:path');
const pg = require(path.join(__dirname, '../../packages/db/src/pg'));
function Database(target, opts) { return pg.openDatabase(target, opts || {}); }
Database.prototype = pg.PgDatabase.prototype;
module.exports = Database;
module.exports.default = Database;
