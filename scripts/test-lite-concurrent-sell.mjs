#!/usr/bin/env node
/**
 * DukaanDesk Pro: several tills selling the same item at once must never oversell.
 * 20 parallel 1-piece sales against 3 in stock -> exactly 3 succeed, stock ends at 0, bill ids unique.
 *   DD_DB=pg node scripts/test-lite-concurrent-sell.mjs   (also runs on SQLite)
 */
import { startApi, seed, makeChecks } from './lib/sales-harness.mjs';

const api = await startApi('lite-concurrent', Number(process.env.API_PORT ?? 3931));
const c = makeChecks();
try {
  const s = await seed(api);
  const at = () => new Date().toISOString();
  await s.sell(s.cashier, { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.daal.id, qty: 97, unit: 'piece' }] });
  c.ok(Number(s.stock(s.daal.id)) === 3, 'stock 3 before the rush');
  const tokens = [s.cashier, s.owner];
  const reqs = Array.from({ length: 20 }, (_, i) => api.request('POST', '/sales', {
    token: tokens[i % 2],
    body: { paymentMethod: 'cash', clientDeviceAt: at(), lines: [{ productId: s.daal.id, qty: 1, unit: 'piece' }] },
  }));
  const res = await Promise.all(reqs);
  const ok = res.filter((r) => r.status === 201 && r.json?.ok);
  const refused = res.filter((r) => !(r.status === 201 && r.json?.ok));
  c.ok(ok.length === 3, `exactly 3 of 20 parallel sales succeed (got ${ok.length})`);
  c.ok(refused.every((r) => r.status < 500), `refusals are clean, no 500s (${refused.map((r) => r.status).join(',')})`);
  c.ok(Number(s.stock(s.daal.id)) === 0, `stock ends at 0 (got ${s.stock(s.daal.id)})`);
  const ids = ok.map((r) => r.json.sale.shortId);
  c.ok(new Set(ids).size === ids.length, 'bill ids unique');
  const d = s.db();
  const n = d.prepare(`SELECT COUNT(*) AS n FROM sales WHERE voided_at IS NULL`).get().n;
  d.close();
  c.ok(Number(n) === 4, `4 sales recorded (got ${n})`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  api.stop();
}
if (!process.exitCode) console.log(`${c.passed} checks passed`);
