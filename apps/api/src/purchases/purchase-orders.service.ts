import { suggestPrices, type CostChange } from '../pricing/pricing';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { allowsFraction, parseQty } from '../common/qty';
import { parseMoneyPair } from '../common/amount';
import { NO_SUPPLIER_ID } from '../suppliers/system-supplier';
import { lastPackFor, PurchasesService, resolvePack, type PurchaseLineInput } from './purchases.service';
import { effectiveBuyUnit, packNameFor } from '../catalog/buy-units';
import { CONTAINER_NAME, defaultMeasure, FIXED_UNITS, isContainer, isMeasure, lineMeasure, measureFromPackName, measuresFor, type Measure } from '../catalog/measures';

export type PoStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';

export type PoRow = {
  id: string;
  number: number;
  supplier_id: string;
  supplier_name: string;
  supplier_phone: string | null;
  status: PoStatus;
  note: string | null;
  sent_at: string | null;
  closed_at: string | null;
  created_at: string;
  line_count: number;
  expected_paisa: number;
};

export type PoLineRow = {
  id: string;
  product_id: string;
  product_name: string;
  unit_label: string;
  qty_ordered: number;
  qty_received: number;
  expected_cost_paisa: number | null;
  last_unit_cost_paisa: number | null;
  price_paisa: number;
  active: number;
  pack_id: string | null;
  pack_name: string | null;
  pack_units: number | null;
  pack_qty: number | null;
  /** 1 = counts cartons / crates (qty_ordered and qty_received are packages). */
  by_package: number;
  /** kg | carton | crate | piece */
  buy_unit: string | null;
  /** What the line is ordered in (kg, carton, bottle …). */
  unit: string | null;
  product_type: string;
  /** Units per package and package cost from the last bill (prefill on receive). */
  last_pack_units: number | null;
  last_pack_cost_paisa: number | null;
};

type Fail = { ok: false; error: string };
type LineIn = { productId?: unknown; unit?: unknown; qty?: unknown; packages?: unknown; expectedCostPaisa?: unknown; expectedCostRs?: unknown; packId?: string | null; packQty?: unknown; packUnits?: unknown; packCostRs?: unknown; packCostPaisa?: unknown };
type ParsedLine = {
  productId: string;
  qty: number;
  cost: number | null;
  pack: { id: string | null; name: string; units: number | null; qty: number } | null;
  byPackage: boolean;
  unit: Measure;
};

