import { Injectable, Logger } from '@nestjs/common';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pg } from '@dukaandeskpro/db';
import { DbService } from '../db/db.service';

/** Full-database copies for Lite (PostgreSQL): pg_dump custom format (`.ddpro`) and pg_restore. */
export const DB_COPY_EXT = '.ddpro';

export type PgResult = { ok: true; file: string; size: number } | { ok: false; error: string; detail?: string };

function exe(name: string): string {
  const dir = process.env.DD_PG_BIN;
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  return dir ? path.join(dir, file) : file;
}

function childEnv(url: URL): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  if (process.env.DD_PG_LIB) {
    const key = process.platform === 'win32' ? 'PATH' : 'LD_LIBRARY_PATH';
    env[key] = [process.env.DD_PG_LIB, env[key]].filter(Boolean).join(path.delimiter);
  }
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  return env;
}

/** Connection URL without the password (it goes through PGPASSWORD, never the command line). */
function bare(url: URL): string {
  const u = new URL(url.toString());
  u.password = '';
  return u.toString();
}

export function isDbCopy(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(5);
    fs.readSync(fd, b, 0, 5, 0);
    fs.closeSync(fd);
    return b.toString('latin1') === 'PGDMP';
  } catch {
    return false;
  }
}

@Injectable()
export class PgBackupService {
  private readonly log = new Logger('PgBackup');
  private busy = false;

  constructor(private readonly db: DbService) {}

  get enabled(): boolean {
    return this.db.engine === 'postgres';
  }

  url(): URL {
    return new URL(pg.resolvePgUrl(this.db.dbPath));
  }

  /** Default folder for automatic copies: DD_BACKUP_DIR (set by the desktop app) or next to the data. */
  defaultDir(): string {
    return process.env.DD_BACKUP_DIR ? path.resolve(process.env.DD_BACKUP_DIR) : path.join(path.dirname(this.db.dbPath), 'backups');
  }

  dump(target: string): PgResult {
    if (!this.enabled) return { ok: false, error: 'not_postgres' };
    const url = this.url();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.part`;
    const r = spawnSync(exe('pg_dump'), ['--format=custom', '--compress=6', '--no-owner', '--no-privileges', `--file=${tmp}`, `--dbname=${bare(url)}`], {
      env: childEnv(url),
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      windowsHide: true,
    });
    if (r.error || r.status !== 0 || !isDbCopy(tmp)) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      const detail = (r.error?.message || r.stderr || `exit ${r.status}`).toString().slice(0, 300);
      this.log.warn(`pg_dump failed: ${detail}`);
      return { ok: false, error: 'dump_failed', detail };
    }
    fs.renameSync(tmp, target);
    return { ok: true, file: target, size: fs.statSync(target).size };
  }

  /**
   * Replace the whole database with a `.ddpro` copy. A safety copy of the current data is written first
   * (into `safetyDir`); the restore runs in one transaction, so a failure leaves the current data as it was.
   */
  restore(file: string, safetyDir: string, stamp: string): { ok: true; safety_file: string } | { ok: false; error: string; detail?: string } {
    if (!this.enabled) return { ok: false, error: 'not_postgres' };
    if (this.busy) return { ok: false, error: 'busy' };
    if (!fs.existsSync(file) || !isDbCopy(file)) return { ok: false, error: 'not_a_db_copy' };
    this.busy = true;
    try {
      const safety = path.join(safetyDir, `dukaandesk-before-restore-${stamp}${DB_COPY_EXT}`);
      const s = this.dump(safety);
      if (!s.ok) return { ok: false, error: 'safety_backup_failed', detail: s.detail };
      const url = this.url();
      const r = spawnSync(
        exe('pg_restore'),
        ['--clean', '--if-exists', '--single-transaction', '--exit-on-error', '--no-owner', '--no-privileges', `--dbname=${bare(url)}`, file],
        { env: childEnv(url), encoding: 'utf8', timeout: 15 * 60 * 1000, windowsHide: true },
      );
      if (r.error || r.status !== 0) {
        const detail = (r.error?.message || r.stderr || `exit ${r.status}`).toString().slice(0, 300);
        this.log.error(`pg_restore failed, data unchanged: ${detail}`);
        return { ok: false, error: 'restore_failed', detail };
      }
      this.log.log(`database restored from ${file}; safety copy ${safety}`);
      return { ok: true, safety_file: safety };
    } finally {
      this.busy = false;
    }
  }
}
