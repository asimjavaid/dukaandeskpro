import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CONTAINER_NAME, FIXED_UNITS, isContainer, isMeasure, lineMeasure, measureFromPackName, measuresFor, type Measure } from '../catalog/measures';
import { parseMoneyPair } from '../common/amount';
import { ListPage } from '../common/list-page';
import { DbService } from '../db/db.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { karachiYmd } from '../suppliers/suppliers.service';
import { suggestPrices, type CostChange, type PriceCheckRow } from '../pricing/pricing';
import { unitCostFromAmount } from '../stock/stock.service';
import { allowsFraction, lineMoney, parseQty } from '../common/qty';

/**
 * Line total is never a flat amount the user typed for the whole line.
 * Loose: quantity × cost per unit. Carton: cartons × cost per carton.
 * Subtotal is the sum of those totals. Discount is split across lines in
 * proportion to each line total (leftover paisa to the later lines).
 * Stock unit cost is round((line total − that share) / stock units).
 * Loose stock units = quantity. Carton stock units = cartons × units inside.
 * Supplier due is still invoice total − paid.
 */
export function discountShares(amounts: number[], discount: number): number[] {
  const subtotal = amounts.reduce((sum, n) => sum + n, 0);
  if (discount <= 0 || subtotal <= 0) return amounts.map(() => 0);
  const shares = amounts.map((amount) => Math.floor((discount * amount) / subtotal));
  let leftover = discount - shares.reduce((sum, n) => sum + n, 0);
  for (let i = shares.length - 1; i >= 0 && leftover > 0; i--) {
    const room = amounts[i] - shares[i];
    const take = Math.min(room, leftover);
    shares[i] += take;
    leftover -= take;
  }
  return shares;
}

/** Extra charges spread by line value: 2-decimal (paisa) shares, remainder on the last line so they add up exactly. */
export function extraShares(values: number[], extra: number): number[] {
  const sum = values.reduce((a, n) => a + n, 0);
  if (extra <= 0 || values.length === 0) return values.map(() => 0);
  if (sum <= 0) {
    const out = values.map(() => 0);
    out[out.length - 1] = extra;
    return out;
  }
  const out = values.map((v) => Math.round((extra * v) / sum));
  out[out.length - 1] = extra - out.slice(0, -1).reduce((a, n) => a + n, 0);
  if (out[out.length - 1] < 0) {
    // only when the last line is worth ~nothing: move the overshoot to the biggest share
    const big = out.indexOf(Math.max(...out));
    out[big] += out[out.length - 1];
    out[out.length - 1] = 0;
  }
  return out;
}

export type PurchaseExtraInput = { label?: unknown; amountRs?: unknown; amountPaisa?: unknown; paidSeparately?: unknown };

export function parseExtras(raw: unknown):
  | { ok: true; rows: Array<{ label: string; paisa: number; separate: boolean }> }
  | { ok: false; error: string } {
  if (raw == null) return { ok: true, rows: [] };
  if (!Array.isArray(raw) || raw.length > 10) return { ok: false, error: 'invalid_extras' };
  const rows: Array<{ label: string; paisa: number; separate: boolean }> = [];
  for (const r of raw as PurchaseExtraInput[]) {
    if (!r || typeof r !== 'object') return { ok: false, error: 'invalid_extras' };
    const m = parseMoneyPair(r.amountPaisa, r.amountRs, 'zero');
    if (!m.ok) return { ok: false, error: m.error };
    if (m.paisa === 0) continue;
    const label = String(r.label ?? '').trim().slice(0, 60) || 'Delivery';
    rows.push({ label, paisa: m.paisa, separate: r.paidSeparately === true || r.paidSeparately === 1 });
  }
  return { ok: true, rows };
}

function isYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, day] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === day
  );
}

