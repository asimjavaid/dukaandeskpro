import { Injectable } from '@nestjs/common';
import { suggestPrices, type CostChange } from '../pricing/pricing';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { allowsFraction } from '../common/qty';
import { parseMoneyPair } from '../common/amount';
import { ensureBagPack } from '../catalog/product-types';
import { karachiYmd } from '../suppliers/suppliers.service';

type Fail = { ok: false; error: string };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const PACK_NAMES = ['Carton', 'Box', 'Bag', 'Bori', 'Bundle', 'Tray', 'Dozen', 'Packet', 'Tin', 'Crate', 'Sack', 'Pack'];
class Abort extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

@Injectable()
export class RepackService {
  constructor(private readonly db: DbService) {}

  private audit(action: string, userId: string | undefined, subjectId: string, payload: Record<string, unknown>) {
    const store = this.db.raw.prepare(`SELECT id FROM store LIMIT 1`).get() as { id: string } | undefined;
    this.db.raw
      .prepare(
        `INSERT INTO audit_log (id, action, user_id, store_id, subject_type, subject_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), action, userId ?? null, store?.id ?? null, action.split('.')[0], subjectId, JSON.stringify(payload));
  }

  // ---------- packs ----------
  packs(productId: string) {
    return this.db.raw
      .prepare(`SELECT id, product_id, name, units, barcode, sort FROM product_packs WHERE product_id = ? AND active = 1 ORDER BY sort, created_at`)
      .all(productId);
  }

  packsFor(productIds: string[]) {
    if (productIds.length === 0) return {};
    const rows = this.db.raw
      .prepare(
        `SELECT id, product_id, name, units, barcode FROM product_packs WHERE active = 1 AND product_id IN (${productIds.map(() => '?').join(',')})
         ORDER BY sort, created_at`,
      )
      .all(...productIds) as Array<{ product_id: string }>;
    const out: Record<string, unknown[]> = {};
    for (const r of rows) (out[r.product_id] ??= []).push(r);
    return out;
  }

  addPack(input: { productId?: string; name?: string; units?: unknown; barcode?: string | null }) {
    const productId = String(input.productId ?? '');
    if (!this.db.raw.prepare(`SELECT 1 FROM products WHERE id = ?`).get(productId)) return { ok: false as const, error: 'product_not_found' };
    const name = String(input.name ?? '').trim().slice(0, 30);
    if (!name) return { ok: false as const, error: 'invalid_name' };
    const units = Number(input.units);
    if (!Number.isFinite(units) || units <= 0 || units > 100000) return { ok: false as const, error: 'invalid_qty' };
    const barcode = String(input.barcode ?? '').trim() || null;
    if (barcode && !/^\d{4,20}$/.test(barcode)) return { ok: false as const, error: 'invalid_barcode' };
    if (barcode && this.db.raw.prepare(`SELECT 1 FROM product_packs WHERE barcode = ? AND active = 1 UNION SELECT 1 FROM products WHERE barcode = ? UNION SELECT 1 FROM product_barcodes WHERE barcode = ?`).get(barcode, barcode, barcode))
      return { ok: false as const, error: 'barcode_taken' };
    const id = randomUUID();
    const sort = (this.db.raw.prepare(`SELECT COUNT(*) AS n FROM product_packs WHERE product_id = ?`).get(productId) as { n: number }).n;
    this.db.raw
      .prepare(`INSERT INTO product_packs (id, product_id, name, units, barcode, sort) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, productId, name, r3(units), barcode, sort);
    return { ok: true as const, packs: this.packs(productId) };
  }

  removePack(id: string) {
    const p = this.db.raw.prepare(`SELECT product_id FROM product_packs WHERE id = ?`).get(id) as { product_id: string } | undefined;
    if (!p) return { ok: false as const, error: 'pack_not_found' };
    this.db.raw.prepare(`UPDATE product_packs SET active = 0 WHERE id = ?`).run(id);
    return { ok: true as const, packs: this.packs(p.product_id) };
  }

  packNames() {
    return PACK_NAMES;
  }

