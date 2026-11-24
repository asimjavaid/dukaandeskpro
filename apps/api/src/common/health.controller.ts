import { Controller, Get } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { tillAls } from '../tills/till-context';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DbService) {}

  @Get()
  check() {
    let sqliteOk = false;
    try {
      this.db.raw.prepare('SELECT 1').get();
      sqliteOk = true;
    } catch {
      sqliteOk = false;
    }
    return {
      status: sqliteOk ? 'ok' : 'degraded',
      service: 'dukaandeskpro-api',
      sqlite: sqliteOk,
      engine: this.db.engine,
      product: 'DukaanDesk Pro',
      ...(tillAls.getStore()?.local ? { dbPath: this.db.dbPath } : {}),
      ts: new Date().toISOString(),
    };
  }
}
