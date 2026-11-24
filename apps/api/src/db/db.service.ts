import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { migrate, pg } from '@dukaandeskpro/db';

/**
 * DukaanDesk Pro database handle.
 * - PostgreSQL (default for Lite): DATABASE_URL, or DD_DB=pg for dev/test path-mapped databases.
 * - SQLite (legacy, P1 behaviour): when neither is set. Kept only so P1 tooling/imports still run.
 * Both expose the better-sqlite3 call style (prepare/get/all/run/transaction) used across the API.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private db!: Database.Database;
  dbPath!: string;
  engine: 'postgres' | 'sqlite' = 'sqlite';

  onModuleInit() {
    this.dbPath = this.resolvePath();
    if (pg.isPgMode()) {
      this.engine = 'postgres';
      migrate(this.dbPath);
      this.db = pg.openDatabase(this.dbPath) as unknown as Database.Database;
      return;
    }
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    migrate(this.dbPath);
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  onModuleDestroy() {
    this.db?.close();
  }

  get raw(): Database.Database {
    return this.db;
  }

  private resolvePath(): string {
    if (process.env.SQLITE_PATH) {
      return path.resolve(process.env.SQLITE_PATH);
    }
    // Default under apps/api/data when not launched by Electron
    return path.resolve(__dirname, '../../data/dukaandesk.sqlite');
  }
}
