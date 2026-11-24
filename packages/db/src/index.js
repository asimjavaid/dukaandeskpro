const { migrate, resolveDbPath, MIGRATIONS_DIR } = require('./migrate');

const pg = require('./pg');

module.exports = { migrate, resolveDbPath, MIGRATIONS_DIR, pg };
