import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { allowsFraction, r3 } from '../common/qty';
import { CONTAINER_NAME, FIXED_UNITS, defaultMeasure, isContainer, type Measure } from '../catalog/measures';
import { writeAudit } from '../sales/sale-reversal';
import { readXlsx, writeXlsx, type Cell } from '../common/xlsx';

/**
 * Opening stock: what the shop already has on the day it starts with DukaanDesk.
 * Draft per product (saved as you type) → post as a batch: stock_adjustments reason 'opening'
 * with the unit cost, stock set (or added for items that already sold / bought), cost set so
 * profit and stock value use it. No supplier bill, no purchase rows, no expense.
 */

export type OsPack = { name: string; units: number } | null;

export type OsRow = {
  id: string;
  name: string;
  unit_label: string;
  product_type: string;
  barcode: string | null;
  extra_barcodes: string[];
  price_paisa: number;
  last_cost_paisa: number | null;
  qty_on_hand: number;
  fraction: boolean;
  pack: OsPack;
  /** True when the item is normally bought by the carton / crate: enter in packs by default. */
  pack_default: boolean;
  packed_from: string | null;
  has_activity: boolean;
  draft: {
    mode: 'base' | 'pack';
    qty: number | null;
    packs: number | null;
    pack_units: number | null;
    pack_name: string | null;
    cost_paisa: number | null;
    updated_at: string;
  } | null;
};

export type OsTotals = { entered: number; qty_pieces: number; qty_kg: number; value_paisa: number; no_cost: number };

type DraftInput = {
  mode?: unknown;
  qty?: unknown;
  packs?: unknown;
  packUnits?: unknown;
  costRs?: unknown;
  costPaisa?: unknown;
};

type ProdRow = {
  id: string;
  name: string;
  unit_label: string;
  product_type: string;
  barcode: string | null;
  price_paisa: number;
  last_unit_cost_paisa: number | null;
  pieces_per_carton: number | null;
  buy_measure: string | null;
  buy_unit: string | null;
  active: number;
  repack_from_id: string | null;
};

const MAX_QTY = 1_000_000;

/** Tables whose newer rows (after a post) block undoing that batch. */
const MARK_TABLES = ['sale_lines', 'stock_receives', 'purchase_lines', 'sale_return_lines', 'repack_lines', 'repacks', 'supplier_return_lines', 'stock_adjustments'];