  /** Last pack + cost used for this product with this supplier. */
  hint(supplierId: string, productId: string) {
    const r = this.db.raw
      .prepare(
        `SELECT sp.pack_id, sp.pack_units, sp.last_cost_paisa, pp.name AS pack_name, pp.active
         FROM supplier_product_pack sp LEFT JOIN product_packs pp ON pp.id = sp.pack_id
         WHERE sp.supplier_id = ? AND sp.product_id = ?`,
      )
      .get(supplierId, productId) as
      | { pack_id: string | null; pack_units: number | null; last_cost_paisa: number | null; pack_name: string | null; active: number | null }
      | undefined;
    if (!r) return { ok: true as const, hint: null };
    if (r.pack_id && r.active !== 1) return { ok: true as const, hint: null };
    return { ok: true as const, hint: r };
  }

  lookupPack(barcode: string) {
    const r = this.db.raw
      .prepare(
        `SELECT pp.id AS pack_id, pp.name AS pack_name, pp.units AS pack_units, p.id, p.name, p.unit_label, p.last_unit_cost_paisa, p.price_paisa
         FROM product_packs pp JOIN products p ON p.id = pp.product_id AND p.active = 1
         WHERE pp.barcode = ? AND pp.active = 1`,
      )
      .get(String(barcode ?? '').trim());
    return r ? { ok: true as const, item: r } : { ok: false as const, error: 'barcode_not_found' };
  }

  // ---------- bulk link ----------
  link(input: { productId?: string; bulkId?: string | null; qtyEach?: unknown }) {
    const productId = String(input.productId ?? '');
    const p = this.db.raw.prepare(`SELECT id FROM products WHERE id = ?`).get(productId);
    if (!p) return { ok: false as const, error: 'product_not_found' };
    if (!input.bulkId) {
      this.db.raw
        .prepare(
          `UPDATE products SET repack_from_id = NULL, size_qty = NULL,
             product_type = CASE WHEN product_type = 'packed' THEN 'normal' ELSE product_type END, type_source = 'manual' WHERE id = ?`,
        )
        .run(productId);
      return { ok: true as const, link: null };
    }
    const bulkId = String(input.bulkId);
    if (bulkId === productId) return { ok: false as const, error: 'invalid_bulk' };
    const bulk = this.db.raw.prepare(`SELECT id, repack_from_id FROM products WHERE id = ? AND active = 1`).get(bulkId) as
      | { id: string; repack_from_id: string | null }
      | undefined;
    if (!bulk || bulk.repack_from_id) return { ok: false as const, error: 'invalid_bulk' };
    const isBulkForOthers = this.db.raw.prepare(`SELECT 1 FROM products WHERE repack_from_id = ? LIMIT 1`).get(productId);
    if (isBulkForOthers) return { ok: false as const, error: 'invalid_bulk' };
    const q = Number(input.qtyEach);
    if (!Number.isFinite(q) || q <= 0 || q > 100000) return { ok: false as const, error: 'invalid_qty' };
    const tx = this.db.raw.transaction(() => {
      this.db.raw.prepare(`UPDATE products SET repack_from_id = ?, size_qty = ?, size_group_id = NULL WHERE id = ?`).run(bulkId, r3(q), productId);
      // Product types: a kg bulk becomes Bulk, a piece item linked to it becomes Packed.
      const b = this.db.raw.prepare(`SELECT unit_label, product_type FROM products WHERE id = ?`).get(bulkId) as { unit_label: string; product_type: string };
      const me = this.db.raw.prepare(`SELECT unit_label FROM products WHERE id = ?`).get(productId) as { unit_label: string };
      if (b.unit_label === 'kg' && me.unit_label !== 'kg') {
        if (b.product_type !== 'bulk') {
          this.db.raw.prepare(`UPDATE products SET product_type = 'bulk', type_source = 'manual' WHERE id = ?`).run(bulkId);
          ensureBagPack(this.db.raw, bulkId);
        }
        this.db.raw.prepare(`UPDATE products SET product_type = 'packed', type_source = 'manual' WHERE id = ?`).run(productId);
      }
    });
    tx();
    return { ok: true as const, link: { bulkId, qtyEach: r3(q) } };
  }

  getLink(productId: string) {
    const r = this.db.raw
      .prepare(
        `SELECT p.repack_from_id AS bulk_id, b.name AS bulk_name, b.unit_label AS bulk_unit, p.size_qty AS qty_each,
                (SELECT COUNT(*) FROM products c WHERE c.repack_from_id = p.id AND c.active = 1) AS packets
         FROM products p LEFT JOIN products b ON b.id = p.repack_from_id WHERE p.id = ?`,
      )
      .get(productId) as { bulk_id: string | null; packets: number } | undefined;
    if (!r) return { ok: false as const, error: 'product_not_found' };
    return { ok: true as const, link: r };
  }