export type PurchaseLineInput = {
  productId?: string;
  mode?: string;
  pieces?: unknown;
  /** Cost per product unit. Not the line total. */
  unitCostRs?: unknown;
  unitCostPaisa?: unknown;
  cartons?: unknown;
  unitsPerCarton?: unknown;
  /** Cost per carton. Not the line total. */
  cartonCostRs?: unknown;
  cartonCostPaisa?: unknown;
  /** Optional best-before date (YYYY-MM-DD) and batch / lot number. */
  expiryDate?: unknown;
  batchNo?: unknown;
  /** Set by purchase-order receive. */
  orderLineId?: string | null;
  /** Buy by pack (carton/box/bori): packQty × pack units = stock in selling units. */
  packId?: string | null;
  packQty?: unknown;
  packUnits?: unknown;
  packCostRs?: unknown;
  packCostPaisa?: unknown;
  /** What the supplier said for the whole line. Wins over unit/pack cost when set. */
  lineTotalRs?: unknown;
  lineTotalPaisa?: unknown;
  /** Cartons / crates received; units per package in packUnits (no packId needed). */
  packages?: unknown;
  packName?: unknown;
  /** What it was bought in: kg, gram, litre, piece, packet, bottle, tin, can, dozen, carton, crate, box, bag, pack. */
  unit?: unknown;
};

/**
 * Turn the line's measure into the fields below it: containers become packages × pcs per (dozen = 12),
 * gram becomes kg. Returns the measure stored on the line (older callers without one get it worked out).
 */
export function applyMeasure(
  db: { prepare: (sql: string) => { get: (...a: unknown[]) => unknown } },
  productId: string,
  line: PurchaseLineInput,
): { ok: true; unit: Measure } | { ok: false; error: string } {
  const p = db.prepare(`SELECT unit_label, product_type FROM products WHERE id = ? AND active = 1`).get(productId) as
    | { unit_label: string; product_type: string }
    | undefined;
  if (!p) return { ok: false, error: 'product_not_found' };
  if (line.unit == null || line.unit === '') {
    if (line.packId) {
      const pk = db.prepare(`SELECT name FROM product_packs WHERE id = ?`).get(String(line.packId)) as { name: string } | undefined;
      return { ok: true, unit: measureFromPackName(pk?.name) ?? 'pack' };
    }
    if (line.packages != null && line.packages !== '') return { ok: true, unit: measureFromPackName(String(line.packName ?? '')) ?? 'carton' };
    return { ok: true, unit: lineMeasure({ unit_label: p.unit_label }) };
  }
  const m = String(line.unit).toLowerCase();
  if (!isMeasure(m) || !measuresFor(p).includes(m)) return { ok: false, error: 'invalid_buy_measure' };
  if (isContainer(m)) {
    if (!line.packId) {
      if (line.packages == null || line.packages === '') {
        if (line.pieces == null || line.pieces === '') return { ok: false, error: 'invalid_qty' };
        line.packages = line.pieces;
      }
      line.packName = CONTAINER_NAME[m];
      const fixed = FIXED_UNITS[m];
      if (fixed) line.packUnits = fixed;
    }
    return { ok: true, unit: m };
  }
  if (line.packId || (line.packages != null && line.packages !== '')) return { ok: false, error: 'invalid_buy_measure' };
  if (m === 'gram') {
    const g = Number(line.pieces);
    if (!Number.isFinite(g) || g <= 0) return { ok: false, error: 'invalid_qty' };
    line.pieces = Math.round(g) / 1000;
    // cost stays per kg (stock unit); grams usually come with the line total
  }
  return { ok: true, unit: m };
}

/**
 * "2 cartons x 12": find (or add) the product's Carton / Crate pack and use it for this line.
 * The pack keeps the latest units so the next receive is prefilled.
 */
export function packagesToPack(
  db: { prepare: (sql: string) => { get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown } },
  productId: string,
  line: PurchaseLineInput,
): { ok: true } | { ok: false; error: string } {
  if (line.packId || line.packages == null || line.packages === '') return { ok: true };
  const p = db.prepare(`SELECT product_type, buy_unit FROM products WHERE id = ? AND active = 1`).get(productId) as
    | { product_type: string; buy_unit: string | null }
    | undefined;
  if (!p) return { ok: false, error: 'product_not_found' };
  if (p.product_type === 'bulk' && String(line.packName ?? '').toLowerCase() !== 'bag') return { ok: false, error: 'bulk_buys_by_kg' };
  const n = Number(line.packages);
  if (!Number.isInteger(n) || n <= 0 || n > 100000) return { ok: false, error: 'invalid_qty' };
  const u = Number(line.packUnits);
  if (!Number.isFinite(u) || u <= 0 || u > 100000) return { ok: false, error: 'pack_units_required' };
  const units = Math.round(u * 1000) / 1000;
  const wanted = String(line.packName ?? '').trim();
  const name = wanted ? wanted.slice(0, 24) : p.buy_unit === 'crate' ? 'Crate' : 'Carton';
  const have = db
    .prepare(`SELECT id FROM product_packs WHERE product_id = ? AND active = 1 AND lower(name) = lower(?) ORDER BY sort, created_at LIMIT 1`)
    .get(productId, name) as { id: string } | undefined;
  let id = have?.id;
  if (id) db.prepare(`UPDATE product_packs SET units = ? WHERE id = ?`).run(units, id);
  else {
    id = randomUUID();
    db.prepare(`INSERT INTO product_packs (id, product_id, name, units, sort) VALUES (?, ?, ?, ?, 0)`).run(id, productId, name, units);
  }
  line.packId = id;
  line.packQty = n;
  line.packUnits = units;
  return { ok: true };
}