const MAX_LINES = 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
class Abort extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly db: DbService,
    private readonly purchases: PurchasesService,
  ) {}

  private audit(action: string, userId: string | undefined, orderId: string, payload: Record<string, unknown>) {
    const store = this.db.raw.prepare(`SELECT id FROM store LIMIT 1`).get() as { id: string } | undefined;
    this.db.raw
      .prepare(
        `INSERT INTO audit_log (id, action, user_id, store_id, subject_type, subject_id, payload_json)
         VALUES (?, ?, ?, ?, 'purchase_order', ?, ?)`,
      )
      .run(randomUUID(), action, userId ?? null, store?.id ?? null, orderId, JSON.stringify(payload));
  }

  private head(id: string): PoRow | undefined {
    return this.db.raw
      .prepare(
        `SELECT o.id, o.number, o.supplier_id, s.name AS supplier_name, s.phone AS supplier_phone, o.status,
                o.note, o.sent_at, o.closed_at, o.created_at,
                (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.order_id = o.id) AS line_count,
                (SELECT COALESCE(SUM(ROUND(CASE WHEN l.by_package = 1 THEN l.qty_ordered * COALESCE(l.pack_units, 0) ELSE l.qty_ordered END
                                          * COALESCE(l.expected_cost_paisa, p.last_unit_cost_paisa, 0))), 0)
                   FROM purchase_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = o.id) AS expected_paisa
         FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = ?`,
      )
      .get(id) as PoRow | undefined;
  }

  list(status?: string): PoRow[] {
    const ok = ['draft', 'sent', 'partial', 'received', 'cancelled', 'open'];
    const st = status && ok.includes(status) ? status : null;
    const where = !st ? '' : st === 'open' ? `WHERE o.status IN ('draft','sent','partial')` : `WHERE o.status = ?`;
    const args = st && st !== 'open' ? [st] : [];
    return this.db.raw
      .prepare(
        `SELECT o.id FROM purchase_orders o ${where} ORDER BY o.number DESC LIMIT 500`,
      )
      .all(...args)
      .map((r: unknown) => this.head((r as { id: string }).id)!)
      .filter(Boolean);
  }

  get(id: string): { ok: true; order: PoRow; lines: PoLineRow[]; bills: unknown[] } | Fail {
    const order = this.head(id);
    if (!order) return { ok: false, error: 'order_not_found' };
    const lines = this.db.raw
      .prepare(
        `SELECT l.id, l.product_id, p.name AS product_name, p.unit_label, l.qty_ordered, l.qty_received,
                l.expected_cost_paisa, p.last_unit_cost_paisa, p.price_paisa, p.fixed_price, p.active,
                l.pack_id, l.pack_name, l.pack_units, l.pack_qty, l.by_package, p.buy_unit, p.product_type, l.unit
         FROM purchase_order_lines l JOIN products p ON p.id = l.product_id
         WHERE l.order_id = ? ORDER BY l.sort, p.name COLLATE NOCASE`,
      )
      .all(id) as PoLineRow[];
    for (const l of lines) {
      l.buy_unit = effectiveBuyUnit(l);
      l.unit = lineMeasure(l);
      const pkName = l.by_package === 1 ? l.pack_name ?? CONTAINER_NAME[l.unit as Measure] ?? 'Carton' : null;
      const last = pkName ? lastPackFor(this.db.raw, order.supplier_id, l.product_id, pkName) : null;
      l.last_pack_units = last?.units ?? null;
      l.last_pack_cost_paisa = last?.pack_cost_paisa ?? null;
    }
    const bills = this.db.raw
      .prepare(
        `SELECT id, total_paisa, paid_paisa, due_paisa, purchased_on, created_at
         FROM purchase_invoices WHERE purchase_order_id = ? ORDER BY created_at`,
      )
      .all(id);
    return { ok: true, order, lines: lines.map((l) => ({ ...l, qty_received: r3(l.qty_received) })), bills };
  }

  private parseLines(raw: unknown): { ok: true; lines: ParsedLine[] } | Fail {
    const arr = Array.isArray(raw) ? (raw as LineIn[]) : [];
    if (arr.length < 1 || arr.length > MAX_LINES) return { ok: false, error: 'purchase_lines_required' };
    const out: ParsedLine[] = [];
    const seen = new Set<string>();
    for (const l of arr) {
      const productId = String(l.productId ?? '').trim();
      const p = this.db.raw.prepare(`SELECT unit_label, product_type, buy_unit FROM products WHERE id = ? AND active = 1`).get(productId) as
        | { unit_label: string | null; product_type: string; buy_unit: string | null }
        | undefined;
      if (!p) return { ok: false, error: 'product_not_found' };
      let pack: ParsedLine['pack'] = null;
      let qn: number;
      let cost: number | null = null;
      let unit: Measure | null = null;
      if (l.unit != null && l.unit !== '') {
        const m = String(l.unit).toLowerCase();
        if (!isMeasure(m) || !measuresFor(p).includes(m)) return { ok: false, error: 'invalid_buy_measure' };
        unit = m;
        if (isContainer(m) && !l.packId) {
          const n = Number(l.packages ?? l.qty);
          if (!Number.isInteger(n) || n <= 0 || n > 100000) return { ok: false, error: 'invalid_qty' };
          const name = CONTAINER_NAME[m]!;
          const given = Number(l.packUnits);
          const units = FIXED_UNITS[m] ?? (Number.isFinite(given) && given > 0 ? r3(given) : lastPackFor(this.db.raw, null, productId, name)?.units ?? null);
          if (l.expectedCostPaisa != null || l.expectedCostRs != null) {
            const c = parseMoneyPair(l.expectedCostPaisa, l.expectedCostRs, 'zero');
            if (!c.ok) return { ok: false, error: c.error };
            cost = c.paisa;
          }
          if (seen.has(productId)) {
            const prev = out.find((x) => x.productId === productId)!;
            if (!prev.byPackage || prev.unit !== m) return { ok: false, error: 'invalid_qty' };
            prev.qty += n;
            prev.pack!.qty += n;
            continue;
          }
          seen.add(productId);
          out.push({ productId, qty: n, cost, pack: { id: null, name, units, qty: n }, byPackage: true, unit: m });
          continue;
        }
        if (!isContainer(m) && (l.packId || (l.packages != null && l.packages !== ''))) return { ok: false, error: 'invalid_buy_measure' };
        if (m === 'gram') {
          const g = Number(l.qty);
          if (!Number.isFinite(g) || g <= 0) return { ok: false, error: 'invalid_qty' };
          l.qty = Math.round(g) / 1000;
          // expected cost stays per kg
        }
      }
      if (l.packages != null && l.packages !== '' && !l.packId) {
        // cartons / crates: only the count now; units per package come on receive
        const bu = effectiveBuyUnit(p);
        if (bu === 'kg') return { ok: false, error: 'bulk_buys_by_kg' };
        const n = Number(l.packages);
        if (!Number.isInteger(n) || n <= 0 || n > 100000) return { ok: false, error: 'invalid_qty' };
        const name = packNameFor(bu === 'crate' ? 'crate' : 'carton');
        const last = lastPackFor(this.db.raw, null, productId, name);
        if (l.expectedCostPaisa != null || l.expectedCostRs != null) {
          const c = parseMoneyPair(l.expectedCostPaisa, l.expectedCostRs, 'zero');
          if (!c.ok) return { ok: false, error: c.error };
          cost = c.paisa;
        }
        if (seen.has(productId)) {
          const prev = out.find((x) => x.productId === productId)!;
          if (!prev.byPackage) return { ok: false, error: 'invalid_qty' };
          prev.qty += n;
          prev.pack!.qty += n;
          continue;
        }
        seen.add(productId);
        out.push({ productId, qty: n, cost, pack: { id: null, name, units: last?.units ?? null, qty: n }, byPackage: true, unit: measureFromPackName(name) ?? 'carton' });
        continue;
      }
      if (l.packId) {
        const rp = resolvePack(this.db.raw, productId, { ...l, packCostPaisa: l.packCostPaisa ?? 0 });
        if (!rp.ok) return rp;
        pack = { id: rp.pack.packId, name: rp.pack.name, units: rp.pack.units, qty: rp.pack.qty };
        qn = r3(rp.pack.qty * rp.pack.units);
        if (rp.pack.costPaisa > 0) cost = Math.round(rp.pack.costPaisa / rp.pack.units);
      } else {
        const q = parseQty(l.qty, 'kg');
        if (!q.ok || q.n <= 0) return { ok: false, error: 'invalid_qty' };
        qn = q.n;
      }
      if (!allowsFraction(p.unit_label) && !Number.isInteger(qn)) return { ok: false, error: 'invalid_qty' };
      if (cost == null && (l.expectedCostPaisa != null || l.expectedCostRs != null)) {
        const c = parseMoneyPair(l.expectedCostPaisa, l.expectedCostRs, 'zero');
        if (!c.ok) return { ok: false, error: c.error };
        cost = c.paisa;
      }
      if (seen.has(productId)) {
        const prev = out.find((x) => x.productId === productId)!;
        if (prev.byPackage) return { ok: false, error: 'invalid_qty' };
        if (unit && prev.unit !== unit) return { ok: false, error: 'invalid_qty' };
        prev.qty = r3(prev.qty + qn);
        if (prev.pack && pack && prev.pack.id === pack.id && prev.pack.units === pack.units) prev.pack.qty += pack.qty;
        else prev.pack = null;
        continue;
      }
      seen.add(productId);
      out.push({ productId, qty: qn, cost, pack, byPackage: false, unit: unit ?? (pack ? measureFromPackName(pack.name) ?? 'pack' : lineMeasure({ unit_label: p.unit_label })) });
    }
    return { ok: true, lines: out };
  }

  private supplierOk(id: string): boolean {
    return !!this.db.raw.prepare(`SELECT 1 FROM suppliers WHERE id = ? AND active = 1`).get(id);
  }

  private insertOrder(supplierId: string, lines: ParsedLine[], note: string | null, userId?: string): string {
    const id = randomUUID();
    const next = (this.db.raw.prepare(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM purchase_orders`).get() as { n: number }).n;
    this.db.raw
      .prepare(`INSERT INTO purchase_orders (id, number, supplier_id, status, note, created_by) VALUES (?, ?, ?, 'draft', ?, ?)`)
      .run(id, next, supplierId, note, userId ?? null);
    const ins = this.db.raw.prepare(
      `INSERT INTO purchase_order_lines (id, order_id, product_id, qty_ordered, expected_cost_paisa, sort, pack_id, pack_name, pack_units, pack_qty, by_package, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    lines.forEach((l, i) => ins.run(randomUUID(), id, l.productId, l.qty, l.cost, i, l.pack?.id ?? null, l.pack?.name ?? null, l.pack?.units ?? null, l.pack?.qty ?? null, l.byPackage ? 1 : 0, l.unit));
    this.audit('purchase_order.create', userId, id, { name: `PO-${String(next).padStart(4, '0')}`, qty: lines.length });
    return id;
  }

  create(input: { supplierId?: string; lines?: unknown; note?: string | null; userId?: string }) {
    const supplierId = String(input.supplierId ?? '').trim();
    if (!supplierId || !this.supplierOk(supplierId)) return { ok: false as const, error: 'supplier_not_found' };
    const parsed = this.parseLines(input.lines);
    if (!parsed.ok) return parsed;
    const note = String(input.note ?? '').trim().slice(0, 240) || null;
    const id = this.db.raw.transaction(() => this.insertOrder(supplierId, parsed.lines, note, input.userId))();
    return this.get(id);
  }

  update(id: string, input: { supplierId?: string; lines?: unknown; note?: string | null; userId?: string }) {
    const o = this.head(id);
    if (!o) return { ok: false as const, error: 'order_not_found' };
    if (o.status !== 'draft' && o.status !== 'sent') return { ok: false as const, error: 'order_locked' };
    const supplierId = String(input.supplierId ?? o.supplier_id).trim();
    if (!this.supplierOk(supplierId)) return { ok: false as const, error: 'supplier_not_found' };
    const parsed = this.parseLines(input.lines);
    if (!parsed.ok) return parsed;
    const note = input.note === undefined ? o.note : String(input.note ?? '').trim().slice(0, 240) || null;
    this.db.raw.transaction(() => {
      this.db.raw
        .prepare(`UPDATE purchase_orders SET supplier_id = ?, note = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(supplierId, note, id);
      this.db.raw.prepare(`DELETE FROM purchase_order_lines WHERE order_id = ?`).run(id);
      const ins = this.db.raw.prepare(
        `INSERT INTO purchase_order_lines (id, order_id, product_id, qty_ordered, expected_cost_paisa, sort, pack_id, pack_name, pack_units, pack_qty, by_package, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      parsed.lines.forEach((l, i) => ins.run(randomUUID(), id, l.productId, l.qty, l.cost, i, l.pack?.id ?? null, l.pack?.name ?? null, l.pack?.units ?? null, l.pack?.qty ?? null, l.byPackage ? 1 : 0, l.unit));
      this.audit('purchase_order.edit', input.userId, id, { name: `PO-${String(o.number).padStart(4, '0')}`, qty: parsed.lines.length });
    })();
    return this.get(id);
  }

  /**
   * Low-stock items grouped by the supplier they were last bought from. Packets that bulk can cover are left out
   * (repack instead); packets it can't cover are bought as kg of their loose source, never as packets.
   */
  suggest() {
    const cols = `SELECT p.id, p.name, p.unit_label, p.reorder_level, p.last_unit_cost_paisa, p.repack_from_id, p.size_qty, p.product_type, p.buy_unit, p.buy_measure,
                COALESCE(s.qty_on_hand, 0) AS qty_on_hand,
                (SELECT COALESCE(bs.qty_on_hand, 0) FROM stock_balances bs WHERE bs.product_id = p.repack_from_id) AS bulk_on_hand,
                (SELECT r.supplier_id FROM stock_receives r JOIN suppliers su ON su.id = r.supplier_id AND su.active = 1
                  WHERE r.product_id = p.id AND r.supplier_id IS NOT NULL ORDER BY r.rowid DESC LIMIT 1) AS supplier_id,
                (SELECT COALESCE(SUM(CASE WHEN ol.by_package = 1 THEN MAX(0, ol.qty_ordered - ol.qty_received) * COALESCE(ol.pack_units, 1)
                                          ELSE ol.qty_ordered - ol.qty_received END), 0) FROM purchase_order_lines ol
                   JOIN purchase_orders o ON o.id = ol.order_id AND o.status IN ('draft','sent','partial')
                  WHERE ol.product_id = p.id) AS on_order
         FROM products p LEFT JOIN stock_balances s ON s.product_id = p.id`;
    type Row = {
      id: string; name: string; unit_label: string; reorder_level: number | null; last_unit_cost_paisa: number | null;
      repack_from_id: string | null; size_qty: number | null; bulk_on_hand: number | null; product_type: string; buy_unit: string | null; buy_measure: string | null;
      qty_on_hand: number; supplier_id: string | null; on_order: number;
    };
    const rows = this.db.raw
      .prepare(`${cols} WHERE p.active = 1 AND p.reorder_level IS NOT NULL AND COALESCE(s.qty_on_hand, 0) <= p.reorder_level ORDER BY p.name COLLATE NOCASE`)
      .all() as Row[];
    const byId = this.db.raw.prepare(`${cols} WHERE p.id = ? AND p.active = 1 AND p.product_type = 'bulk'`);
    const names = new Map(
      (this.db.raw.prepare(`SELECT id, name, phone FROM suppliers`).all() as Array<{ id: string; name: string; phone: string | null }>).map(
        (s) => [s.id, s],
      ),
    );
    const groups = new Map<string, { supplier_id: string; supplier_name: string; supplier_phone: string | null; items: unknown[] }>();
    const want = (r: Row) => {
      const raw = Math.max(0, Number(r.reorder_level) * 2 - Number(r.qty_on_hand) - Number(r.on_order));
      return allowsFraction(r.unit_label) ? r3(raw) : Math.ceil(raw);
    };
    // packets short -> kg of their loose source
    const kgFor = new Map<string, { kg: number; from: Array<{ name: string; packets: number }> }>();
    for (const r of rows) {
      if (r.product_type !== 'packed') continue;
      const packets = want(r);
      if (!(packets > 0) || !r.repack_from_id || !r.size_qty) continue;
      if (Number(r.bulk_on_hand ?? 0) >= Number(r.size_qty)) continue; // repack instead
      const e = kgFor.get(r.repack_from_id) ?? { kg: 0, from: [] };
      e.kg = r3(e.kg + packets * Number(r.size_qty));
      e.from.push({ name: r.name, packets });
      kgFor.set(r.repack_from_id, e);
    }
    const push = (r: Row, qty0: number, from: Array<{ name: string; packets: number }>) => {
      let qty = qty0;
      const sid = r.supplier_id ?? NO_SUPPLIER_ID;
      const bu = effectiveBuyUnit(r);
      const unit = defaultMeasure(r);
      let pack: { id: string | null; name: string; units: number | null } | null = null;
      let packQty: number | null = null;
      let byPackage = false;
      if (isContainer(unit) && unit !== 'bag') {
        const name = CONTAINER_NAME[unit]!;
        const last = FIXED_UNITS[unit] ? { units: FIXED_UNITS[unit]! } : lastPackFor(this.db.raw, sid, r.id, name);
        pack = { id: null, name, units: last?.units ?? null };
        packQty = Math.max(1, Math.ceil(qty / (last?.units ?? qty) - 1e-9));
        if (last?.units) qty = r3(packQty * last.units);
        byPackage = true;
      }
      const sup = names.get(sid);
      if (!groups.has(sid)) groups.set(sid, { supplier_id: sid, supplier_name: sup?.name ?? 'No supplier', supplier_phone: sup?.phone ?? null, items: [] });
      groups.get(sid)!.items.push({
        product_id: r.id,
        product_name: r.name,
        unit_label: r.unit_label,
        qty_on_hand: r3(r.qty_on_hand),
        reorder_level: r.reorder_level,
        on_order: r3(r.on_order),
        suggested_qty: qty,
        pack_id: pack?.id ?? null,
        pack_name: pack?.name ?? null,
        pack_units: pack?.units ?? null,
        pack_qty: packQty,
        by_package: byPackage,
        buy_unit: bu,
        unit: byPackage ? unit : unit === 'bag' || unit === 'gram' ? 'kg' : isContainer(unit) ? lineMeasure({ unit_label: r.unit_label }) : unit,
        last_unit_cost_paisa: r.last_unit_cost_paisa,
        for_packets: from,
      });
    };
    for (const r of rows) {
      // packed-from items are restocked as kg of their loose source (above)
      if (r.product_type === 'packed' && r.repack_from_id && r.size_qty) continue;
      const extra = kgFor.get(r.id);
      kgFor.delete(r.id);
      const qty = r3(want(r) + (extra?.kg ?? 0));
      if (!(qty > 0)) continue;
      // Bulk on hand can make one packet or more: repack, don't buy.
      if (r.repack_from_id && r.size_qty && Number(r.bulk_on_hand ?? 0) >= Number(r.size_qty)) continue;
      push(r, qty, extra?.from ?? []);
    }
    // loose sources that aren't low themselves but can't cover their packets
    for (const [bulkId, e] of kgFor) {
      const b = byId.get(bulkId) as Row | undefined;
      if (!b) continue;
      const qty = r3(e.kg - Math.max(0, Number(b.qty_on_hand)) - Math.max(0, Number(b.on_order)));
      if (qty > 0) push(b, qty, e.from);
    }
    for (const g of groups.values()) (g.items as Array<{ product_name: string }>).sort((x, y) => x.product_name.localeCompare(y.product_name));
    return [...groups.values()].sort((a, b) =>
      a.supplier_id === NO_SUPPLIER_ID ? 1 : b.supplier_id === NO_SUPPLIER_ID ? -1 : a.supplier_name.localeCompare(b.supplier_name),
    );
  }

  /** Per product: what it is bought in (last used with this supplier, else its "bought by") and pcs per container. */
  buyInfo(supplierId: string, ids: string[]) {
    type Info = {
      buy_unit: string | null; pack_name: string | null; last_pack_units: number | null; last_pack_cost_paisa: number | null;
      buy_measure: Measure; last_unit: Measure | null; units: Measure[]; pack_units: Record<string, number>;
    };
    const out: Record<string, Info> = {};
    const q = this.db.raw.prepare(`SELECT product_type, buy_unit, buy_measure, unit_label FROM products WHERE id = ?`);
    const lastUnit = this.db.raw.prepare(
      `SELECT pl.unit FROM purchase_lines pl JOIN purchase_invoices i ON i.id = pl.invoice_id
       WHERE pl.product_id = ? AND pl.unit IS NOT NULL ORDER BY (i.supplier_id = ?) DESC, i.created_at DESC, pl.rowid DESC LIMIT 1`,
    );
    for (const id of ids) {
      const p = q.get(id) as { product_type: string; buy_unit: string | null; buy_measure: string | null; unit_label: string } | undefined;
      if (!p) continue;
      const units = measuresFor(p);
      const lu = (lastUnit.get(id, supplierId || null) as { unit: string } | undefined)?.unit;
      const last_unit = isMeasure(lu) && units.includes(lu) ? lu : null;
      const buy_measure = defaultMeasure(p);
      const pack_units: Record<string, number> = {};
      let cost: number | null = null;
      for (const m of units) {
        if (!isContainer(m)) continue;
        const name = CONTAINER_NAME[m]!;
        const fixed = FIXED_UNITS[m];
        const last = fixed ? null : lastPackFor(this.db.raw, supplierId || null, id, name);
        if (fixed || last?.units) pack_units[m] = fixed ?? last!.units;
        if (m === (last_unit ?? buy_measure)) cost = last?.pack_cost_paisa ?? null;
      }
      const use = last_unit ?? buy_measure;
      const name = isContainer(use) ? CONTAINER_NAME[use]! : null;
      out[id] = {
        buy_unit: effectiveBuyUnit(p),
        pack_name: name,
        last_pack_units: name ? pack_units[use] ?? null : null,
        last_pack_cost_paisa: name ? cost : null,
        buy_measure,
        last_unit,
        units,
        pack_units,
      };
    }
    return out;
  }

  /** Pack last used with this supplier, else the product's first pack. */
  packFor(supplierId: string, productId: string): { id: string; name: string; units: number } | null {
    const remembered = this.db.raw
      .prepare(
        `SELECT pp.id, pp.name, COALESCE(sp.pack_units, pp.units) AS units FROM supplier_product_pack sp
         JOIN product_packs pp ON pp.id = sp.pack_id AND pp.active = 1
         WHERE sp.supplier_id = ? AND sp.product_id = ?`,
      )
      .get(supplierId, productId) as { id: string; name: string; units: number } | undefined;
    if (remembered) return remembered;
    const had = this.db.raw.prepare(`SELECT 1 FROM supplier_product_pack WHERE supplier_id = ? AND product_id = ? AND pack_id IS NULL`).get(supplierId, productId);
    if (had) return null;
    return (
      (this.db.raw
        .prepare(`SELECT id, name, units FROM product_packs WHERE product_id = ? AND active = 1 ORDER BY sort, created_at LIMIT 1`)
        .get(productId) as { id: string; name: string; units: number } | undefined) ?? null
    );
  }

  fromLowStock(input: { groups?: unknown; userId?: string }) {
    const groups = Array.isArray(input.groups) ? (input.groups as Array<{ supplierId?: string; lines?: unknown }>) : [];
    if (groups.length < 1) return { ok: false as const, error: 'purchase_lines_required' };
    const prepared: Array<{ supplierId: string; lines: ParsedLine[] }> = [];
    for (const g of groups) {
      const sid = String(g.supplierId ?? '').trim();
      if (!sid || !this.supplierOk(sid)) return { ok: false as const, error: 'supplier_not_found' };
      const parsed = this.parseLines(g.lines);
      if (!parsed.ok) return parsed;
      prepared.push({ supplierId: sid, lines: parsed.lines });
    }
    const ids = this.db.raw.transaction(() => prepared.map((g) => this.insertOrder(g.supplierId, g.lines, null, input.userId)))();
    return { ok: true as const, orders: ids.map((id: string) => this.head(id)) };
  }

  markSent(id: string, userId?: string) {
    const o = this.head(id);
    if (!o) return { ok: false as const, error: 'order_not_found' };
    if (o.status === 'received' || o.status === 'cancelled') return { ok: false as const, error: 'order_locked' };
    this.db.raw.transaction(() => {
      this.db.raw
        .prepare(
          `UPDATE purchase_orders SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
                  sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        )
        .run(id);
      this.audit('purchase_order.send', userId, id, { name: `PO-${String(o.number).padStart(4, '0')} · ${o.supplier_name}` });
    })();
    return this.get(id);
  }

  cancel(id: string, userId?: string) {
    const o = this.head(id);
    if (!o) return { ok: false as const, error: 'order_not_found' };
    if (o.status === 'received' || o.status === 'cancelled') return { ok: false as const, error: 'order_locked' };
    this.db.raw.transaction(() => {
      this.db.raw
        .prepare(`UPDATE purchase_orders SET status = 'cancelled', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(id);
      this.audit('purchase_order.cancel', userId, id, { name: `PO-${String(o.number).padStart(4, '0')} · ${o.supplier_name}` });
    })();
    return this.get(id);
  }

  /**
   * Receive goods against an order: one purchase bill (same logic as New bill), stock up,
   * received qty on the order lines, optional new sale prices. close=true marks it Received.
   */
  receive(
    id: string,
    input: {
      lines?: Array<{
        orderLineId?: string | null;
        productId?: string;
        qty?: unknown;
        unitCostRs?: unknown;
        unitCostPaisa?: unknown;
        expiryDate?: unknown;
        batchNo?: unknown;
        newPriceRs?: unknown;
        newPricePaisa?: unknown;
        packId?: string | null;
        packQty?: unknown;
        packUnits?: unknown;
        packCostRs?: unknown;
        packCostPaisa?: unknown;
        lineTotalRs?: unknown;
        lineTotalPaisa?: unknown;
        packages?: unknown;
        packName?: unknown;
        unit?: unknown;
      }>;
      discountRs?: unknown;
      discountPaisa?: unknown;
      paidRs?: unknown;
      paidPaisa?: unknown;
      purchasedOn?: string;
      note?: string | null;
      extras?: unknown;
      close?: boolean;
      userId?: string;
      canSetPrice?: boolean;
    },
  ) {
    const o = this.head(id);
    if (!o) return { ok: false as const, error: 'order_not_found' };
    if (o.status === 'received' || o.status === 'cancelled') return { ok: false as const, error: 'order_locked' };
    const orderLines = new Map(
      (this.db.raw.prepare(`SELECT id, product_id, by_package, pack_name FROM purchase_order_lines WHERE order_id = ?`).all(id) as Array<{
        id: string; product_id: string; by_package: number; pack_name: string | null;
      }>).map(
        (l) => [l.id, l],
      ),
    );
    const raw = Array.isArray(input.lines) ? input.lines : [];
    const lines: PurchaseLineInput[] = [];
    const bumps: Array<{ orderLineId: string; qty: number }> = [];
    const prices: Array<{ productId: string; paisa: number }> = [];
    for (const l0 of raw) {
      const l = { ...l0 };
      const um = l.unit != null && l.unit !== '' ? String(l.unit).toLowerCase() : null;
      if (um && !isMeasure(um)) return { ok: false as const, error: 'invalid_buy_measure' };
      if (um && isContainer(um) && !l.packId) {
        if (l.packages == null || l.packages === '') l.packages = l.qty;
        const fixed = FIXED_UNITS[um as Measure];
        if (fixed) l.packUnits = fixed;
        l.packName = CONTAINER_NAME[um as Measure];
      }
      let q = Number(l.qty);
      // grams on the bill; stock and the order count kg
      if (um === 'gram') q = Math.round(q) / 1000;
      let packagesIn: number | null = null;
      if (l.packages != null && l.packages !== '' && !l.packId) {
        const n = Number(l.packages);
        const u = Number(l.packUnits);
        if (!Number.isInteger(n) || n < 0) return { ok: false as const, error: 'invalid_qty' };
        if (n === 0) continue;
        if (!Number.isFinite(u) || u <= 0) return { ok: false as const, error: 'pack_units_required' };
        packagesIn = n;
        q = r3(n * u);
        const ol = l.orderLineId ? orderLines.get(String(l.orderLineId)) : undefined;
        if (ol?.pack_name && l.packName == null) l.packName = ol.pack_name;
      } else if (l.packId) {
        const pid = l.orderLineId ? orderLines.get(String(l.orderLineId))?.product_id ?? '' : String(l.productId ?? '');
        const rp = resolvePack(this.db.raw, pid, l);
        if (!rp.ok) return { ok: false as const, error: rp.error };
        q = r3(rp.pack.qty * rp.pack.units);
      }
      if (!Number.isFinite(q) || q < 0) return { ok: false as const, error: 'invalid_qty' };
      if (q === 0) continue;
      let productId = String(l.productId ?? '').trim();
      let orderLineId: string | null = null;
      if (l.orderLineId) {
        const ol = orderLines.get(String(l.orderLineId));
        if (!ol) return { ok: false as const, error: 'order_line_not_found' };
        productId = ol.product_id;
        orderLineId = ol.id;
        // package lines track cartons / crates; others track stock units
        bumps.push({ orderLineId, qty: ol.by_package === 1 ? packagesIn ?? (l.packId ? Number(l.packQty) : 0) : q });
      }
      lines.push({
        productId,
        unit: um ?? undefined,
        mode: 'loose',
        pieces: um === 'gram' ? l.qty : q,
        unitCostRs: l.unitCostRs,
        unitCostPaisa: l.unitCostPaisa,
        expiryDate: l.expiryDate,
        batchNo: l.batchNo,
        orderLineId,
        packId: l.packId ?? null,
        packQty: l.packQty,
        packUnits: l.packUnits,
        packCostRs: l.packCostRs,
        packCostPaisa: l.packCostPaisa,
        lineTotalRs: l.lineTotalRs,
        lineTotalPaisa: l.lineTotalPaisa,
        packages: packagesIn ?? undefined,
        packName: packagesIn != null ? l.packName : undefined,
      });
      if (input.canSetPrice && (l.newPricePaisa != null || (l.newPriceRs != null && l.newPriceRs !== ''))) {
        const p = parseMoneyPair(l.newPricePaisa, l.newPriceRs, 'zero');
        if (!p.ok || p.paisa <= 0) return { ok: false as const, error: 'invalid_price' };
        prices.push({ productId, paisa: p.paisa });
      }
    }
    if (lines.length < 1 && !input.close) return { ok: false as const, error: 'purchase_lines_required' };

    let changes: CostChange[] = [];
    try {
      const result = this.db.raw.transaction(() => {
        let billId: string | null = null;
        if (lines.length > 0) {
          const made = this.purchases.create({
            supplierId: o.supplier_id,
            lines,
            discountRs: input.discountRs,
            discountPaisa: input.discountPaisa,
            paidRs: input.paidRs,
            paidPaisa: input.paidPaisa,
            purchasedOn: input.purchasedOn,
            note: input.note ?? `PO-${String(o.number).padStart(4, '0')}`,
            createdBy: input.userId,
            purchaseOrderId: id,
            extras: input.extras,
          });
          if (!made.ok) throw new Abort(made.error);
          billId = made.invoice.id;
          changes = made.cost_changes ?? [];
        }
        const bump = this.db.raw.prepare(
          `UPDATE purchase_order_lines SET qty_received = ROUND(qty_received + ?, 3) WHERE id = ?`,
        );
        for (const b of bumps) bump.run(b.qty, b.orderLineId);
        for (const p of prices) {
          this.db.raw.prepare(`UPDATE products SET price_paisa = ?, updated_at = datetime('now') WHERE id = ?`).run(p.paisa, p.productId);
          if (input.userId) {
            this.db.raw
              .prepare(`UPDATE price_history SET changed_by = ? WHERE product_id = ? AND changed_by IS NULL`)
              .run(input.userId, p.productId);
          }
        }
        const left = (
          this.db.raw
            .prepare(`SELECT COUNT(*) AS n FROM purchase_order_lines WHERE order_id = ? AND qty_received < qty_ordered - 0.0005`)
            .get(id) as { n: number }
        ).n;
        const anyIn = (
          this.db.raw.prepare(`SELECT COUNT(*) AS n FROM purchase_order_lines WHERE order_id = ? AND qty_received > 0`).get(id) as { n: number }
        ).n;
        const done = left === 0 || !!input.close;
        const status: PoStatus = done ? 'received' : anyIn > 0 || billId ? 'partial' : o.status;
        this.db.raw
          .prepare(
            `UPDATE purchase_orders SET status = ?, closed_at = CASE WHEN ? THEN datetime('now') ELSE closed_at END,
                    updated_at = datetime('now') WHERE id = ?`,
          )
          .run(status, done ? 1 : 0, id);
        const total = billId
          ? (this.db.raw.prepare(`SELECT total_paisa FROM purchase_invoices WHERE id = ?`).get(billId) as { total_paisa: number }).total_paisa
          : null;
        this.audit('purchase_order.receive', input.userId, id, {
          name: `PO-${String(o.number).padStart(4, '0')} · ${o.supplier_name}`,
          total_paisa: total,
          note: done ? 'received' : 'partly received',
          qty: lines.length,
        });
        return billId;
      })();
      const got = this.get(id);
      if (!got.ok) return got;
      return { ...got, billId: result, price_check: suggestPrices(this.db.raw, changes, { onlyChanged: true }) };
    } catch (e) {
      if (e instanceof Abort) return { ok: false as const, error: e.code };
      throw e;
    }
  }
}
