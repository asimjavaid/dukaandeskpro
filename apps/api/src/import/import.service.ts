import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { CatalogService, PRODUCT_UNITS } from '../catalog/catalog.service';
import { parseQty } from '../common/qty';
import { writeAudit } from '../sales/sale-reversal';

export type ImportRow = {
  name?: unknown;
  name_ur?: unknown;
  price?: unknown;
  barcode?: unknown;
  unit?: unknown;
  cost?: unknown;
  stock?: unknown;
  reorder?: unknown;
  pieces_per_carton?: unknown;
};

type RowResult = { row: number; name: string; status: 'add' | 'skip_exists' | 'error'; error?: string };

const UNITS = new Set<string>(PRODUCT_UNITS);
const UNIT_ALIASES: Record<string, string> = {
  pc: 'piece', pcs: 'piece', pieces: 'piece', nos: 'piece', each: 'piece',
  pack: 'packet', pkt: 'packet', packets: 'packet',
  kgs: 'kg', kilo: 'kg', g: 'gram', gm: 'gram', grams: 'gram',
  dz: 'dozen', doz: 'dozen', dozens: 'dozen', ctn: 'carton', cartons: 'carton', boxes: 'box', bottles: 'bottle', btl: 'bottle',
  cans: 'can', jars: 'jar', tins: 'tin', tubes: 'tube', bars: 'bar', sachets: 'sachet', strips: 'strip', patta: 'strip',
  trays: 'tray', rolls: 'roll', bundles: 'bundle', bags: 'bag', bori: 'bag', pairs: 'pair',
  m: 'meter', metre: 'meter', meters: 'meter', metres: 'meter', ft: 'foot', feet: 'foot',
  l: 'litre', ltr: 'litre', liter: 'litre', litres: 'litre', liters: 'litre',
};

/**
 * In-app product import (rows parsed from Excel / CSV in the browser).
 * Dry run first; real run adds new names only (existing name or barcode = skip).
 * Opening stock is written as a stock adjustment ("opening").
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly db: DbService,
    private readonly catalog: CatalogService,
  ) {}

  run(input: { rows?: ImportRow[]; dryRun?: boolean; userId: string; storeId?: string | null }) {
    const rows = Array.isArray(input.rows) ? input.rows.slice(0, 5000) : [];
    if (rows.length === 0) return { ok: false as const, error: 'no_rows' };
    const seenNames = new Set<string>();
    const results: RowResult[] = [];
    const ready: Array<{ idx: number; name: string; nameUr: string | null; pricePaisa: number; barcode: string | null; unit: string; cost: number | null; stock: number; reorder: number | null; ppc: number }> = [];
    rows.forEach((r, i) => {
      const n = i + 1;
      const name = String(r.name ?? '').trim().slice(0, 160);
      if (!name) return results.push({ row: n, name: '', status: 'error', error: 'name_required' });
      const price = Number(String(r.price ?? '').replace(/[,\s]|rs\.?/gi, ''));
      if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) {
        return results.push({ row: n, name, status: 'error', error: 'price_invalid' });
      }
      let unit = String(r.unit ?? '').trim().toLowerCase() || 'piece';
      unit = UNIT_ALIASES[unit] ?? unit;
      if (!UNITS.has(unit)) return results.push({ row: n, name, status: 'error', error: 'unit_invalid' });
      const barcode = String(r.barcode ?? '').replace(/\s/g, '') || null;
      if (barcode && !/^\d{8}$|^\d{12,14}$/.test(barcode)) {
        return results.push({ row: n, name, status: 'error', error: 'barcode_invalid' });
      }
      const key = name.toLowerCase();
      const exists =
        seenNames.has(key) ||
        this.db.raw.prepare(`SELECT 1 FROM products WHERE lower(name) = ?`).get(key) ||
        (barcode && this.db.raw.prepare(`SELECT 1 FROM products WHERE barcode = ? UNION SELECT 1 FROM product_barcodes WHERE barcode = ?`).get(barcode, barcode));
      if (exists) return results.push({ row: n, name, status: 'skip_exists' });
      let cost: number | null = null;
      if (r.cost != null && String(r.cost).trim() !== '') {
        const c = Number(String(r.cost).replace(/[,\s]|rs\.?/gi, ''));
        if (!Number.isFinite(c) || c < 0) return results.push({ row: n, name, status: 'error', error: 'cost_invalid' });
        cost = Math.round(c * 100);
      }
      let stock = 0;
      if (r.stock != null && String(r.stock).trim() !== '' && Number(r.stock) !== 0) {
        const q = parseQty(r.stock, unit);
        if (!q.ok) return results.push({ row: n, name, status: 'error', error: 'stock_invalid' });
        stock = q.n;
      }
      let reorder: number | null = null;
      if (r.reorder != null && String(r.reorder).trim() !== '') {
        const v = Number(r.reorder);
        if (!Number.isFinite(v) || v < 0) return results.push({ row: n, name, status: 'error', error: 'reorder_invalid' });
        reorder = Math.round(v * 1000) / 1000;
      }
      const ppc = Math.max(1, Math.floor(Number(r.pieces_per_carton ?? 1) || 1));
      seenNames.add(key);
      results.push({ row: n, name, status: 'add' });
      ready.push({
        idx: results.length - 1,
        name,
        nameUr: String(r.name_ur ?? '').trim().slice(0, 160) || null,
        pricePaisa: Math.round(price * 100),
        barcode,
        unit,
        cost,
        stock,
        reorder,
        ppc,
      });
    });
    const summary = {
      rows: rows.length,
      to_add: results.filter((r) => r.status === 'add').length,
      skipped: results.filter((r) => r.status === 'skip_exists').length,
      errors: results.filter((r) => r.status === 'error').length,
    };
    if (input.dryRun) return { ok: true as const, dryRun: true, ...summary, results };

    let added = 0;
    this.db.raw.transaction(() => {
      for (const p of ready) {
        const c = this.catalog.create({
          name: p.name,
          pricePaisa: p.pricePaisa,
          unitLabel: p.unit,
          piecesPerCarton: p.ppc,
          barcode: p.barcode,
        });
        if (!c.ok) {
          results[p.idx] = { ...results[p.idx], status: 'error', error: c.error };
          continue;
        }
        added += 1;
        const id = c.product.id;
        this.db.raw
          .prepare(`UPDATE products SET name_ur = ?, last_unit_cost_paisa = COALESCE(?, last_unit_cost_paisa), reorder_level = ? WHERE id = ?`)
          .run(p.nameUr, p.cost, p.reorder, id);
        if (p.stock > 0) {
          this.db.raw
            .prepare(
              `INSERT INTO stock_balances (product_id, qty_on_hand, updated_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(product_id) DO UPDATE SET qty_on_hand = ROUND(qty_on_hand + excluded.qty_on_hand, 3), updated_at = datetime('now')`,
            )
            .run(id, p.stock);
          this.db.raw
            .prepare(
              `INSERT INTO stock_adjustments (id, product_id, delta_pieces, qty_before, qty_after, reason, created_by, note, unit_cost_paisa)
               VALUES (?, ?, ?, 0, ?, 'opening', ?, 'import', ?)`,
            )
            .run(randomUUID(), id, p.stock, p.stock, input.userId, p.cost);
        }
      }
      writeAudit(this.db.raw, {
        action: 'catalog.import',
        userId: input.userId,
        storeId: input.storeId ?? null,
        subjectType: 'catalog',
        subjectId: 'import',
        payload: { rows: rows.length, added },
      });
    })();
    return { ok: true as const, dryRun: false, ...summary, added, results };
  }
}
