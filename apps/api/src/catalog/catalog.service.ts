import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ListPage } from '../common/list-page';
import { DbService } from '../db/db.service';
import { StockService } from '../stock/stock.service';
import {
  type DiscountInput,
  type DiscountView,
  type StoredDiscount,
  discountView,
  parseDiscountInput,
} from './discount';
import { inStoreEan13, normalizeSuppliedBarcode } from './ean13';
import { sizeName } from './size-names';
import { barcodeOwner, EXTRA_BARCODES_SQL, parseExtraBarcodes, setExtraBarcodes } from './barcodes';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  IMAGE_FILE_RE,
  decodeImagePayload,
  newImageFileName,
  productImagesDir,
  removeImageFile,
  writeImageFile,
} from './product-images';

export const PRODUCT_UNITS = [
  'piece',
  'dozen',
  'pair',
  'packet',
  'box',
  'carton',
  'bottle',
  'can',
  'jar',
  'tin',
  'tube',
  'bar',
  'sachet',
  'strip',
  'tray',
  'roll',
  'bundle',
  'bag',
  'kg',
  'gram',
  'litre',
  'ml',
  'meter',
  'foot',
] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

function parseUnitLabel(
  raw: string | undefined,
  fallback: ProductUnit,
):
  | { ok: true; unit: ProductUnit }
  | { ok: false; error: 'invalid_unit_label' } {
  if (raw == null || raw.trim() === '') return { ok: true, unit: fallback };
  const value = raw.trim().toLowerCase();
  if (!(PRODUCT_UNITS as readonly string[]).includes(value)) {
    return { ok: false, error: 'invalid_unit_label' };
  }
  return { ok: true, unit: value as ProductUnit };
}

/** Markup % input -> basis points. Blank/null clears (shop default). */
function parseMarkup(raw: unknown): { ok: true; bp: number | null } | { ok: false; error: 'invalid_markup' } {
  if (raw == null || String(raw).trim() === '') return { ok: true, bp: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1000) return { ok: false, error: 'invalid_markup' };
  return { ok: true, bp: Math.round(n * 100) };
}

/** Row as stored. Discount columns are raw (see discount.ts). */
type ProductDbRow = {
  id: string;
  sku: string | null;
  name: string;
  name_ur: string | null;
  unit_label: string;
  price_paisa: number;
  pieces_per_carton: number;
  last_unit_cost_paisa: number | null;
  barcode: string | null;
  image_file: string | null;
  reorder_level: number | null;
  size_group_id: string | null;
  size_qty: number | null;
  /** 1 = printed price (MRP); sale price is never auto-suggested. */
  fixed_price: number;
  /** normal | bulk (kg, bought in bags) | packed (repacked from bulk; repack_from_id + size_qty kg). */
  product_type: 'normal' | 'bulk' | 'packed';
  repack_from_id: string | null;
  /** carton | crate | piece for normal items (how they are bought); null = not set. */
  buy_unit: string | null;
  /** kg, carton, bottle … what it is bought in (null = worked out from buy_unit / unit). */
  buy_measure: string | null;
  /** Product markup in basis points; null = shop default. */
  markup_bp: number | null;
  active: number;
  qty_on_hand: number;
  discount_kind: string | null;
  discount_value: number | null;
  discount_start_at: string | null;
  discount_end_at: string | null;
  /** JSON array of extra barcodes (product_barcodes). */
  extra_barcodes_json?: string | null;
};

/**
 * Product as returned to clients. `price_paisa` is the normal piece price.
 * `effective_price_paisa` is what the till charges right now.
 */
export type ProductRow = Omit<
  ProductDbRow,
  'discount_kind' | 'discount_value' | 'discount_start_at' | 'discount_end_at' | 'extra_barcodes_json'
> &
  DiscountView & {
    /** Extra barcodes besides `barcode` (maker codes, old stickers). Any of them scans to this product. */
    extra_barcodes: string[];
  };

const PRODUCT_SELECT = `
  p.id, p.sku, p.name, p.name_ur, p.unit_label, p.price_paisa,
  p.pieces_per_carton, p.last_unit_cost_paisa, p.barcode, p.image_file, p.active, p.reorder_level,
  p.size_group_id, p.size_qty, p.fixed_price, p.markup_bp, p.product_type, p.repack_from_id, p.buy_unit, p.buy_measure,
  p.discount_kind, p.discount_value, p.discount_start_at, p.discount_end_at,
  COALESCE(sb.qty_on_hand, 0) AS qty_on_hand,
  ${EXTRA_BARCODES_SQL}
`;

