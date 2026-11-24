/**
 * DukaanDesk Pro main PC: settings written by the installer (server.json), shared by the
 * desktop app and the background server service.
 *   %ProgramData%\dukaandeskpro\server.json (override: DD_SERVER_CONFIG)
 *   {
 *     "databaseUrl": "postgres://dukaandesk:<generated>@127.0.0.1:5449/dukaandesk",
 *     "pgBin": "C:\\Program Files\\DukaanDesk Pro\\resources\\pgsql\\bin",
 *     "lan": true, "installMode": "main-till" | "server-only",
 *     "apiPort": 3847, "backupDir": "...", "licenceHome": "%ProgramData%\\dukaandeskpro\\licence"
 *   }
 * No file = single-PC dev / P1-style start (nothing changes).
 */
const fs = require('node:fs');
const path = require('node:path');

function configPath() {
  if (process.env.DD_SERVER_CONFIG) return process.env.DD_SERVER_CONFIG;
  const base = process.env.ProgramData || process.env.PROGRAMDATA || 'C:\\ProgramData';
  return path.join(base, 'dukaandeskpro', 'server.json');
}

function readServerConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return null;
  }
}

/** Env for the API process from server.json (only keys that are set). */
function serverEnv(cfg = readServerConfig()) {
  if (!cfg) return {};
  const e = {};
  if (cfg.databaseUrl) e.DATABASE_URL = String(cfg.databaseUrl);
  if (cfg.pgBin) e.DD_PG_BIN = String(cfg.pgBin);
  if (cfg.pgLib) e.DD_PG_LIB = String(cfg.pgLib);
  if (cfg.lan) e.DD_LAN = '1';
  if (cfg.installMode) e.DD_INSTALL_MODE = String(cfg.installMode);
  if (cfg.apiPort) e.API_PORT = String(cfg.apiPort);
  if (cfg.backupDir) e.DD_BACKUP_DIR = String(cfg.backupDir);
  if (cfg.licenceHome) e.DD_LICENSE_HOME = String(cfg.licenceHome);
  if (cfg.sessionSecretFile && fs.existsSync(cfg.sessionSecretFile)) {
    e.SESSION_SECRET = fs.readFileSync(cfg.sessionSecretFile, 'utf8').trim();
  }
  return e;
}

module.exports = { configPath, readServerConfig, serverEnv };