  /** Bulk items (have packets linked) with stock and their packets. */
  bulkItems() {
    const bulks = this.db.raw
      .prepare(
        `SELECT b.id, b.name, b.unit_label, b.last_unit_cost_paisa, b.product_type, COALESCE(s.qty_on_hand, 0) AS qty_on_hand
         FROM products b LEFT JOIN stock_balances s ON s.product_id = b.id
         WHERE b.active = 1 AND (b.product_type = 'bulk' OR EXISTS (SELECT 1 FROM products c WHERE c.repack_from_id = b.id AND c.active = 1))
         ORDER BY b.name COLLATE NOCASE`,
      )
      .all() as Array<{ id: string }>;
    return bulks.map((b) => ({ ...b, packets: this.packets(b.id) }));
  }

  private packets(bulkId: string) {
    return this.db.raw
      .prepare(
        `SELECT p.id, p.name, p.unit_label, p.size_qty AS qty_each, p.price_paisa, p.last_unit_cost_paisa, p.reorder_level, p.barcode,
                COALESCE(s.qty_on_hand, 0) AS qty_on_hand
         FROM products p LEFT JOIN stock_balances s ON s.product_id = p.id
         WHERE p.repack_from_id = ? AND p.active = 1 ORDER BY p.size_qty DESC, p.name COLLATE NOCASE`,
      )
      .all(bulkId);
  }