function decorate(row: ProductDbRow, now: Date): ProductRow {
  const {
    discount_kind: _kind,
    discount_value: _value,
    discount_start_at: _start,
    discount_end_at: _end,
    extra_barcodes_json: xj,
    ...rest
  } = row;
  let extra: string[] = [];
  try {
    const v = xj ? JSON.parse(xj) : [];
    if (Array.isArray(v)) extra = v.map(String);
  } catch {
    /* none */
  }
  return { ...rest, extra_barcodes: extra, ...discountView(row, now) };
}

function storedDiscount(row: ProductDbRow): StoredDiscount {
  const kind =
    row.discount_kind === 'percent' || row.discount_kind === 'fixed'
      ? row.discount_kind
      : null;
  if (!kind) return { kind: null, value: null, startAt: null, endAt: null };
  return {
    kind,
    value: row.discount_value == null ? 0 : Math.round(row.discount_value),
    startAt: row.discount_start_at,
    endAt: row.discount_end_at,
  };
}

/** Thrown inside a transaction to roll it back when an extra barcode is taken. */
class DuplicateBarcode extends Error {}

function isUniqueConstraint(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? '';
  return code.startsWith('SQLITE_CONSTRAINT');
}

@Injectable()
export class CatalogService {
  private barcodesReady = false;

  constructor(
    private readonly db: DbService,
    private readonly stock: StockService,
  ) {}

  /**
   * Fill missing barcodes on first catalog read. Not in onModuleInit:
   * Nest calls that before DbService has opened SQLite.
   */
  private ensureBarcodes() {
    if (this.barcodesReady) return;
    this.backfillMissingBarcodes();
    this.barcodesReady = true;
  }

  /** Assign a unique in-store EAN-13 to every active product that has none (merged-away items gave theirs to the keeper). */
  backfillMissingBarcodes(): number {
    const tx = this.db.raw.transaction(() => {
      this.bumpSeqFromExisting();
      const rows = this.db.raw
        .prepare(
          `SELECT id FROM products
           WHERE active = 1 AND (barcode IS NULL OR TRIM(barcode) = '')`,
        )
        .all() as { id: string }[];
      const upd = this.db.raw.prepare(
        `UPDATE products SET barcode = ? WHERE id = ?`,
      );
      for (const row of rows) {
        upd.run(this.allocateBarcode(), row.id);
      }
      return rows.length;
    });
    return tx();
  }