/** Optional supplier line total (null = not given). */
export function parseLineTotal(line: { lineTotalRs?: unknown; lineTotalPaisa?: unknown }): { ok: true; paisa: number | null } | { ok: false; error: string } {
  const given = (v: unknown) => v != null && String(v).trim() !== '';
  if (!given(line.lineTotalPaisa) && !given(line.lineTotalRs)) return { ok: true, paisa: null };
  const r = parseMoneyPair(line.lineTotalPaisa, line.lineTotalRs, 'zero');
  if (!r.ok) return r;
  return { ok: true, paisa: r.paisa };
}

/** Units per carton / crate and cost per package from the last bill (this supplier first). */
export function lastPackFor(
  db: { prepare: (sql: string) => { get: (...a: unknown[]) => unknown } },
  supplierId: string | null,
  productId: string,
  packName: string,
): { units: number; pack_cost_paisa: number | null } | null {
  const r = db
    .prepare(
      `SELECT pl.pack_units AS units, CASE WHEN pl.pack_qty > 0 THEN ROUND(pl.line_amount_paisa * 1.0 / pl.pack_qty) END AS pack_cost_paisa
       FROM purchase_lines pl JOIN purchase_invoices i ON i.id = pl.invoice_id
       WHERE pl.product_id = ? AND pl.pack_units > 0 AND lower(pl.pack_name) = lower(?)
       ORDER BY (i.supplier_id = ?) DESC, i.created_at DESC, pl.rowid DESC LIMIT 1`,
    )
    .get(productId, packName, supplierId ?? '') as { units: number; pack_cost_paisa: number | null } | undefined;
  if (r) return r;
  // Never bought yet: the product's own Carton / Crate preset (sane sizes only).
  const preset = db
    .prepare(
      `SELECT units FROM product_packs WHERE product_id = ? AND active = 1 AND lower(name) = lower(?) AND units > 1 AND units <= ${PRESET_MAX_UNITS}
       ORDER BY sort, created_at LIMIT 1`,
    )
    .get(productId, packName) as { units: number } | undefined;
  return preset ? { units: preset.units, pack_cost_paisa: null } : null;
}

/** Presets above this are treated as typos (e.g. a crate of 1000) and never pre-filled. */
export const PRESET_MAX_UNITS = 200;

export type PackInfo = { packId: string; name: string; units: number; qty: number; costPaisa: number };

/** Resolve a pack line against product_packs. Units may be overridden for this bill (supplier's carton differs). */
export function resolvePack(
  db: { prepare: (sql: string) => { get: (...a: unknown[]) => unknown } },
  productId: string,
  line: { packId?: string | null; packQty?: unknown; packUnits?: unknown; packCostRs?: unknown; packCostPaisa?: unknown },
): { ok: true; pack: PackInfo } | { ok: false; error: string } {
  const pack = db
    .prepare(`SELECT id, name, units FROM product_packs WHERE id = ? AND product_id = ?`)
    .get(String(line.packId ?? ''), productId) as { id: string; name: string; units: number } | undefined;
  if (!pack) return { ok: false, error: 'pack_not_found' };
  const qty = Number(line.packQty);
  if (!Number.isInteger(qty) || qty <= 0 || qty > 100000) return { ok: false, error: 'invalid_qty' };
  let units = Number(pack.units);
  if (line.packUnits != null && line.packUnits !== '') {
    const u = Number(line.packUnits);
    if (!Number.isFinite(u) || u <= 0 || u > 100000) return { ok: false, error: 'invalid_qty' };
    units = Math.round(u * 1000) / 1000;
  }
  const cost = parseMoneyPair(line.packCostPaisa, line.packCostRs, 'zero');
  if (!cost.ok) return { ok: false, error: cost.error };
  return { ok: true, pack: { packId: pack.id, name: pack.name, units, qty, costPaisa: cost.paisa } };
}