function numOrNull(v: unknown): number | null | 'bad' {
  if (v === undefined || v === null) return null;
  const s = typeof v === 'number' ? String(v) : String(v).trim().replace(/,/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return 'bad';
  const n = Number(s);
  return Number.isFinite(n) ? n : 'bad';
}

function paisaFrom(input: { costRs?: unknown; costPaisa?: unknown }): number | null | 'bad' | undefined {
  if (input.costPaisa !== undefined) {
    if (input.costPaisa === null || input.costPaisa === '') return null;
    const n = Number(input.costPaisa);
    return Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000 ? n : 'bad';
  }
  if (input.costRs === undefined) return undefined;
  if (input.costRs === null) return null;
  const raw = typeof input.costRs === 'number' ? String(Math.round(input.costRs * 100) / 100) : String(input.costRs).trim().replace(/,/g, '').replace(/^rs\.?\s*/i, '');
  if (raw === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    // Excel may hand back 12.300000000000001: accept when it rounds cleanly to paisa.
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return 'bad';
    return Math.round(n * 100);
  }
  const p = Math.round(Number(raw) * 100);
  return p <= 1_000_000_000 ? p : 'bad';
}

export function ymdHm(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

@Injectable()
export class OpeningStockService {
  constructor(private readonly db: DbService) {}

  private get raw() {
    return this.db.raw;
  }

  /** Products that already sold, were bought, returned, repacked or had opening stock posted. */
  private activeSet(ids?: string[]): Set<string> {
    const rows = this.raw
      .prepare(
        `SELECT product_id AS id FROM sale_lines
         UNION SELECT product_id FROM stock_receives
         UNION SELECT product_id FROM purchase_lines
         UNION SELECT product_id FROM sale_return_lines
         UNION SELECT product_id FROM repack_lines
         UNION SELECT bulk_product_id FROM repacks
         UNION SELECT product_id FROM supplier_return_lines
         UNION SELECT l.product_id FROM opening_stock_lines l JOIN opening_stock_batches b ON b.id = l.batch_id WHERE b.undone_at IS NULL`,
      )
      .all() as Array<{ id: string }>;
    const s = new Set(rows.map((r) => r.id));
    if (ids) for (const id of [...s]) if (!ids.includes(id)) s.delete(id);
    return s;
  }

  /** Default "enter as" pack for a product: its buy measure's pack (Carton × 24), else any active pack, else pcs per carton. */
  private packFor(p: ProdRow, packs: Map<string, Array<{ name: string; units: number }>>): OsPack {
    if (allowsFraction(p.unit_label) || p.product_type === 'bulk') return null;
    const list = (packs.get(p.id) ?? []).filter((k) => Number.isInteger(k.units) && k.units > 1);
    const m = defaultMeasure(p) as Measure;
    if (isContainer(m)) {
      const want = CONTAINER_NAME[m]!.toLowerCase();
      const hit = list.find((k) => k.name.trim().toLowerCase() === want);
      if (hit) return { name: CONTAINER_NAME[m]!, units: hit.units };
      if (FIXED_UNITS[m]) return { name: CONTAINER_NAME[m]!, units: FIXED_UNITS[m]! };
    }
    if (list.length) return { name: list[0].name, units: list[0].units };
    const ppc = Number(p.pieces_per_carton ?? 1);
    if (Number.isInteger(ppc) && ppc > 1) return { name: 'Carton', units: ppc };
    return null;
  }

  list(): { items: OsRow[]; totals: OsTotals; batches: ReturnType<OpeningStockService['batches']>; draft_count: number } {
    const prods = this.raw
      .prepare(
        `SELECT p.id, p.name, p.unit_label, p.product_type, p.barcode, p.price_paisa, p.last_unit_cost_paisa,
                p.pieces_per_carton, p.buy_measure, p.buy_unit, p.active, p.repack_from_id,
                COALESCE(s.qty_on_hand, 0) AS qty_on_hand, f.name AS packed_from
           FROM products p
           LEFT JOIN stock_balances s ON s.product_id = p.id
           LEFT JOIN products f ON f.id = p.repack_from_id
          WHERE p.active = 1
          ORDER BY p.name COLLATE NOCASE`,
      )
      .all() as Array<ProdRow & { qty_on_hand: number; packed_from: string | null }>;
    const packs = new Map<string, Array<{ name: string; units: number }>>();
    for (const k of this.raw
      .prepare(`SELECT product_id, name, units FROM product_packs WHERE active = 1 ORDER BY product_id, sort, created_at`)
      .all() as Array<{ product_id: string; name: string; units: number }>) {
      const a = packs.get(k.product_id) ?? [];
      a.push({ name: k.name, units: Number(k.units) });
      packs.set(k.product_id, a);
    }
    const extras = new Map<string, string[]>();
    for (const x of this.raw.prepare(`SELECT product_id, barcode FROM product_barcodes ORDER BY created_at, rowid`).all() as Array<{ product_id: string; barcode: string }>) {
      const a = extras.get(x.product_id) ?? [];
      a.push(x.barcode);
      extras.set(x.product_id, a);
    }
    const drafts = new Map<string, OsRow['draft']>();
    for (const d of this.raw.prepare(`SELECT * FROM opening_stock_drafts`).all() as Array<Record<string, unknown>>) {
      drafts.set(String(d.product_id), {
        mode: d.mode === 'pack' ? 'pack' : 'base',
        qty: d.qty == null ? null : Number(d.qty),
        packs: d.packs == null ? null : Number(d.packs),
        pack_units: d.pack_units == null ? null : Number(d.pack_units),
        pack_name: d.pack_name == null ? null : String(d.pack_name),
        cost_paisa: d.cost_paisa == null ? null : Number(d.cost_paisa),
        updated_at: String(d.updated_at),
      });
    }
    const act = this.activeSet();
    const items: OsRow[] = prods.map((p) => ({
      id: p.id,
      name: p.name,
      unit_label: p.unit_label,
      product_type: p.product_type,
      barcode: p.barcode,
      extra_barcodes: extras.get(p.id) ?? [],
      price_paisa: Number(p.price_paisa),
      last_cost_paisa: p.last_unit_cost_paisa == null ? null : Number(p.last_unit_cost_paisa),
      qty_on_hand: Number(p.qty_on_hand),
      fraction: allowsFraction(p.unit_label),
      pack: this.packFor(p, packs),
      pack_default: !allowsFraction(p.unit_label) && p.product_type !== 'bulk' && isContainer(defaultMeasure(p) as Measure),
      packed_from: p.product_type === 'packed' ? p.packed_from : null,
      has_activity: act.has(p.id),
      draft: drafts.get(p.id) ?? null,
    }));
    return { items, totals: this.totals(), batches: this.batches(), draft_count: drafts.size };
  }

  totals(): OsTotals {
    const r = this.raw
      .prepare(
        `SELECT COUNT(*) AS entered,
                COALESCE(SUM(CASE WHEN lower(p.unit_label) IN ('kg','litre','meter','foot') THEN 0 ELSE d.qty END), 0) AS qty_pieces,
                COALESCE(SUM(CASE WHEN lower(p.unit_label) IN ('kg','litre','meter','foot') THEN d.qty ELSE 0 END), 0) AS qty_kg,
                COALESCE(SUM(ROUND(d.qty * COALESCE(d.cost_paisa, 0))), 0) AS value_paisa,
                COALESCE(SUM(CASE WHEN d.cost_paisa IS NULL THEN 1 ELSE 0 END), 0) AS no_cost
           FROM opening_stock_drafts d JOIN products p ON p.id = d.product_id AND p.active = 1
          WHERE d.qty > 0`,
      )
      .get() as OsTotals;
    return { entered: Number(r.entered), qty_pieces: Number(r.qty_pieces), qty_kg: r3(Number(r.qty_kg)), value_paisa: Number(r.value_paisa), no_cost: Number(r.no_cost) };
  }

  private product(id: string): ProdRow | undefined {
    return this.raw
      .prepare(
        `SELECT id, name, unit_label, product_type, barcode, price_paisa, last_unit_cost_paisa, pieces_per_carton,
                buy_measure, buy_unit, active, repack_from_id FROM products WHERE id = ?`,
      )
      .get(id) as ProdRow | undefined;
  }

  /** Check one draft entry. qty in base units (pieces / kg); pack mode: packs × pack units. */
  private validate(
    p: ProdRow,
    input: DraftInput,
    prev: { cost_paisa: number | null } | undefined,
  ):
    | { ok: true; clear: boolean; mode: 'base' | 'pack'; qty: number | null; packs: number | null; packUnits: number | null; packName: string | null; cost: number | null }
    | { ok: false; error: string } {
    const frac = allowsFraction(p.unit_label);
    const mode = input.mode === 'pack' && !frac ? 'pack' : 'base';
    let cost = paisaFrom(input);
    if (cost === 'bad') return { ok: false, error: 'invalid_cost' };
    let qty: number | null = null;
    let packs: number | null = null;
    let packUnits: number | null = null;
    let packName: string | null = null;
    if (mode === 'pack') {
      const a = numOrNull(input.packs);
      const u = numOrNull(input.packUnits);
      if (a === 'bad' || u === 'bad' || (a != null && !Number.isInteger(a)) || (u != null && (!Number.isInteger(u) || u < 1))) return { ok: false, error: 'invalid_qty' };
      packs = a;
      packUnits = u;
      if (packs != null && packUnits == null) return { ok: false, error: 'pack_units_required' };
      qty = packs == null ? null : packs * (packUnits ?? 1);
      packName = (this.packFor(p, this.packMap(p.id))?.name ?? 'Carton');
    } else {
      const q = numOrNull(input.qty);
      if (q === 'bad') return { ok: false, error: 'invalid_qty' };
      const qn = q != null && !frac && Math.abs(q - Math.round(q)) < 1e-6 ? Math.round(q) : q;
      if (qn != null && !frac && !Number.isInteger(qn)) return { ok: false, error: 'invalid_qty' };
      if (qn != null && frac && Math.abs(qn - r3(qn)) > 1e-6) return { ok: false, error: 'invalid_qty' };
      qty = qn == null ? null : frac ? r3(qn) : qn;
    }
    if (qty != null && (qty < 0 || qty > MAX_QTY)) return { ok: false, error: 'invalid_qty' };
    if (qty === 0) qty = null;
    if (cost === undefined) cost = prev ? prev.cost_paisa : p.last_unit_cost_paisa == null ? null : Number(p.last_unit_cost_paisa);
    const clear = qty == null && (packs == null || packs === 0) && cost == null;
    return { ok: true, clear, mode, qty, packs: packs === 0 ? null : packs, packUnits, packName, cost };
  }

  private packMap(id: string) {
    const m = new Map<string, Array<{ name: string; units: number }>>();
    m.set(id, (this.raw.prepare(`SELECT name, units FROM product_packs WHERE product_id = ? AND active = 1 ORDER BY sort, created_at`).all(id) as Array<{ name: string; units: number }>).map((k) => ({ name: k.name, units: Number(k.units) })));
    return m;
  }

  private writeDraft(productId: string, v: { mode: string; qty: number | null; packs: number | null; packUnits: number | null; packName: string | null; cost: number | null }, userId: string) {
    this.raw
      .prepare(
        `INSERT INTO opening_stock_drafts (product_id, mode, qty, packs, pack_units, pack_name, cost_paisa, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(product_id) DO UPDATE SET mode = excluded.mode, qty = excluded.qty, packs = excluded.packs,
           pack_units = excluded.pack_units, pack_name = excluded.pack_name, cost_paisa = excluded.cost_paisa,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(productId, v.mode, v.qty, v.packs, v.packUnits, v.packName, v.cost, userId);
  }

  saveDraft(productId: string, input: DraftInput, userId: string):
    | { ok: true; draft: OsRow['draft']; totals: OsTotals }
    | { ok: false; error: string } {
    const p = this.product(productId);
    if (!p || p.active !== 1) return { ok: false, error: 'product_not_found' };
    const prev = this.raw.prepare(`SELECT cost_paisa FROM opening_stock_drafts WHERE product_id = ?`).get(productId) as { cost_paisa: number | null } | undefined;
    const v = this.validate(p, input, prev);
    if (!v.ok) return v;
    if (v.clear) {
      this.raw.prepare(`DELETE FROM opening_stock_drafts WHERE product_id = ?`).run(productId);
      return { ok: true, draft: null, totals: this.totals() };
    }
    this.writeDraft(productId, v, userId);
    const d = this.raw.prepare(`SELECT * FROM opening_stock_drafts WHERE product_id = ?`).get(productId) as Record<string, unknown>;
    return {
      ok: true,
      draft: {
        mode: d.mode === 'pack' ? 'pack' : 'base',
        qty: d.qty == null ? null : Number(d.qty),
        packs: d.packs == null ? null : Number(d.packs),
        pack_units: d.pack_units == null ? null : Number(d.pack_units),
        pack_name: d.pack_name == null ? null : String(d.pack_name),
        cost_paisa: d.cost_paisa == null ? null : Number(d.cost_paisa),
        updated_at: String(d.updated_at),
      },
      totals: this.totals(),
    };
  }

  clearDraft(): { ok: true; cleared: number } {
    return { ok: true, cleared: this.raw.prepare(`DELETE FROM opening_stock_drafts`).run().changes };
  }

  /* ── Excel ── */

  template(): { file: Buffer; filename: string } {
    const { items } = this.list();
    const rows: Cell[][] = [['Product', 'Barcode', 'Unit', 'Qty', 'Cartons', 'Pcs per carton', 'Cost per unit (Rs)', 'Sell price (Rs)']];
    for (const r of items) {
      const d = r.draft;
      const pack = d?.mode === 'pack';
      rows.push([
        r.name,
        r.barcode ?? '',
        r.fraction ? r.unit_label : r.unit_label || 'piece',
        !pack && d?.qty != null ? d.qty : '',
        pack && d?.packs != null ? d.packs : '',
        pack ? (d?.pack_units ?? r.pack?.units ?? '') : r.pack?.units ?? '',
        d?.cost_paisa != null ? d.cost_paisa / 100 : r.last_cost_paisa != null ? r.last_cost_paisa / 100 : '',
        r.price_paisa / 100,
      ]);
    }
    const stamp = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
    return {
      file: writeXlsx([{ name: 'Opening stock', rows, widths: [38, 16, 8, 10, 10, 14, 18, 14], textCols: [1] }]),
      filename: `opening-stock-${stamp}.xlsx`,
    };
  }

  /** Read an uploaded template: match by barcode, then exact name. apply=true writes the matched rows to the draft. */
  importSheet(fileBase64: unknown, apply: boolean, userId: string) {
    if (typeof fileBase64 !== 'string' || !fileBase64) return { ok: false as const, error: 'file_required' };
    let rows: string[][];
    try {
      rows = readXlsx(Buffer.from(fileBase64.replace(/^data:[^,]*,/, ''), 'base64'));
    } catch {
      return { ok: false as const, error: 'not_xlsx' };
    }
    if (rows.length < 1) return { ok: false as const, error: 'empty_sheet' };
    const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
    const head = rows[0].map(key);
    const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
    const C = {
      name: col('product', 'name', 'item', 'productname', 'itemname'),
      barcode: col('barcode', 'code', 'ean'),
      qty: col('qty', 'quantity', 'qtyonhand', 'stock', 'openingstock', 'onhand'),
      packs: col('cartons', 'carton', 'packs', 'boxes'),
      units: col('pcspercarton', 'pcsper', 'perCarton'.toLowerCase(), 'unitspercarton', 'piecespercarton'),
      cost: col('costperunitrs', 'costperunit', 'cost', 'costrs', 'unitcost', 'costprice'),
    };
    if (C.name < 0 && C.barcode < 0) return { ok: false as const, error: 'no_product_column' };
    if (C.qty < 0 && C.packs < 0 && C.cost < 0) return { ok: false as const, error: 'no_qty_column' };

    const prods = this.raw
      .prepare(`SELECT id, name, unit_label, product_type, barcode, price_paisa, last_unit_cost_paisa, pieces_per_carton, buy_measure, buy_unit, active, repack_from_id FROM products WHERE active = 1`)
      .all() as ProdRow[];
    const byId = new Map(prods.map((p) => [p.id, p]));
    const byCode = new Map<string, string>();
    for (const p of prods) if (p.barcode) byCode.set(p.barcode, p.id);
    for (const x of this.raw.prepare(`SELECT barcode, product_id FROM product_barcodes`).all() as Array<{ barcode: string; product_id: string }>) {
      if (byId.has(x.product_id)) byCode.set(x.barcode, x.product_id);
    }
    const byName = new Map<string, string[]>();
    for (const p of prods) {
      const k = p.name.trim().toLowerCase().replace(/\s+/g, ' ');
      byName.set(k, [...(byName.get(k) ?? []), p.id]);
    }
    const prevDrafts = new Map(
      (this.raw.prepare(`SELECT product_id, qty, cost_paisa FROM opening_stock_drafts`).all() as Array<{ product_id: string; qty: number | null; cost_paisa: number | null }>).map((d) => [d.product_id, d]),
    );

    type Hit = { row: number; product_id: string; name: string; unit_label: string; qty: number | null; cost_paisa: number | null; mode: 'base' | 'pack'; packs: number | null; pack_units: number | null; change: 'new' | 'update' | 'same' };
    const matched: Hit[] = [];
    const unmatched: Array<{ row: number; name: string; barcode: string }> = [];
    const errors: Array<{ row: number; name: string; error: string }> = [];
    const seen = new Map<string, number>();
    const cell = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const toWrite: Array<{ id: string; v: Parameters<OpeningStockService['writeDraft']>[1] }> = [];
    let skipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const rowNo = i + 1;
      const name = cell(r, C.name);
      const code = cell(r, C.barcode).replace(/^'/, '').replace(/\.0+$/, '');
      const qtyS = cell(r, C.qty);
      const packsS = cell(r, C.packs);
      const unitsS = cell(r, C.units);
      const costS = cell(r, C.cost);
      if (!qtyS && !packsS) {
        skipped += 1;
        continue; // nothing to fill (cost alone stays as is)
      }
      let pid = code ? byCode.get(code) : undefined;
      if (!pid && name) {
        const ids = byName.get(name.toLowerCase().replace(/\s+/g, ' ')) ?? [];
        if (ids.length === 1) pid = ids[0];
        else if (ids.length > 1) {
          errors.push({ row: rowNo, name, error: 'same_name_twice' });
          continue;
        }
      }
      if (!pid) {
        unmatched.push({ row: rowNo, name, barcode: code });
        continue;
      }
      const p = byId.get(pid)!;
      if (seen.has(pid)) {
        errors.push({ row: rowNo, name: p.name, error: `duplicate_of_row_${seen.get(pid)}` });
        continue;
      }
      seen.set(pid, rowNo);
      if (qtyS && packsS) {
        errors.push({ row: rowNo, name: p.name, error: 'qty_and_cartons' });
        continue;
      }
      const input: DraftInput = packsS
        ? { mode: 'pack', packs: packsS, packUnits: unitsS || undefined, costRs: costS === '' ? undefined : costS }
        : { mode: 'base', qty: qtyS, costRs: costS === '' ? undefined : costS };
      const prev = prevDrafts.get(pid);
      const v = this.validate(p, input, prev ? { cost_paisa: prev.cost_paisa } : undefined);
      if (!v.ok) {
        errors.push({ row: rowNo, name: p.name, error: v.error });
        continue;
      }
      const change: Hit['change'] = !prev ? 'new' : prev.qty === v.qty && prev.cost_paisa === v.cost ? 'same' : 'update';
      matched.push({ row: rowNo, product_id: pid, name: p.name, unit_label: p.unit_label, qty: v.qty, cost_paisa: v.cost, mode: v.mode, packs: v.packs, pack_units: v.packUnits, change });
      toWrite.push({ id: pid, v });
    }
    if (apply) {
      this.raw.transaction(() => {
        for (const w of toWrite) {
          if (w.v.qty == null) this.raw.prepare(`DELETE FROM opening_stock_drafts WHERE product_id = ?`).run(w.id);
          else this.writeDraft(w.id, w.v, userId);
        }
      })();
    }
    return { ok: true as const, applied: apply, matched, unmatched, errors, skipped, totals: this.totals() };
  }

  /* ── post ── */

  private draftLines() {
    return this.raw
      .prepare(
        `SELECT d.*, p.name, p.unit_label, p.last_unit_cost_paisa, COALESCE(s.qty_on_hand, 0) AS qty_on_hand, s.product_id AS has_balance
           FROM opening_stock_drafts d
           JOIN products p ON p.id = d.product_id AND p.active = 1
           LEFT JOIN stock_balances s ON s.product_id = d.product_id
          WHERE d.qty > 0
          ORDER BY p.name COLLATE NOCASE`,
      )
      .all() as Array<{
      product_id: string;
      mode: string;
      qty: number;
      packs: number | null;
      pack_units: number | null;
      pack_name: string | null;
      cost_paisa: number | null;
      name: string;
      unit_label: string;
      last_unit_cost_paisa: number | null;
      qty_on_hand: number;
      has_balance: string | null;
    }>;
  }

  postPreview() {
    const lines = this.draftLines();
    const act = this.activeSet(lines.map((l) => l.product_id));
    return {
      ok: true as const,
      items: lines.length,
      total_value_paisa: lines.reduce((s, l) => s + Math.round(l.qty * (l.cost_paisa ?? 0)), 0),
      no_cost: lines.filter((l) => l.cost_paisa == null).map((l) => l.name),
      added: lines
        .filter((l) => act.has(l.product_id))
        .map((l) => ({ product_id: l.product_id, name: l.name, unit_label: l.unit_label, qty_on_hand: Number(l.qty_on_hand), qty: Number(l.qty), qty_after: r3(Number(l.qty_on_hand) + Number(l.qty)) })),
    };
  }

  post(input: { userId: string; storeId?: string | null }) {
    const lines = this.draftLines();
    if (!lines.length) return { ok: false as const, error: 'nothing_to_post' };
    const act = this.activeSet(lines.map((l) => l.product_id));
    const batchId = randomUUID();
    let total = 0;
    const out = this.raw.transaction(() => {
      const number = (this.raw.prepare(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM opening_stock_batches`).get() as { n: number }).n;
      // Taken before this batch writes its own stock adjustments.
      const marks: Record<string, number> = {};
      for (const t of MARK_TABLES) marks[t] = Number((this.raw.prepare(`SELECT COALESCE(MAX(rowid), 0) AS m FROM ${t}`).get() as { m: number }).m);
      this.raw.prepare(`INSERT INTO opening_stock_batches (id, number, posted_by, marks_json) VALUES (?, ?, ?, ?)`).run(batchId, number, input.userId, JSON.stringify(marks));
      const setBal = this.raw.prepare(
        `INSERT INTO stock_balances (product_id, qty_on_hand, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(product_id) DO UPDATE SET qty_on_hand = excluded.qty_on_hand, updated_at = excluded.updated_at`,
      );
      const adj = this.raw.prepare(
        `INSERT INTO stock_adjustments (id, product_id, delta_pieces, qty_before, qty_after, reason, created_by, note, unit_cost_paisa)
         VALUES (?, ?, ?, ?, ?, 'opening', ?, ?, ?)`,
      );
      const setCost = this.raw.prepare(`UPDATE products SET last_unit_cost_paisa = ?, updated_at = datetime('now') WHERE id = ?`);
      const ins = this.raw.prepare(
        `INSERT INTO opening_stock_lines (id, batch_id, product_id, product_name, unit_label, mode, packs, pack_units, pack_name, qty,
           cost_paisa, value_paisa, added, qty_before, qty_after, cost_before, cost_after, adjustment_id, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      lines.forEach((l, i) => {
        const before = r3(Number(l.qty_on_hand));
        const qty = r3(Number(l.qty));
        const added = act.has(l.product_id);
        const after = added ? r3(before + qty) : qty;
        const costBefore = l.last_unit_cost_paisa == null ? null : Number(l.last_unit_cost_paisa);
        let costAfter = costBefore;
        if (l.cost_paisa != null) {
          // Added to stock that already has a cost: weighted average; otherwise the opening cost.
          costAfter =
            added && before > 0 && costBefore != null
              ? Math.round((before * costBefore + qty * l.cost_paisa) / (before + qty))
              : l.cost_paisa;
        }
        const delta = r3(after - before);
        let adjId: string | null = null;
        if (delta !== 0) {
          adjId = randomUUID();
          adj.run(adjId, l.product_id, delta, before, after, input.userId, `Opening stock #${number}`, l.cost_paisa);
        }
        setBal.run(l.product_id, after);
        if (costAfter !== costBefore) setCost.run(costAfter, l.product_id);
        const value = Math.round(qty * (l.cost_paisa ?? 0));
        total += value;
        ins.run(randomUUID(), batchId, l.product_id, l.name, l.unit_label, l.mode, l.packs, l.pack_units, l.pack_name, qty,
          l.cost_paisa, value, added ? 1 : 0, before, after, costBefore, costAfter, adjId, i);
      });
      this.raw.prepare(`UPDATE opening_stock_batches SET item_count = ?, total_value_paisa = ? WHERE id = ?`).run(lines.length, total, batchId);
      this.raw.prepare(`DELETE FROM opening_stock_drafts WHERE product_id IN (SELECT product_id FROM opening_stock_lines WHERE batch_id = ?)`).run(batchId);
      writeAudit(this.raw, {
        action: 'opening_stock.post',
        userId: input.userId,
        storeId: input.storeId ?? null,
        subjectType: 'opening_stock',
        subjectId: batchId,
        payload: { name: `Opening stock #${number}`, items: lines.length, total_paisa: total, note: `${lines.length} items`, added: lines.filter((l) => act.has(l.product_id)).length },
      });
      return number;
    })();
    return { ok: true as const, batch: this.batch(batchId), number: out };
  }

  /* ── batches ── */

  batches() {
    const rows = this.raw
      .prepare(
        `SELECT b.*, u.display_name AS posted_by_name, uu.display_name AS undone_by_name
           FROM opening_stock_batches b
           LEFT JOIN users u ON u.id = b.posted_by
           LEFT JOIN users uu ON uu.id = b.undone_by
          ORDER BY b.number DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    const last = rows.find((r) => r.undone_at == null);
    return rows.map((r) => {
      const isLast = last && r.id === last.id;
      const block = isLast ? this.undoBlock(String(r.id)) : null;
      return {
        id: String(r.id),
        number: Number(r.number),
        posted_at: String(r.posted_at),
        posted_by_name: (r.posted_by_name as string | null) ?? null,
        item_count: Number(r.item_count),
        total_value_paisa: Number(r.total_value_paisa),
        undone_at: (r.undone_at as string | null) ?? null,
        undone_by_name: (r.undone_by_name as string | null) ?? null,
        can_undo: !!isLast && block == null,
        undo_block: isLast ? block : 'not_last',
      };
    });
  }

  batch(id: string) {
    const b = this.batches().find((x) => x.id === id);
    if (!b) return null;
    const lines = this.raw
      .prepare(
        `SELECT l.*, p.barcode, p.price_paisa FROM opening_stock_lines l LEFT JOIN products p ON p.id = l.product_id
          WHERE l.batch_id = ? ORDER BY l.sort`,
      )
      .all(id) as Array<Record<string, unknown>>;
    return {
      ...b,
      lines: lines.map((l) => ({
        product_id: String(l.product_id),
        name: String(l.product_name),
        barcode: (l.barcode as string | null) ?? null,
        unit_label: String(l.unit_label),
        mode: String(l.mode),
        packs: l.packs == null ? null : Number(l.packs),
        pack_units: l.pack_units == null ? null : Number(l.pack_units),
        pack_name: (l.pack_name as string | null) ?? null,
        qty: Number(l.qty),
        cost_paisa: l.cost_paisa == null ? null : Number(l.cost_paisa),
        value_paisa: Number(l.value_paisa),
        price_paisa: l.price_paisa == null ? null : Number(l.price_paisa),
        added: Number(l.added) === 1,
        qty_before: Number(l.qty_before),
        qty_after: Number(l.qty_after),
      })),
    };
  }

  /** Why the batch cannot be undone, or null. Anything that touched its items since blocks it. */
  private undoBlock(batchId: string): string | null {
    const b = this.raw.prepare(`SELECT posted_at, undone_at, marks_json FROM opening_stock_batches WHERE id = ?`).get(batchId) as { posted_at: string; undone_at: string | null; marks_json: string | null } | undefined;
    if (!b) return 'not_found';
    if (b.undone_at) return 'already_undone';
    const marks = (() => {
      try {
        return JSON.parse(String(b.marks_json ?? '{}')) as Record<string, number>;
      } catch {
        return {} as Record<string, number>;
      }
    })();
    const ids = `(SELECT product_id FROM opening_stock_lines WHERE batch_id = @id)`;
    const m = (t: string) => Number(marks[t] ?? 0);
    const q = (sql: string, extra: Record<string, number> = {}) => !!this.raw.prepare(sql).get({ id: batchId, ...extra });
    if (q(`SELECT 1 FROM sale_lines WHERE rowid > @m AND product_id IN ${ids} LIMIT 1`, { m: m('sale_lines') })) return 'sold_since';
    if (q(`SELECT 1 FROM stock_receives WHERE rowid > @m AND product_id IN ${ids} LIMIT 1`, { m: m('stock_receives') })) return 'bought_since';
    if (q(`SELECT 1 FROM purchase_lines WHERE rowid > @m AND product_id IN ${ids} LIMIT 1`, { m: m('purchase_lines') })) return 'bought_since';
    if (q(`SELECT 1 FROM sale_return_lines WHERE rowid > @m AND product_id IN ${ids} LIMIT 1`, { m: m('sale_return_lines') })) return 'returned_since';
    if (q(`SELECT 1 FROM repack_lines WHERE rowid > @m AND product_id IN ${ids} LIMIT 1`, { m: m('repack_lines') })) return 'repacked_since';
    if (q(`SELECT 1 FROM repacks WHERE rowid > @m AND bulk_product_id IN ${ids} LIMIT 1`, { m: m('repacks') })) return 'repacked_since';
    if (q(`SELECT 1 FROM supplier_return_lines WHERE rowid > @m AND product_id IN ${ids} LIMIT 1`, { m: m('supplier_return_lines') })) return 'bought_since';
    if (q(`SELECT 1 FROM stock_adjustments a WHERE a.rowid > @m AND a.product_id IN ${ids}
             AND a.id NOT IN (SELECT adjustment_id FROM opening_stock_lines WHERE batch_id = @id AND adjustment_id IS NOT NULL) LIMIT 1`, { m: m('stock_adjustments') })) return 'stock_changed_since';
    // Belt and braces: stock must still be what the batch left.
    if (q(`SELECT 1 FROM opening_stock_lines l LEFT JOIN stock_balances s ON s.product_id = l.product_id
            WHERE l.batch_id = @id AND ABS(COALESCE(s.qty_on_hand, 0) - l.qty_after) > 0.0005 LIMIT 1`)) return 'stock_changed_since';
    return null;
  }

  undo(batchId: string, input: { userId: string; storeId?: string | null }) {
    const list = this.batches();
    const b = list.find((x) => x.id === batchId);
    if (!b) return { ok: false as const, error: 'not_found' };
    if (!b.can_undo) return { ok: false as const, error: b.undo_block ?? 'cannot_undo' };
    const lines = this.raw.prepare(`SELECT * FROM opening_stock_lines WHERE batch_id = ? ORDER BY sort`).all(batchId) as Array<{
      product_id: string; qty: number; qty_before: number; qty_after: number; cost_before: number | null; cost_after: number | null; cost_paisa: number | null; mode: string; packs: number | null; pack_units: number | null; pack_name: string | null;
    }>;
    this.raw.transaction(() => {
      const adj = this.raw.prepare(
        `INSERT INTO stock_adjustments (id, product_id, delta_pieces, qty_before, qty_after, reason, created_by, note, unit_cost_paisa)
         VALUES (?, ?, ?, ?, ?, 'opening', ?, ?, ?)`,
      );
      for (const l of lines) {
        const delta = r3(Number(l.qty_before) - Number(l.qty_after));
        if (delta !== 0) adj.run(randomUUID(), l.product_id, delta, l.qty_after, l.qty_before, input.userId, `Opening stock #${b.number} undone`, l.cost_paisa);
        this.raw.prepare(`UPDATE stock_balances SET qty_on_hand = ?, updated_at = datetime('now') WHERE product_id = ?`).run(l.qty_before, l.product_id);
        this.raw.prepare(`UPDATE products SET last_unit_cost_paisa = ?, updated_at = datetime('now') WHERE id = ? AND last_unit_cost_paisa IS ?`).run(l.cost_before, l.product_id, l.cost_after);
        // Back into the draft so it can be fixed and posted again.
        this.raw
          .prepare(
            `INSERT INTO opening_stock_drafts (product_id, mode, qty, packs, pack_units, pack_name, cost_paisa, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(product_id) DO NOTHING`,
          )
          .run(l.product_id, l.mode === 'pack' ? 'pack' : 'base', l.qty, l.packs, l.pack_units, l.pack_name, l.cost_paisa, input.userId);
      }
      this.raw.prepare(`UPDATE opening_stock_batches SET undone_at = datetime('now'), undone_by = ? WHERE id = ?`).run(input.userId, batchId);
      writeAudit(this.raw, {
        action: 'opening_stock.undo',
        userId: input.userId,
        storeId: input.storeId ?? null,
        subjectType: 'opening_stock',
        subjectId: batchId,
        payload: { name: `Opening stock #${b.number}`, items: lines.length, total_paisa: b.total_value_paisa, note: `${lines.length} items back in the draft` },
      });
    })();
    return { ok: true as const, batch: this.batch(batchId) };
  }

  exportBatch(id: string): { file: Buffer; filename: string } | null {
    const b = this.batch(id);
    if (!b) return null;
    const unit = (u: string) => (allowsFraction(u) ? u : 'pcs');
    const rows: Cell[][] = [['Product', 'Barcode', 'Unit', 'Qty', 'Entered as', 'Cost per unit (Rs)', 'Value (Rs)', 'Sell price (Rs)', 'Stock before', 'Stock after', 'Added to existing']];
    for (const l of b.lines) {
      rows.push([
        l.name,
        l.barcode ?? '',
        unit(l.unit_label),
        l.qty,
        l.mode === 'pack' && l.packs != null ? `${l.packs} ${l.pack_name ?? 'Carton'} × ${l.pack_units}` : '',
        l.cost_paisa == null ? '' : l.cost_paisa / 100,
        l.value_paisa / 100,
        l.price_paisa == null ? '' : l.price_paisa / 100,
        l.qty_before,
        l.qty_after,
        l.added ? 'Yes' : '',
      ]);
    }
    rows.push([]);
    rows.push(['Total', '', '', '', '', '', b.total_value_paisa / 100]);
    rows.push([`Opening stock #${b.number}`, ymdHm(b.posted_at), b.posted_by_name ?? '', `${b.item_count} items`]);
    return {
      file: writeXlsx([{ name: `Opening stock ${b.number}`, rows, widths: [38, 16, 8, 10, 18, 16, 14, 14, 12, 12, 16], textCols: [1] }]),
      filename: `opening-stock-${b.number}.xlsx`,
    };
  }
}
