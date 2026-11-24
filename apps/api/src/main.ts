import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { TillsService } from './tills/tills.service';
import { tillAls } from './tills/till-context';
import { lanEnabled, lanGate, listenHost, startDiscovery } from './tills/lan';
import { DbService } from './db/db.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // Backup copies carry product pictures (base64), so allow large JSON bodies.
  app.useBodyParser('json', { limit: '100mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
  app.use(cookieParser());
  // Which till each request comes from (device key header, or this PC's own Till 1).
  const tills = app.get(TillsService);
  app.use((req: Parameters<TillsService['resolve']>[0], _res: unknown, next: () => void) => {
    tillAls.run(tills.resolve(req), next);
  });
  app.use(lanGate);
  const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  app.enableCors({
    origin,
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'X-Backup-Copy-Id'],
  });
  const port = Number(process.env.API_PORT ?? 3847);
  const host = listenHost();
  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`DukaanDesk Pro API listening on ${host}:${port}`);
  if (lanEnabled()) {
    const db = app.get(DbService);
    startDiscovery(() => {
      const r = db.raw.prepare(`SELECT name FROM store LIMIT 1`).get() as { name?: string } | undefined;
      return { name: r?.name ?? 'DukaanDesk Pro', port, mode: tills.mode() };
    });
  }
}
bootstrap();