export type PurchaseLineRow = {
  id: string;
  product_id: string;
  product_name: string;
  unit_label: string;
  mode: 'loose' | 'carton';
  pieces: number;
  cartons: number | null;
  units_per_carton: number | null;
  line_amount_paisa: number;
  discount_share_paisa: number;
  unit_cost_paisa: number;
  expiry_date?: string | null;
  batch_no?: string | null;
  pack_name?: string | null;
  pack_units?: number | null;
  pack_qty?: number | null;
  extra_share_paisa?: number;
  /** kg, gram, carton, bottle … what it was bought in. */
  unit?: string | null;
};

export type PurchaseExtraRow = { id: string; label: string; amount_paisa: number; paid_separately: number };

export type PurchaseInvoiceRow = {
  id: string;
  supplier_id: string;
  supplier_name: string;
  subtotal_paisa: number;
  discount_paisa: number;
  total_paisa: number;
  paid_paisa: number;
  due_paisa: number;
  purchased_on: string;
  note: string | null;
  created_at: string;
  purchase_order_id?: string | null;
  order_number?: number | null;
  extras_paisa?: number;
  extras_owed_paisa?: number;
  extras?: PurchaseExtraRow[];
};

const MAX_LINES = 40;

@Injectable()
export class PurchasesService {
  constructor(
    private readonly db: DbService,
    private readonly suppliers: SuppliersService,
  ) {}

  list(paging?: ListPage | null): {
    items: PurchaseInvoiceRow[];
    total: number;
    page?: number;
    pageSize?: number;
  } {
    const totalRow = this.db.raw
      .prepare(`SELECT COUNT(*) AS c FROM purchase_invoices`)
      .get() as { c: number };
    let sql = `SELECT i.id, i.supplier_id, s.name AS supplier_name,
                      i.subtotal_paisa, i.discount_paisa, i.total_paisa,
                      i.paid_paisa, i.due_paisa, i.purchased_on, i.note, i.created_at,
                      i.purchase_order_id, o.number AS order_number, i.extras_paisa, i.extras_owed_paisa
               FROM purchase_invoices i
               JOIN suppliers s ON s.id = i.supplier_id
               LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id
               ORDER BY i.purchased_on DESC, i.created_at DESC`;
    const args: number[] = [];
    if (paging) {
      sql += ' LIMIT ? OFFSET ?';
      args.push(paging.pageSize, (paging.page - 1) * paging.pageSize);
    }
    const items = this.db.raw.prepare(sql).all(...args) as PurchaseInvoiceRow[];
    return {
      items,
      total: Number(totalRow?.c ?? 0),
      page: paging?.page,
      pageSize: paging?.pageSize,
    };
  }

  get(id: string):
    | { ok: true; invoice: PurchaseInvoiceRow; lines: PurchaseLineRow[] }
    | { ok: false; error: 'purchase_not_found' } {
    const invoice = this.db.raw
      .prepare(
        `SELECT i.id, i.supplier_id, s.name AS supplier_name,
                i.subtotal_paisa, i.discount_paisa, i.total_paisa,
                i.paid_paisa, i.due_paisa, i.purchased_on, i.note, i.created_at,
                i.purchase_order_id, o.number AS order_number, i.extras_paisa, i.extras_owed_paisa
         FROM purchase_invoices i
         JOIN suppliers s ON s.id = i.supplier_id
         LEFT JOIN purchase_orders o ON o.id = i.purchase_order_id
         WHERE i.id = ?`,
      )
      .get(id) as PurchaseInvoiceRow | undefined;
    if (!invoice) return { ok: false, error: 'purchase_not_found' };
    const lines = this.db.raw
      .prepare(
        `SELECT l.id, l.product_id, p.name AS product_name, p.unit_label,
                l.mode, l.pieces, l.cartons, l.units_per_carton,
                l.line_amount_paisa, l.line_total_paisa, l.discount_share_paisa, l.unit_cost_paisa, l.expiry_date, l.batch_no,
                l.pack_name, l.pack_units, l.pack_qty, l.extra_share_paisa, l.unit
         FROM purchase_lines l
         JOIN products p ON p.id = l.product_id
         WHERE l.invoice_id = ?
         ORDER BY p.name COLLATE NOCASE ASC`,
      )
      .all(id) as PurchaseLineRow[];
    for (const l of lines) l.unit = lineMeasure(l);
    invoice.extras = this.db.raw
      .prepare(`SELECT id, label, amount_paisa, paid_separately FROM purchase_extras WHERE invoice_id = ? ORDER BY sort, rowid`)
      .all(id) as PurchaseExtraRow[];
    return { ok: true, invoice, lines };
  }

