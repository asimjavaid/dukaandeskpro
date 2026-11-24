'use strict';
/**
 * Places the trial/licence record is kept. Each holds the same MAC'd record;
 * the evaluator takes the EARLIEST first-run and LATEST last-seen across them,
 * so deleting one (or two) does not reset the trial.
 *   1. app-data file   (%APPDATA%\dukaandeskpro\runtime.dat)
 *   2. hidden file     (%LOCALAPPDATA%\.ddrrt, attrib +h)
 *   3. registry        (HKCU\Software\dukaandeskpro\Runtime  rt)   — Windows only
 *   4. SQLite table    license_state                          — API only
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const isWin = process.platform === 'win32';

function homeBase() {
  if (process.env.DD_LICENSE_HOME) return { app: path.join(process.env.DD_LICENSE_HOME, 'app'), hidden: path.join(process.env.DD_LICENSE_HOME, 'hid') };
  if (isWin) {
    return {
      app: path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'dukaandeskpro'),
      hidden: process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    };
  }
  return { app: path.join(os.homedir(), '.config', 'dukaandeskpro'), hidden: os.homedir() };
}

function fileStore(name, filePath, hidden) {
  return {
    name,
    read() {
      try { return fs.readFileSync(filePath, 'utf8').trim() || null; } catch { return null; }
    },
    write(text) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        if (fs.existsSync(filePath)) {
          // Windows refuses 'w' on hidden files; r+ + truncate works.
          const fd = fs.openSync(filePath, 'r+');
          try { fs.ftruncateSync(fd, 0); fs.writeSync(fd, text, 0, 'utf8'); } finally { fs.closeSync(fd); }
        } else {
          fs.writeFileSync(filePath, text, 'utf8');
          if (hidden && isWin) {
            try { execFileSync('attrib', ['+h', filePath], { windowsHide: true, stdio: 'ignore' }); } catch { /* best effort */ }
          }
        }
        return true;
      } catch { return false; }
    },
  };
}

const REG_KEY = 'HKCU\\Software\\dukaandeskpro\\Runtime';
function registryStore() {
  return {
    name: 'registry',
    read() {
      try {
        const out = execFileSync('reg', ['query', REG_KEY, '/v', 'rt'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const m = out.match(/rt\s+REG_SZ\s+(\S+)/);
        return m ? m[1] : null;
      } catch { return null; }
    },
    write(text) {
      try {
        execFileSync('reg', ['add', REG_KEY, '/v', 'rt', '/t', 'REG_SZ', '/d', text, '/f'], { windowsHide: true, stdio: 'ignore' });
        return true;
      } catch { return false; }
    },
  };
}

/** @param {import('better-sqlite3').Database} db */
function dbStore(db) {
  db.exec('CREATE TABLE IF NOT EXISTS license_state (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  return {
    name: 'db',
    read() {
      try { const r = db.prepare("SELECT v FROM license_state WHERE k='rt'").get(); return r ? r.v : null; } catch { return null; }
    },
    write(text) {
      try { db.prepare("INSERT INTO license_state (k, v) VALUES ('rt', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(text); return true; } catch { return false; }
    },
  };
}

/** Default stores for this machine (+ optional DB). */
function defaultStores(db) {
  const b = homeBase();
  const list = [
    fileStore('appdata', path.join(b.app, 'runtime.dat'), false),
    fileStore('hidden', path.join(b.hidden, '.ddrrt'), true),
  ];
  if (isWin) list.push(registryStore());
  if (db) list.push(dbStore(db));
  return list;
}

function memoryStore(name, initial = null) {
  let v = initial;
  return { name, read: () => v, write: (t) => { v = t; return true; }, _peek: () => v, _set: (t) => { v = t; } };
}

module.exports = { defaultStores, fileStore, registryStore, dbStore, memoryStore, homeBase };