  list(
    includeCost = false,
    query?: { q?: string; paging?: ListPage | null; types?: string[] | null },
  ): { items: ProductRow[]; total: number } {
    this.ensureBarcodes();
    const q = (query?.q ?? '').trim().toLowerCase().replace(/[%_]/g, '');
    const types = (query?.types ?? []).filter((x) => x === 'normal' || x === 'bulk' || x === 'packed');
    const typeSql = types.length ? ` AND p.product_type IN (${types.map(() => '?').join(', ')})` : '';
    const where = q
      ? `WHERE p.active = 1${typeSql} AND (
           lower(p.name) LIKE ? OR
           lower(COALESCE(p.name_ur, '')) LIKE ? OR
           lower(COALESCE(p.barcode, '')) LIKE ? OR
           EXISTS (SELECT 1 FROM product_barcodes xb WHERE xb.product_id = p.id AND lower(xb.barcode) LIKE ?)
         )`
      : `WHERE p.active = 1${typeSql}`;
    const likeArgs = [...types, ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [])];
    const totalRow = this.db.raw
      .prepare(`SELECT COUNT(*) AS c FROM products p ${where}`)
      .get(...likeArgs) as { c: number };
    let sql = `SELECT ${PRODUCT_SELECT}
         FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id
         ${where}
         ORDER BY p.name ASC`;
    const args: Array<string | number> = [...likeArgs];
    const paging = query?.paging;
    if (paging) {
      sql += ' LIMIT ? OFFSET ?';
      args.push(paging.pageSize, (paging.page - 1) * paging.pageSize);
    }
    const now = new Date();
    const rows = (this.db.raw.prepare(sql).all(...args) as ProductDbRow[]).map(
      (row) => decorate(row, now),
    );
    const items = includeCost ? rows : rows.map((row) => this.hideCost(row));
    return { items, total: Number(totalRow?.c ?? 0) };
  }

  findByBarcode(
    raw: string,
    includeCost: boolean,
  ):
    | { ok: true; product: ProductRow }
    | { ok: false; error: 'barcode_not_found' } {
    this.ensureBarcodes();
    const code = (raw ?? '').trim();
    if (!code) return { ok: false, error: 'barcode_not_found' };
    const row = this.db.raw
      .prepare(
        `SELECT ${PRODUCT_SELECT}
         FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id
         WHERE p.active = 1 AND (p.barcode = ? OR p.id IN (SELECT product_id FROM product_barcodes WHERE barcode = ?))
         ORDER BY CASE WHEN p.barcode = ? THEN 0 ELSE 1 END
         LIMIT 1`,
      )
      .get(code, code, code) as ProductDbRow | undefined;
    if (!row) return { ok: false, error: 'barcode_not_found' };
    const product = decorate(row, new Date());
    return { ok: true, product: includeCost ? product : this.hideCost(product) };
  }

  create(input: {
    name: string;
    pricePaisa?: number;
    priceRs?: number;
    /** Ignored. Not a carton sell mode. Use unitLabel. */
    unit?: string;
    /** Measure label. Defaults to piece. Not a second sell mode. */
    unitLabel?: string;
    piecesPerCarton?: number;
    barcode?: string | null;
    /** Extra barcodes (any of them scans to this product). */
    extraBarcodes?: unknown;
    /** Optional discount overlay. Omitted or null = no discount. */
    discount?: DiscountInput | null;
    fixedPrice?: boolean;
    markupPct?: number | string | null;
  }):
    | { ok: true; product: ProductRow }
    | { ok: false; error: string } {
    const name = sizeName((input.name ?? '').trim());
    if (!name || name.length > 160) {
      return { ok: false, error: 'invalid_name' };
    }

    const price = this.parsePrice(input.pricePaisa, input.priceRs, 0);
    if (!price.ok) return price;

    // New products default to piece. Existing rows are not rewritten.
    const unit = parseUnitLabel(input.unitLabel, 'piece');
    if (!unit.ok) return unit;

    const discount = parseDiscountInput(input.discount, price.pricePaisa);
    if (!discount.ok) return discount;
    const d = discount.discount;
    const markupNew = parseMarkup(input.markupPct);
    if (!markupNew.ok) return markupNew;

    const supplied = normalizeSuppliedBarcode(input.barcode ?? '');
    if (!supplied.ok) return supplied;
    const extras = parseExtraBarcodes(input.extraBarcodes);
    if (!extras.ok) return extras;
    this.ensureBarcodes();

    const id = randomUUID();
    const createTx = this.db.raw.transaction(() => {
      const barcode = supplied.value ?? this.allocateBarcode();
      if (this.barcodeTaken(barcode, null)) return 'duplicate' as const;
      try {
        this.db.raw
          .prepare(
            `INSERT INTO products
               (id, name, unit_label, price_paisa, pieces_per_carton, barcode, active,
                discount_kind, discount_value, discount_start_at, discount_end_at)
             VALUES (?, ?, ?, ?, 1, ?, 1, ?, ?, ?, ?)`,
          )
          .run(
            id,
            name,
            unit.unit,
            price.pricePaisa,
            barcode,
            d.kind,
            d.value,
            d.startAt,
            d.endAt,
          );
      } catch (err) {
        if (isUniqueConstraint(err)) return 'duplicate' as const;
        throw err;
      }
      if (extras.codes.length) {
        const x = setExtraBarcodes(this.db.raw, id, extras.codes, barcode);
        if (!x.ok) throw new DuplicateBarcode();
      }
      this.stock.ensureBalance(id);
      this.db.raw
        .prepare(`UPDATE products SET fixed_price = ?, markup_bp = ? WHERE id = ?`)
        .run(input.fixedPrice ? 1 : 0, markupNew.bp, id);
      return 'ok' as const;
    });
    let outcome: 'ok' | 'duplicate';
    try {
      outcome = createTx();
    } catch (err) {
      if (err instanceof DuplicateBarcode) outcome = 'duplicate';
      else throw err;
    }

    if (outcome === 'duplicate') {
      return { ok: false, error: 'duplicate_barcode' };
    }
    return { ok: true, product: this.byId(id) };
  }

  /** Selling-price changes, newest first. */
  priceHistory(productId: string, limit = 50) {
    return this.db.raw
      .prepare(
        `SELECT h.id, h.old_price_paisa, h.new_price_paisa, h.changed_at, u.display_name AS changed_by_name
         FROM price_history h LEFT JOIN users u ON u.id = h.changed_by
         WHERE h.product_id = ? ORDER BY h.changed_at DESC LIMIT ?`,
      )
      .all(productId, limit);
  }

  update(
    id: string,
    input: {
      name?: string;
      pricePaisa?: number;
      priceRs?: number;
      barcode?: string | null;
      barcodeProvided: boolean;
      /** Full list of extra barcodes (replaces the stored list). */
      extraBarcodes?: unknown;
      extraBarcodesProvided?: boolean;
      unitLabel?: string;
      unitLabelProvided: boolean;
      /** null or kind 'none' clears it. */
      discount?: DiscountInput | null;
      /** False keeps the stored discount (still re-checked against a new price). */
      discountProvided?: boolean;
      /** Reorder level in the product's unit (null clears). */
      reorderLevel?: number | string | null;
      reorderLevelProvided?: boolean;
      fixedPrice?: boolean;
      fixedPriceProvided?: boolean;
      markupPct?: number | string | null;
      markupProvided?: boolean;
      userId?: string | null;
    },
  ):
    | { ok: true; product: ProductRow }
    | { ok: false; error: string } {
    this.ensureBarcodes();
    const existing = this.byIdOrNull(id);
    if (!existing || existing.active !== 1) {
      return { ok: false, error: 'product_not_found' };
    }

    let name = existing.name;
    if (input.name != null) {
      name = sizeName(input.name.trim());
      if (!name || name.length > 160) {
        return { ok: false, error: 'invalid_name' };
      }
    }

    let pricePaisa = existing.price_paisa;
    if (input.pricePaisa != null || input.priceRs != null) {
      const price = this.parsePrice(input.pricePaisa, input.priceRs, pricePaisa);
      if (!price.ok) return price;
      pricePaisa = price.pricePaisa;
    }

    const stored = parseUnitLabel(existing.unit_label, 'piece');
    const unit = input.unitLabelProvided
      ? parseUnitLabel(input.unitLabel, 'piece')
      : stored.ok
        ? stored
        : { ok: true as const, unit: 'piece' as const };
    if (!unit.ok) return unit;

    let d: StoredDiscount;
    if (input.discountProvided) {
      const parsed = parseDiscountInput(input.discount, pricePaisa);
      if (!parsed.ok) return parsed;
      d = parsed.discount;
    } else {
      d = storedDiscount(existing);
      if (d.kind === 'fixed' && (d.value ?? 0) > pricePaisa) {
        return { ok: false, error: 'discount_exceeds_price' };
      }
    }

    let regenerate = false;
    let supplied: string | null = null;
    if (input.barcodeProvided) {
      if (input.barcode == null) {
        regenerate = true;
      } else {
        const norm = normalizeSuppliedBarcode(input.barcode);
        if (!norm.ok) return norm;
        if (norm.value == null) regenerate = true;
        else supplied = norm.value;
      }
    }

    let extras: string[] | null = null;
    if (input.extraBarcodesProvided) {
      const x = parseExtraBarcodes(input.extraBarcodes);
      if (!x.ok) return x;
      extras = x.codes;
    }

    let reorderLevel: number | null = null;
    if (input.reorderLevelProvided && input.reorderLevel != null && String(input.reorderLevel).trim() !== '') {
      const n = Math.round(Number(input.reorderLevel) * 1000) / 1000;
      if (!Number.isFinite(n) || n < 0 || n > 1e6) return { ok: false, error: 'invalid_reorder_level' };
      reorderLevel = n;
    }
    const markup = input.markupProvided ? parseMarkup(input.markupPct) : ({ ok: true, bp: existing.markup_bp } as const);
    if (!markup.ok) return markup;
    const updateTx = this.db.raw.transaction(() => {
      let barcode = existing.barcode;
      if (regenerate || !barcode) {
        barcode = this.allocateBarcode();
      } else if (supplied != null) {
        barcode = supplied;
      }
      if (!barcode) return 'invalid' as const;
      if (barcode !== existing.barcode && this.barcodeTaken(barcode, id)) {
        return 'duplicate' as const;
      }
      // Promoting one of its own extras to primary: drop it from the extras first.
      if (barcode !== existing.barcode) {
        this.db.raw.prepare(`DELETE FROM product_barcodes WHERE product_id = ? AND barcode = ?`).run(id, barcode);
      }
      try {
        this.db.raw
          .prepare(
            `UPDATE products
             SET name = ?, price_paisa = ?, unit_label = ?, barcode = ?,
                 discount_kind = ?, discount_value = ?,
                 discount_start_at = ?, discount_end_at = ?,
                 updated_at = datetime('now')
             WHERE id = ?`,
          )
          .run(
            name,
            pricePaisa,
            unit.unit,
            barcode,
            d.kind,
            d.value,
            d.startAt,
            d.endAt,
            id,
          );
      } catch (err) {
        if (isUniqueConstraint(err)) return 'duplicate' as const;
        throw err;
      }
      if (extras) {
        const x = setExtraBarcodes(this.db.raw, id, extras, barcode);
        if (!x.ok) throw new DuplicateBarcode();
      }
      if (input.reorderLevelProvided) {
        this.db.raw.prepare(`UPDATE products SET reorder_level = ? WHERE id = ?`).run(reorderLevel, id);
      }
      if (input.fixedPriceProvided || input.markupProvided) {
        const fixed = input.fixedPriceProvided ? (input.fixedPrice ? 1 : 0) : existing.fixed_price;
        this.db.raw.prepare(`UPDATE products SET fixed_price = ?, markup_bp = ? WHERE id = ?`).run(fixed, markup.bp, id);
      }
      // Price history rows come from a trigger; stamp who made the change.
      if (input.userId) {
        this.db.raw
          .prepare(`UPDATE price_history SET changed_by = ? WHERE product_id = ? AND changed_by IS NULL`)
          .run(input.userId, id);
      }
      return 'ok' as const;
    });
    let outcome: 'ok' | 'duplicate' | 'invalid';
    try {
      outcome = updateTx();
    } catch (err) {
      if (err instanceof DuplicateBarcode) outcome = 'duplicate';
      else throw err;
    }

    if (outcome === 'duplicate') {
      return { ok: false, error: 'duplicate_barcode' };
    }
    if (outcome === 'invalid') {
      return { ok: false, error: 'invalid_barcode' };
    }
    return { ok: true, product: this.byId(id) };
  }

  /**
   * First-run optional sample: one kiryana piece SKU with stock > 0.
   * Idempotent on sku DD-SAMPLE — skip leaves catalog blank.
   */
  createSample(receivedBy?: string):
    | { ok: true; product: ProductRow; created: boolean }
    | { ok: false; error: string } {
    const SAMPLE_SKU = 'DD-SAMPLE';
    this.ensureBarcodes();
    const existing = this.db.raw
      .prepare(
        `SELECT ${PRODUCT_SELECT}
         FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id
         WHERE p.sku = ? AND p.active = 1
         LIMIT 1`,
      )
      .get(SAMPLE_SKU) as ProductDbRow | undefined;
    if (existing) {
      if (!existing.barcode) this.backfillMissingBarcodes();
      const product = existing.barcode
        ? decorate(existing, new Date())
        : this.byId(existing.id);
      return { ok: true, product, created: false };
    }

    const id = randomUUID();
    const name = 'Lifebuoy Soap';
    const pricePaisa = 12000; // Rs 120
    const qty = 24;

    this.db.raw.transaction(() => {
      const barcode = this.allocateBarcode();
      this.db.raw
        .prepare(
          `INSERT INTO products
             (id, sku, name, unit_label, price_paisa, pieces_per_carton, barcode, active)
           VALUES (?, ?, ?, 'piece', ?, 1, ?, 1)`,
        )
        .run(id, SAMPLE_SKU, name, pricePaisa, barcode);
      this.stock.ensureBalance(id);
    })();
    const recv = this.stock.receive({
      productId: id,
      qty,
      unit: 'piece',
      receivedBy,
      note: 'first-run sample',
      allowMissingAmount: true,
    });
    if (!recv.ok) {
      return { ok: false, error: recv.error };
    }

    return { ok: true, product: this.byId(id), created: true };
  }

  private parsePrice(
    pricePaisaIn: number | undefined,
    priceRsIn: number | undefined,
    fallback: number,
  ):
    | { ok: true; pricePaisa: number }
    | { ok: false; error: 'invalid_price' } {
    let pricePaisa = fallback;
    if (pricePaisaIn != null) {
      pricePaisa = Math.round(Number(pricePaisaIn));
    } else if (priceRsIn != null) {
      pricePaisa = Math.round(Number(priceRsIn) * 100);
    }
    if (!Number.isFinite(pricePaisa) || pricePaisa < 0) {
      return { ok: false, error: 'invalid_price' };
    }
    return { ok: true, pricePaisa };
  }

  private hideCost(row: ProductRow): ProductRow {
    const copy = { ...row };
    delete (copy as { last_unit_cost_paisa?: number | null }).last_unit_cost_paisa;
    return copy;
  }

  private barcodeTaken(barcode: string, exceptId: string | null): boolean {
    const o = barcodeOwner(this.db.raw, barcode);
    if (o && o.productId !== exceptId) return true;
    const row = this.db.raw
      .prepare(
        exceptId
          ? `SELECT id FROM products WHERE barcode = ? AND id != ?`
          : `SELECT id FROM products WHERE barcode = ?`,
      )
      .get(...(exceptId ? [barcode, exceptId] : [barcode])) as
      | { id: string }
      | undefined;
    return Boolean(row);
  }

  /** Keep the counter above any in-store codes already stored (prefix 20). */
  private bumpSeqFromExisting() {
    const rows = this.db.raw
      .prepare(`SELECT barcode FROM products WHERE barcode IS NOT NULL`)
      .all() as { barcode: string }[];
    let max = 0;
    for (const row of rows) {
      const m = /^20(\d{10})\d$/.exec(row.barcode);
      if (!m) continue;
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
    const cur = this.db.raw
      .prepare(`SELECT next_n AS n FROM barcode_seq WHERE id = 1`)
      .get() as { n: number } | undefined;
    const next = cur?.n ?? 1;
    if (next <= max) {
      this.db.raw
        .prepare(`UPDATE barcode_seq SET next_n = ? WHERE id = 1`)
        .run(max + 1);
    }
  }

  /** Caller must be inside a transaction. Skips codes already on a product. */
  private allocateBarcode(): string {
    this.bumpSeqFromExisting();
    for (let attempt = 0; attempt < 10000; attempt++) {
      const row = this.db.raw
        .prepare(`SELECT next_n AS n FROM barcode_seq WHERE id = 1`)
        .get() as { n: number };
      const n = row.n;
      if (!Number.isInteger(n) || n < 0 || n > 9_999_999_999) {
        throw new Error('barcode_space_exhausted');
      }
      this.db.raw
        .prepare(`UPDATE barcode_seq SET next_n = ? WHERE id = 1`)
        .run(n + 1);
      const code = inStoreEan13(n);
      if (!this.barcodeTaken(code, null)) return code;
    }
    throw new Error('barcode_space_exhausted');
  }

  imagesDir(): string {
    return productImagesDir(this.db.dbPath);
  }

  /** Owner: set picture from a JPEG (already resized to 256px by the client). */
  setImage(
    id: string,
    payload: unknown,
  ): { ok: true; product: ProductRow } | { ok: false; error: string } {
    const row = this.byIdOrNull(id);
    if (!row) return { ok: false, error: 'product_not_found' };
    const data = decodeImagePayload(payload);
    if (!data) return { ok: false, error: 'invalid_image' };
    const dir = this.imagesDir();
    const file = newImageFileName(id);
    writeImageFile(dir, file, data);
    this.db.raw
      .prepare(`UPDATE products SET image_file = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(file, id);
    removeImageFile(dir, row.image_file);
    return { ok: true, product: this.byId(id) };
  }

  getProduct(id: string): ProductDbRow | undefined {
    return this.byIdOrNull(id);
  }

  /** Other active products in the same size group. */
  sizes(id: string): ProductRow[] {
    const row = this.byIdOrNull(id);
    if (!row?.size_group_id) return [];
    const ids = this.db.raw
      .prepare(`SELECT id FROM products WHERE size_group_id = ? AND id <> ? AND active = 1 ORDER BY size_qty DESC, name`)
      .all(row.size_group_id, id) as Array<{ id: string }>;
    return ids.map((r) => this.byId(r.id));
  }

  /** Link a product into another product's size group (or unlink with qty null). */
  linkSize(
    id: string,
    input: { withProductId?: string | null; qty?: number | string | null },
  ): { ok: true; product: ProductRow } | { ok: false; error: string } {
    const row = this.byIdOrNull(id);
    if (!row || row.active !== 1) return { ok: false, error: 'product_not_found' };
    if (input.qty == null || String(input.qty).trim() === '') {
      this.db.raw.prepare(`UPDATE products SET size_group_id = NULL, size_qty = NULL WHERE id = ?`).run(id);
      return { ok: true, product: this.byId(id) };
    }
    const qty = Math.round(Number(input.qty) * 1000) / 1000;
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e6) return { ok: false, error: 'invalid_size_qty' };
    let group = row.size_group_id;
    if (input.withProductId) {
      const other = this.byIdOrNull(String(input.withProductId));
      if (!other || other.active !== 1) return { ok: false, error: 'product_not_found' };
      group = other.size_group_id ?? other.id;
      if (!other.size_group_id) {
        this.db.raw
          .prepare(`UPDATE products SET size_group_id = ?, size_qty = COALESCE(size_qty, 1) WHERE id = ?`)
          .run(group, other.id);
      }
    }
    if (!group) group = row.id;
    this.db.raw.prepare(`UPDATE products SET size_group_id = ?, size_qty = ? WHERE id = ?`).run(group, qty, id);
    return { ok: true, product: this.byId(id) };
  }

  /**
   * New prices for the other sizes after this product's price becomes newPricePaisa:
   * per-unit = new / qty, each size = per-unit × its qty, rounded to whole Rs.
   */
  sizePricePlan(id: string, newPricePaisa: number) {
    const row = this.byIdOrNull(id);
    if (!row?.size_group_id || !(Number(row.size_qty) > 0)) return [];
    const perUnit = newPricePaisa / Number(row.size_qty);
    return this.sizes(id)
      .filter((p) => Number(p.size_qty) > 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        size_qty: Number(p.size_qty),
        old_price_paisa: p.price_paisa,
        new_price_paisa: Math.max(100, Math.round((perUnit * Number(p.size_qty)) / 100) * 100),
      }))
      .filter((x) => x.new_price_paisa !== x.old_price_paisa);
  }

  /** Apply sizePricePlan (price history via trigger, stamped with the user). */
  applySizePrices(id: string, newPricePaisa: number, userId: string | null) {
    const plan = this.sizePricePlan(id, newPricePaisa);
    const changed: typeof plan = [];
    for (const x of plan) {
      const r = this.update(x.id, { pricePaisa: x.new_price_paisa, barcodeProvided: false, unitLabelProvided: false, userId });
      if (r.ok) changed.push(x);
    }
    return changed;
  }

  /** Copy another product's photo (new size of the same item). */
  copyImage(id: string, fromId: string): { ok: true; product: ProductRow } | { ok: false; error: string } {
    const src = this.byIdOrNull(fromId);
    if (!src?.image_file || !IMAGE_FILE_RE.test(src.image_file)) return { ok: false, error: 'invalid_image' };
    let data: Buffer;
    try {
      data = fs.readFileSync(path.join(this.imagesDir(), src.image_file));
    } catch {
      return { ok: false, error: 'invalid_image' };
    }
    return this.setImage(id, data.toString('base64'));
  }

  removeImage(id: string): { ok: true; product: ProductRow } | { ok: false; error: string } {
    const row = this.byIdOrNull(id);
    if (!row) return { ok: false, error: 'product_not_found' };
    this.db.raw
      .prepare(`UPDATE products SET image_file = NULL, updated_at = datetime('now') WHERE id = ?`)
      .run(id);
    removeImageFile(this.imagesDir(), row.image_file);
    return { ok: true, product: this.byId(id) };
  }

  byId(id: string): ProductRow {
    const row = this.byIdOrNull(id);
    if (!row) throw new Error('product_missing');
    return decorate(row, new Date());
  }

  private byIdOrNull(id: string): ProductDbRow | undefined {
    return this.db.raw
      .prepare(
        `SELECT ${PRODUCT_SELECT}
         FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id
         WHERE p.id = ?`,
      )
      .get(id) as ProductDbRow | undefined;
  }
}
