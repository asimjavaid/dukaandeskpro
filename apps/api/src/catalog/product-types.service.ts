import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { CatalogService } from './catalog.service';
import { planTypes, runTypes, setProductType, undoRun, type RunLog } from './product-types';
import { runBuyUnits, undoBuyUnits, type BuyRunLog } from './buy-units';

@Injectable()
export class ProductTypesService implements OnApplicationBootstrap {
  constructor(
    private readonly db: DbService,
    private readonly catalog: CatalogService,
  ) {}

  /** First start after migration 040: sort the catalog once. Later runs only from Settings. */
  onApplicationBootstrap() {
    if (process.env.DD_SKIP_TYPE_SORT === '1') return;
    const ran = this.db.raw.prepare(`SELECT 1 FROM product_type_runs LIMIT 1`).get();
    const any = this.db.raw.prepare(`SELECT 1 FROM products LIMIT 1`).get();
    if (!ran && any) this.run(null);
    const bought = this.db.raw.prepare(`SELECT 1 FROM buy_unit_runs LIMIT 1`).get();
    if (!bought && any && process.env.DD_SKIP_BUY_UNITS !== '1') this.runBuy(null);
  }

  /** Loose staples + purchase package (carton / crate / piece) for every product. */
  runBuy(userId: string | null) {
    const r = runBuyUnits(this.db.raw, userId, (name) => {
      const made = this.catalog.create({ name, priceRs: 0, unitLabel: 'kg' });
      if (!made.ok) throw new Error(made.error);
      return made.product.id;
    });
    return { ok: true as const, id: r.id, ...this.buySummary(r.log) };
  }

  private buySummary(log: BuyRunLog) {
    const name = (id: string) => (this.db.raw.prepare(`SELECT name FROM products WHERE id = ?`).get(id) as { name: string } | undefined)?.name ?? id;
    const counts = this.db.raw
      .prepare(`SELECT COALESCE(buy_unit, 'none') AS u, COUNT(*) AS n FROM products WHERE active = 1 AND product_type = 'normal' GROUP BY 1`)
      .all() as Array<{ u: string; n: number }>;
    return {
      created: log.created.map(name),
      renamed: log.renamed,
      linked: log.linked.map((l) => name(l.id)),
      resolved: log.resolved.map(name),
      changed: log.buy.length,
      counts: Object.fromEntries(counts.map((c) => [c.u, c.n])),
      uncertain: log.uncertain,
    };
  }

  buyRuns() {
    return (this.db.raw.prepare(`SELECT id, ran_at, undone_at, changes_json FROM buy_unit_runs ORDER BY ran_at DESC LIMIT 20`).all() as Array<{
      id: string; ran_at: string; undone_at: string | null; changes_json: string;
    }>).map((r) => ({ id: r.id, ran_at: r.ran_at, undone_at: r.undone_at, ...this.buySummary(JSON.parse(r.changes_json) as BuyRunLog) }));
  }

  undoBuy(id: string) {
    return undoBuyUnits(this.db.raw, id);
  }

  plan() {
    const p = planTypes(this.db.raw);
    return {
      ok: true as const,
      counts: {
        bulk: p.changes.filter((c) => c.after.product_type === 'bulk').length + p.createStaples.length,
        packed: p.changes.filter((c) => c.after.product_type === 'packed').length,
        create: p.createStaples.length,
        packs: p.packs.length,
        review: p.review.length,
      },
      ...p,
    };
  }

  run(userId: string | null) {
    const r = runTypes(this.db.raw, userId, (name) => {
      const made = this.catalog.create({ name, priceRs: 0, unitLabel: 'kg' });
      if (!made.ok) throw new Error(made.error);
      return made.product.id;
    });
    return { ok: true as const, ...r };
  }

  undo(id: string) {
    return undoRun(this.db.raw, id);
  }

  runs() {
    return this.db.raw
      .prepare(`SELECT id, ran_at, user_id, undone_at, changes_json FROM product_type_runs ORDER BY ran_at DESC LIMIT 20`)
      .all()
      .map((r: unknown) => {
        const x = r as { id: string; ran_at: string; undone_at: string | null; changes_json: string };
        const log = JSON.parse(x.changes_json) as RunLog;
        const n = (t: string) => log.products.filter((p) => p.after.product_type === t).length;
        return {
          id: x.id,
          ran_at: x.ran_at,
          undone_at: x.undone_at,
          changed: log.products.length,
          created: log.created_products.length,
          bulk: n('bulk') + log.created_products.length,
          packed: n('packed'),
          packs: log.created_packs.length,
          review: log.review.length,
        };
      });
  }

  review(all = false) {
    const rows = this.db.raw
      .prepare(
        `SELECT r.product_id, r.reason, r.kg, r.candidates_json, r.created_at, r.resolved_at, p.name, p.unit_label, p.price_paisa, p.barcode,
                p.product_type, COALESCE(s.qty_on_hand, 0) AS qty_on_hand
         FROM product_type_review r JOIN products p ON p.id = r.product_id LEFT JOIN stock_balances s ON s.product_id = p.id
         WHERE p.active = 1 ${all ? '' : 'AND r.resolved_at IS NULL'} ORDER BY p.name COLLATE NOCASE`,
      )
      .all() as Array<Record<string, unknown> & { candidates_json: string | null }>;
    return rows.map(({ candidates_json, ...r }) => ({ ...r, candidates: candidates_json ? JSON.parse(candidates_json) : [] }));
  }

  bulkList() {
    return this.db.raw
      .prepare(`SELECT id, name FROM products WHERE active = 1 AND product_type = 'bulk' ORDER BY name COLLATE NOCASE`)
      .all() as Array<{ id: string; name: string }>;
  }

  settings() {
    const r = this.db.raw.prepare(`SELECT sell_bulk_loose FROM store LIMIT 1`).get() as { sell_bulk_loose: number } | undefined;
    return { sell_bulk_loose: r ? r.sell_bulk_loose === 1 : true };
  }

  setSettings(input: { sell_bulk_loose?: unknown }) {
    if (typeof input.sell_bulk_loose !== 'boolean') return { ok: false as const, error: 'invalid_setting' };
    this.db.raw.prepare(`UPDATE store SET sell_bulk_loose = ?`).run(input.sell_bulk_loose ? 1 : 0);
    return { ok: true as const, settings: this.settings() };
  }

  resolve(productId: string, input: { type?: unknown; bulkId?: unknown; kg?: unknown }, userId: string | null) {
    const r = setProductType(this.db.raw, productId, input);
    if (!r.ok) return r;
    this.db.raw
      .prepare(`UPDATE product_type_review SET resolved_at = datetime('now'), resolved_by = ? WHERE product_id = ?`)
      .run(userId ?? 'user', productId);
    return { ok: true as const };
  }
}