  // ---------- repack ----------
  create(input: {
    bulkId?: string;
    lines?: Array<{ productId?: string; packets?: unknown }>;
    bulkUsed?: unknown;
    /** Wastage in the bulk unit (kg); used = packets x kg each + wastage. */
    wastage?: unknown;
    packingCostRs?: unknown;
    packingCostPaisa?: unknown;
    /** Packing material per packet (bag, sticker). */
    packingPerPackRs?: unknown;
    packingPerPackPaisa?: unknown;
    bulkCostRs?: unknown;
    bulkCostPaisa?: unknown;
    note?: string | null;
    userId?: string;
  }) {
    const bulkId = String(input.bulkId ?? '');
    const bulk = this.db.raw
      .prepare(
        `SELECT b.id, b.name, b.unit_label, b.last_unit_cost_paisa, COALESCE(s.qty_on_hand, 0) AS on_hand
         FROM products b LEFT JOIN stock_balances s ON s.product_id = b.id WHERE b.id = ? AND b.active = 1`,
      )
      .get(bulkId) as { id: string; name: string; unit_label: string; last_unit_cost_paisa: number | null; on_hand: number } | undefined;
    if (!bulk) return { ok: false as const, error: 'product_not_found' };
    const packets = new Map(
      (this.packets(bulkId) as Array<{ id: string; name: string; unit_label: string; qty_each: number; last_unit_cost_paisa: number | null }>).map(
        (p) => [p.id, p],
      ),
    );
    const lines: Array<{ productId: string; name: string; packets: number; qtyEach: number; prev: number | null }> = [];
    for (const l of Array.isArray(input.lines) ? input.lines : []) {
      const n = Number(l.packets);
      if (!n) continue;
      const p = packets.get(String(l.productId ?? ''));
      if (!p) return { ok: false as const, error: 'product_not_found' };
      if (!Number.isFinite(n) || n < 0 || (!allowsFraction(p.unit_label) && !Number.isInteger(n))) return { ok: false as const, error: 'invalid_qty' };
      lines.push({ productId: p.id, name: p.name, packets: n, qtyEach: Number(p.qty_each), prev: p.last_unit_cost_paisa });
    }
    if (lines.length === 0) return { ok: false as const, error: 'repack_lines_required' };
    const needed = r3(lines.reduce((s, l) => s + l.packets * l.qtyEach, 0));
    let used = needed;
    if (input.wastage != null && input.wastage !== '') {
      const w = Number(input.wastage);
      if (!Number.isFinite(w) || w < 0 || w > 100000) return { ok: false as const, error: 'invalid_wastage' };
      used = r3(needed + r3(w));
    } else if (input.bulkUsed != null && input.bulkUsed !== '') {
      const u = Number(input.bulkUsed);
      if (!Number.isFinite(u) || u < needed - 0.0005) return { ok: false as const, error: 'bulk_used_too_low' };
      used = r3(u);
    }
    const wastage = r3(used - needed);
    // Hard block: stock never goes below zero (no override).
    if (used > r3(bulk.on_hand) + 0.0005) {
      return { ok: false as const, error: 'not_enough_bulk', on_hand: r3(bulk.on_hand), needed: used };
    }
    let bulkCost = bulk.last_unit_cost_paisa ?? 0;
    if (input.bulkCostPaisa != null || (input.bulkCostRs != null && input.bulkCostRs !== '')) {
      const c = parseMoneyPair(input.bulkCostPaisa, input.bulkCostRs, 'zero');
      if (!c.ok) return { ok: false as const, error: c.error };
      bulkCost = c.paisa;
    }
    if (!(bulkCost > 0)) return { ok: false as const, error: 'bulk_cost_required' };
    const packingTotal = parseMoneyPair(input.packingCostPaisa, input.packingCostRs, 'zero');
    if (!packingTotal.ok) return { ok: false as const, error: packingTotal.error };
    const packingPer = parseMoneyPair(input.packingPerPackPaisa, input.packingPerPackRs, 'zero');
    if (!packingPer.ok) return { ok: false as const, error: packingPer.error };
    const totalPackets = lines.reduce((s, l) => s + l.packets, 0);
    const packingPaisa = packingTotal.paisa + Math.round(packingPer.paisa * totalPackets);
    const totalCost = Math.round(used * bulkCost) + packingPaisa;
    const note = String(input.note ?? '').trim().slice(0, 240) || null;
    const id = randomUUID();
    const changes: CostChange[] = [];
    const n = (this.db.raw.prepare(`SELECT COUNT(*) AS n FROM repacks`).get() as { n: number }).n + 1;
    const shortId = `RP-${String(n).padStart(4, '0')}`;

    this.db.raw.transaction(() => {
      this.db.raw
        .prepare(
          `INSERT INTO repacks (id, short_id, bulk_product_id, bulk_qty_used, wastage_qty, bulk_unit_cost_paisa, packing_cost_paisa, packing_per_pack_paisa, note, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, shortId, bulkId, used, wastage, bulkCost, packingPaisa, packingPer.paisa || null, note, input.userId ?? null);
      this.bump(bulkId, -used);
      if (!(bulk.last_unit_cost_paisa! > 0)) {
        this.db.raw.prepare(`UPDATE products SET last_unit_cost_paisa = ? WHERE id = ?`).run(bulkCost, bulkId);
      }
      const ins = this.db.raw.prepare(
        `INSERT INTO repack_lines (id, repack_id, product_id, packets, qty_each, unit_cost_paisa, prev_cost_paisa) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const l of lines) {
        // Pack cost = bulk cost x kg each + wastage share (by kg) + packing per pack (+ any old-style packing total, by kg).
        const unitCost = Math.round(
          bulkCost * l.qtyEach + (wastage * bulkCost * l.qtyEach) / needed + packingPer.paisa + (packingTotal.paisa * l.qtyEach) / needed,
        );
        ins.run(randomUUID(), id, l.productId, l.packets, l.qtyEach, unitCost, l.prev);
        this.bump(l.productId, l.packets);
        this.db.raw.prepare(`UPDATE products SET last_unit_cost_paisa = ?, updated_at = datetime('now') WHERE id = ?`).run(unitCost, l.productId);
        changes.push({ productId: l.productId, costPaisa: unitCost, prevCostPaisa: l.prev });
      }
      this.audit('repack.create', input.userId, id, {
        name: `${shortId} · ${bulk.name} ${used}`,
        total_paisa: totalCost,
        note: lines.map((l) => `${l.name} ×${l.packets}`).join(', ') + (wastage > 0 ? ` · wastage ${wastage}` : ''),
      });
    })();
    const got = this.get(id);
    if (!got.ok) return got;
    return { ...got, price_check: suggestPrices(this.db.raw, changes, { onlyChanged: false }) };
  }