  create(input: {
    supplierId?: string;
    lines?: PurchaseLineInput[];
    discountRs?: unknown;
    discountPaisa?: unknown;
    paidRs?: unknown;
    paidPaisa?: unknown;
    purchasedOn?: string;
    note?: string | null;
    createdBy?: string;
    purchaseOrderId?: string | null;
    extras?: unknown;
  }):
    | { ok: true; invoice: PurchaseInvoiceRow; lines: PurchaseLineRow[]; cost_changes?: CostChange[]; price_check?: PriceCheckRow[] }
    | { ok: false; error: string } {
    this.suppliers.ensureNoSupplier();
    const supplierId = String(input.supplierId ?? '').trim();
    if (!supplierId) return { ok: false, error: 'supplier_required' };
    const supplier = this.db.raw
      .prepare(`SELECT id FROM suppliers WHERE id = ? AND active = 1`)
      .get(supplierId) as { id: string } | undefined;
    if (!supplier) return { ok: false, error: 'supplier_not_found' };

    const rawLines = input.lines ?? [];
    if (rawLines.length < 1 || rawLines.length > MAX_LINES) {
      return { ok: false, error: 'purchase_lines_required' };
    }

    const parsed: {
      productId: string;
      mode: 'loose' | 'carton';
      pieces: number;
      cartons: number | null;
      unitsPerCarton: number | null;
      qtyInput: number;
      receiveUnit: 'piece' | 'carton';
      amountPaisa: number;
    }[] = [];
    const batches: Array<{ expiry: string | null; batch: string | null; orderLineId: string | null }> = [];
    const packs: Array<PackInfo | null> = [];
    const totals: Array<number | null> = [];
    const measures: Measure[] = [];
    for (const line of rawLines) {
      const am = applyMeasure(this.db.raw, String(line.productId ?? '').trim(), line);
      if (!am.ok) return am;
      measures.push(am.unit);
      const pk = packagesToPack(this.db.raw, String(line.productId ?? '').trim(), line);
      if (!pk.ok) return pk;
      if (line.packId) {
        const productId = String(line.productId ?? '').trim();
        const rp = resolvePack(this.db.raw, productId, line);
        if (!rp.ok) return rp;
        const pieces = Math.round(rp.pack.qty * rp.pack.units * 1000) / 1000;
        const lt = parseLineTotal(line);
        if (!lt.ok) return lt;
        if (lt.paisa != null) rp.pack.costPaisa = Math.round(lt.paisa / rp.pack.qty);
        const amount = lt.paisa ?? rp.pack.qty * rp.pack.costPaisa;
        if (!Number.isSafeInteger(amount)) return { ok: false, error: 'invalid_amount' };
        totals.push(lt.paisa);
        parsed.push({ productId, mode: 'loose', pieces, cartons: null, unitsPerCarton: null, qtyInput: rp.pack.qty, receiveUnit: 'carton', amountPaisa: amount });
        packs.push(rp.pack);
      } else {
        const built = buildLine(line);
        if (!built.ok) return built;
        const lt = parseLineTotal(line);
        if (!lt.ok) return lt;
        if (lt.paisa != null) built.line.amountPaisa = lt.paisa;
        parsed.push(built.line);
        packs.push(null);
        totals.push(lt.paisa);
      }
      const exp = String(line.expiryDate ?? '').trim();
      if (exp && !isYmd(exp)) return { ok: false, error: 'invalid_expiry' };
      const batch = String(line.batchNo ?? '').trim().slice(0, 40);
      batches.push({ expiry: exp || null, batch: batch || null, orderLineId: line.orderLineId ? String(line.orderLineId) : null });
    }

    const subtotal = parsed.reduce((sum, line) => sum + line.amountPaisa, 0);
    const discountParsed = parseMoneyPair(input.discountPaisa, input.discountRs, 'zero');
    if (!discountParsed.ok) return { ok: false, error: discountParsed.error };
    const discount = discountParsed.paisa;
    if (discount > subtotal) return { ok: false, error: 'discount_too_high' };
    const ex = parseExtras(input.extras);
    if (!ex.ok) return { ok: false, error: ex.error };
    const extrasAll = ex.rows.reduce((a, r) => a + r.paisa, 0);
    const extrasOwed = ex.rows.filter((r) => !r.separate).reduce((a, r) => a + r.paisa, 0);
    if (!Number.isSafeInteger(extrasAll)) return { ok: false, error: 'invalid_amount' };
    const total = subtotal - discount + extrasOwed;
    const paidParsed = parseMoneyPair(input.paidPaisa, input.paidRs, 'zero');
    if (!paidParsed.ok) return { ok: false, error: paidParsed.error };
    const paid = paidParsed.paisa;
    if (paid > total) return { ok: false, error: 'paid_too_high' };
    const due = total - paid;

    const rawDate = String(input.purchasedOn ?? '').trim();
    const purchasedOn = rawDate || karachiYmd();
    if (!isYmd(purchasedOn)) return { ok: false, error: 'invalid_date' };
    const noteRaw = String(input.note ?? '').trim();
    const note = noteRaw ? noteRaw.slice(0, 240) : null;

    const shares = discountShares(
      parsed.map((line) => line.amountPaisa),
      discount,
    );
    const xShares = extraShares(parsed.map((line, i) => line.amountPaisa - shares[i]), extrasAll);
    const invoiceId = randomUUID();
    const prevCost = new Map<string, number | null>();
    const costRead = this.db.raw.prepare(`SELECT last_unit_cost_paisa AS c FROM products WHERE id = ?`);
    for (const line of parsed) {
      if (!prevCost.has(line.productId)) prevCost.set(line.productId, (costRead.get(line.productId) as { c: number | null } | undefined)?.c ?? null);
    }
    const costChanges: CostChange[] = [];

    const failed = this.db.raw.transaction(() => {
      for (const line of parsed) {
        const product = this.db.raw
          .prepare(`SELECT id, unit_label, product_type FROM products WHERE id = ? AND active = 1`)
          .get(line.productId) as { id: string; unit_label: string | null; product_type: string } | undefined;
        if (!product) return 'product_not_found' as const;
        if (!allowsFraction(product.unit_label) && !Number.isInteger(line.pieces)) {
          return 'invalid_qty' as const;
        }
      }

      this.db.raw
        .prepare(
          `INSERT INTO purchase_invoices
             (id, supplier_id, subtotal_paisa, discount_paisa, total_paisa,
              paid_paisa, due_paisa, purchased_on, note, created_by, purchase_order_id, extras_paisa, extras_owed_paisa)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          invoiceId,
          supplierId,
          subtotal,
          discount,
          total,
          paid,
          due,
          purchasedOn,
          note,
          input.createdBy ?? null,
          input.purchaseOrderId ?? null,
          extrasAll,
          extrasOwed,
        );
      const insExtra = this.db.raw.prepare(
        `INSERT INTO purchase_extras (id, invoice_id, label, amount_paisa, paid_separately, sort) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      ex.rows.forEach((r, i) => insExtra.run(randomUUID(), invoiceId, r.label, r.paisa, r.separate ? 1 : 0, i));

      const insertLine = this.db.raw.prepare(
        `INSERT INTO purchase_lines
           (id, invoice_id, product_id, pieces, line_amount_paisa,
            discount_share_paisa, unit_cost_paisa, mode, cartons, units_per_carton,
            expiry_date, batch_no, batch_left, order_line_id, pack_id, pack_name, pack_units, pack_qty, line_total_paisa, extra_share_paisa, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertReceive = this.db.raw.prepare(
        `INSERT INTO stock_receives
           (id, product_id, qty_input, unit, qty_pieces, received_by, note,
            amount_paisa, unit_cost_paisa, supplier_id, paid_now, purchase_invoice_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      );
      const bumpStock = this.db.raw.prepare(
        `INSERT INTO stock_balances (product_id, qty_on_hand, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(product_id) DO UPDATE SET
           qty_on_hand = ROUND(qty_on_hand + excluded.qty_on_hand, 3),
           updated_at = datetime('now')`,
      );
      const rememberPack = this.db.raw.prepare(
        `INSERT INTO supplier_product_pack (supplier_id, product_id, pack_id, pack_units, last_cost_paisa, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(supplier_id, product_id) DO UPDATE SET pack_id = excluded.pack_id, pack_units = excluded.pack_units,
           last_cost_paisa = excluded.last_cost_paisa, updated_at = excluded.updated_at`,
      );
      const setCost = this.db.raw.prepare(
        `UPDATE products
         SET last_unit_cost_paisa = ?, updated_at = datetime('now')
         WHERE id = ?`,
      );

      parsed.forEach((line, index) => {
        const share = shares[index];
        // Landed: what the line cost after discount, plus its share of delivery / extra charges.
        const net = line.amountPaisa - share + xShares[index];
        const unitCost = unitCostFromAmount(net, line.pieces);
        const lineId = randomUUID();
        insertLine.run(
          lineId,
          invoiceId,
          line.productId,
          line.pieces,
          line.amountPaisa,
          share,
          unitCost,
          line.mode,
          line.cartons,
          line.unitsPerCarton,
          batches[index].expiry,
          batches[index].batch,
          batches[index].expiry ? line.pieces : null,
          batches[index].orderLineId,
          packs[index]?.packId ?? null,
          packs[index]?.name ?? null,
          packs[index]?.units ?? null,
          packs[index]?.qty ?? null,
          totals[index] ?? null,
          xShares[index],
          measures[index],
        );
        rememberPack.run(
          supplierId,
          line.productId,
          packs[index]?.packId ?? null,
          packs[index]?.units ?? null,
          packs[index] ? packs[index]!.costPaisa : unitCostFromAmount(line.amountPaisa - share, line.pieces),
        );
        insertReceive.run(
          randomUUID(),
          line.productId,
          line.qtyInput,
          line.receiveUnit,
          line.pieces,
          input.createdBy ?? null,
          note,
          net,
          unitCost,
          supplierId,
          invoiceId,
        );
        bumpStock.run(line.productId, line.pieces);
        setCost.run(unitCost, line.productId);
        costChanges.push({ productId: line.productId, costPaisa: unitCost, prevCostPaisa: prevCost.get(line.productId) ?? null });
      });
      return null;
    })();

    if (failed) return { ok: false, error: failed };
    const got = this.get(invoiceId);
    if (!got.ok) return { ok: false, error: 'purchase_not_found' };
    return { ...got, cost_changes: costChanges, price_check: suggestPrices(this.db.raw, costChanges, { onlyChanged: true }) };
  }
}

function buildLine(line: PurchaseLineInput):
  | {
      ok: true;
      line: {
        productId: string;
        mode: 'loose' | 'carton';
        pieces: number;
        cartons: number | null;
        unitsPerCarton: number | null;
        qtyInput: number;
        receiveUnit: 'piece' | 'carton';
        amountPaisa: number;
      };
    }
  | { ok: false; error: string } {
  const productId = String(line.productId ?? '').trim();
  if (!productId) return { ok: false, error: 'product_not_found' };
  const modeRaw = String(line.mode ?? 'loose').trim().toLowerCase();
  if (modeRaw !== 'loose' && modeRaw !== 'carton') {
    return { ok: false, error: 'invalid_qty' };
  }
  // Carton buying was removed: each size is its own product. Old carton bills stay readable.
  if (modeRaw === 'carton') return { ok: false, error: 'carton_removed' };
  // Decimals allowed here; whole-number units are re-checked against the product.
  const pieces = parseQty(line.pieces, 'kg');
  if (!pieces.ok) return { ok: false, error: 'invalid_qty' };
  const unitCost = parseMoneyPair(line.unitCostPaisa, line.unitCostRs, 'zero');
  if (!unitCost.ok) return { ok: false, error: unitCost.error };
  const amount = lineMoney(pieces.n, unitCost.paisa);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    return { ok: false, error: 'invalid_amount' };
  }
  return {
    ok: true,
    line: {
      productId,
      mode: 'loose',
      pieces: pieces.n,
      cartons: null,
      unitsPerCarton: null,
      qtyInput: pieces.n,
      receiveUnit: 'piece',
      amountPaisa: amount,
    },
  };
}