  private bump(productId: string, delta: number) {
    this.db.raw
      .prepare(
        `INSERT INTO stock_balances (product_id, qty_on_hand, updated_at) VALUES (?, MAX(0, ?), datetime('now'))
         ON CONFLICT(product_id) DO UPDATE SET qty_on_hand = MAX(0, ROUND(qty_on_hand + ?, 3)), updated_at = datetime('now')`,
      )
      .run(productId, delta, delta);
  }

  /** Bulk stock: kg in hand, kg sitting in packs by size, wastage (and repacked kg) in the period. */
  report(opts: { from?: string; to?: string }) {
    const where: string[] = ['r.voided_at IS NULL'];
    const args: string[] = [];
    if (opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from)) {
      where.push(`date(r.created_at, '+5 hours') >= ?`);
      args.push(opts.from);
    }
    if (opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to)) {
      where.push(`date(r.created_at, '+5 hours') <= ?`);
      args.push(opts.to);
    }
    const bulks = this.db.raw
      .prepare(
        `SELECT b.id, b.name, b.last_unit_cost_paisa AS cost_paisa, COALESCE(s.qty_on_hand, 0) AS kg_in_hand
         FROM products b LEFT JOIN stock_balances s ON s.product_id = b.id
         WHERE b.active = 1 AND b.product_type = 'bulk' ORDER BY b.name COLLATE NOCASE`,
      )
      .all() as Array<{ id: string; name: string; cost_paisa: number | null; kg_in_hand: number }>;
    const packsQ = this.db.raw.prepare(
      `SELECT p.id, p.name, p.size_qty AS kg_each, COALESCE(s.qty_on_hand, 0) AS packs
       FROM products p LEFT JOIN stock_balances s ON s.product_id = p.id
       WHERE p.repack_from_id = ? AND p.active = 1 AND p.size_qty > 0 ORDER BY p.size_qty`,
    );
    const wasteQ = this.db.raw.prepare(
      `SELECT COALESCE(SUM(r.wastage_qty), 0) AS kg, COALESCE(SUM(r.wastage_qty * r.bulk_unit_cost_paisa), 0) AS value,
              COALESCE(SUM(r.bulk_qty_used), 0) AS used, COUNT(*) AS n
       FROM repacks r WHERE r.bulk_product_id = ? AND ${where.join(' AND ')}`,
    );
    const items = bulks.map((b) => {
      const packs = (packsQ.all(b.id) as Array<{ id: string; name: string; kg_each: number; packs: number }>).map((p) => ({
        ...p,
        kg: r3(p.packs * p.kg_each),
      }));
      const w = wasteQ.get(b.id, ...args) as { kg: number; value: number; used: number; n: number };
      const kgInPacks = r3(packs.reduce((x, p) => x + p.kg, 0));
      return {
        ...b,
        kg_in_hand: r3(b.kg_in_hand),
        packs,
        kg_in_packs: kgInPacks,
        kg_total: r3(b.kg_in_hand + kgInPacks),
        stock_cost_paisa: Math.round(b.kg_in_hand * (b.cost_paisa ?? 0)),
        repacked_kg: r3(w.used - w.kg),
        repacks: w.n,
        wastage_kg: r3(w.kg),
        wastage_cost_paisa: Math.round(w.value),
      };
    });
    const sum = (k: 'kg_in_hand' | 'kg_in_packs' | 'wastage_kg' | 'repacked_kg') => r3(items.reduce((x, i) => x + i[k], 0));
    return {
      items,
      totals: {
        kg_in_hand: sum('kg_in_hand'),
        kg_in_packs: sum('kg_in_packs'),
        repacked_kg: sum('repacked_kg'),
        wastage_kg: sum('wastage_kg'),
        wastage_cost_paisa: items.reduce((x, i) => x + i.wastage_cost_paisa, 0),
        stock_cost_paisa: items.reduce((x, i) => x + i.stock_cost_paisa, 0),
      },
    };
  }

  list(opts: { from?: string; to?: string }) {
    const where: string[] = [];
    const args: string[] = [];
    if (opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from)) {
      where.push(`date(r.created_at, '+5 hours') >= ?`);
      args.push(opts.from);
    }
    if (opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to)) {
      where.push(`date(r.created_at, '+5 hours') <= ?`);
      args.push(opts.to);
    }
    const rows = this.db.raw
      .prepare(
        `SELECT r.id, r.short_id, r.bulk_product_id, p.name AS bulk_name, p.unit_label AS bulk_unit, r.bulk_qty_used, r.wastage_qty,
                r.bulk_unit_cost_paisa, r.packing_cost_paisa, r.packing_per_pack_paisa, r.note, r.created_at, r.voided_at, u.display_name AS user_name,
                (SELECT COALESCE(SUM(l.packets), 0) FROM repack_lines l WHERE l.repack_id = r.id) AS packets,
                (SELECT GROUP_CONCAT(lp.name || ' ×' || l.packets, ', ') FROM repack_lines l JOIN products lp ON lp.id = l.product_id WHERE l.repack_id = r.id) AS made
         FROM repacks r JOIN products p ON p.id = r.bulk_product_id LEFT JOIN users u ON u.id = r.created_by
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY r.created_at DESC LIMIT 500`,
      )
      .all(...args) as Array<Record<string, number | string | null>>;
    return rows.map((r) => ({
      ...r,
      total_cost_paisa: Math.round(Number(r.bulk_qty_used) * Number(r.bulk_unit_cost_paisa)) + Number(r.packing_cost_paisa),
      wastage_value_paisa: Math.round(Number(r.wastage_qty) * Number(r.bulk_unit_cost_paisa)),
    }));
  }

  get(id: string) {
    const head = this.list({}).find((r) => (r as { id?: unknown }).id === id);
    if (!head) return { ok: false as const, error: 'repack_not_found' };
    const lines = this.db.raw
      .prepare(
        `SELECT l.id, l.product_id, p.name AS product_name, l.packets, l.qty_each, l.unit_cost_paisa, p.price_paisa, p.barcode, p.unit_label
         FROM repack_lines l JOIN products p ON p.id = l.product_id WHERE l.repack_id = ? ORDER BY l.qty_each DESC`,
      )
      .all(id);
    return { ok: true as const, repack: head, lines };
  }

  /** Same day, owner, packets still on the shelf. */
  undo(id: string, userId?: string): { ok: true } | Fail {
    const r = this.db.raw.prepare(`SELECT * FROM repacks WHERE id = ?`).get(id) as
      | { id: string; short_id: string; bulk_product_id: string; bulk_qty_used: number; created_at: string; voided_at: string | null }
      | undefined;
    if (!r) return { ok: false, error: 'repack_not_found' };
    if (r.voided_at) return { ok: false, error: 'repack_already_undone' };
    const day = karachiYmd(new Date(`${r.created_at.replace(' ', 'T')}Z`));
    if (day !== karachiYmd()) return { ok: false, error: 'repack_undo_same_day' };
    const lines = this.db.raw
      .prepare(
        `SELECT l.product_id, l.packets, l.unit_cost_paisa, l.prev_cost_paisa, COALESCE(s.qty_on_hand, 0) AS on_hand, p.last_unit_cost_paisa
         FROM repack_lines l JOIN products p ON p.id = l.product_id LEFT JOIN stock_balances s ON s.product_id = l.product_id
         WHERE l.repack_id = ?`,
      )
      .all(id) as Array<{ product_id: string; packets: number; unit_cost_paisa: number; prev_cost_paisa: number | null; on_hand: number; last_unit_cost_paisa: number | null }>;
    if (lines.some((l) => l.on_hand + 0.0005 < l.packets)) return { ok: false, error: 'repack_packets_sold' };
    try {
      this.db.raw.transaction(() => {
        for (const l of lines) {
          this.bump(l.product_id, -l.packets);
          if (l.last_unit_cost_paisa === l.unit_cost_paisa && l.prev_cost_paisa != null) {
            this.db.raw.prepare(`UPDATE products SET last_unit_cost_paisa = ? WHERE id = ?`).run(l.prev_cost_paisa, l.product_id);
          }
        }
        this.bump(r.bulk_product_id, r.bulk_qty_used);
        const ch = this.db.raw
          .prepare(`UPDATE repacks SET voided_at = datetime('now'), voided_by = ? WHERE id = ? AND voided_at IS NULL`)
          .run(userId ?? null, id);
        if (ch.changes !== 1) throw new Abort('repack_already_undone');
        this.audit('repack.undo', userId, id, { name: r.short_id });
      })();
    } catch (e) {
      if (e instanceof Abort) return { ok: false, error: e.code };
      throw e;
    }
    return { ok: true };
  }
}
