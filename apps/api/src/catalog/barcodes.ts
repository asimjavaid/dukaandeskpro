import type BetterSqlite3 from 'better-sqlite3';
import { normalizeSuppliedBarcode } from './ean13';

/** Most extra barcodes one product can hold (maker codes, old stickers, carton-free variants). */
export const MAX_EXTRA_BARCODES = 20;

/** Who already uses this code: a product's primary, a product's extra, or a pack. */
export function barcodeOwner(
  db: BetterSqlite3.Database,
  code: string,
): { productId: string; kind: 'primary' | 'extra' | 'pack' } | null {
  const p = db.prepare(`SELECT id FROM products WHERE barcode = ?`).get(code) as { id: string } | undefined;
  if (p) return { productId: p.id, kind: 'primary' };
  const x = db.prepare(`SELECT product_id FROM product_barcodes WHERE barcode = ?`).get(code) as { product_id: string } | undefined;
  if (x) return { productId: x.product_id, kind: 'extra' };
  const k = db.prepare(`SELECT product_id FROM product_packs WHERE barcode = ? AND active = 1`).get(code) as { product_id: string } | undefined;
  if (k) return { productId: k.product_id, kind: 'pack' };
  return null;
}

/** Input list → trimmed, de-duplicated codes. Not an array / bad code → invalid_barcode. */
export function parseExtraBarcodes(raw: unknown): { ok: true; codes: string[] } | { ok: false; error: 'invalid_barcode' | 'too_many_barcodes' } {
  if (raw == null) return { ok: true, codes: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'invalid_barcode' };
  const out: string[] = [];
  for (const r of raw) {
    const n = normalizeSuppliedBarcode(String(r ?? ''));
    if (!n.ok) return { ok: false, error: 'invalid_barcode' };
    if (n.value && !out.includes(n.value)) out.push(n.value);
  }
  if (out.length > MAX_EXTRA_BARCODES) return { ok: false, error: 'too_many_barcodes' };
  return { ok: true, codes: out };
}

/**
 * Replace a product's extra barcodes. The primary is dropped from the list; a code used by any other
 * product (primary, extra or pack) fails with duplicate_barcode. Call inside the caller's transaction.
 */
export function setExtraBarcodes(
  db: BetterSqlite3.Database,
  productId: string,
  codes: string[],
  primary: string | null,
): { ok: true } | { ok: false; error: 'duplicate_barcode'; barcode: string } {
  const want = codes.filter((c) => c !== primary);
  for (const c of want) {
    const o = barcodeOwner(db, c);
    // Free, or already one of this product's extras. Primaries and pack codes never double as extras.
    if (o && (o.productId !== productId || o.kind !== 'extra')) return { ok: false, error: 'duplicate_barcode', barcode: c };
  }
  const have = (db.prepare(`SELECT barcode FROM product_barcodes WHERE product_id = ?`).all(productId) as { barcode: string }[]).map((r) => r.barcode);
  const del = db.prepare(`DELETE FROM product_barcodes WHERE product_id = ? AND barcode = ?`);
  for (const c of have) if (!want.includes(c)) del.run(productId, c);
  const ins = db.prepare(`INSERT INTO product_barcodes (barcode, product_id) VALUES (?, ?)`);
  for (const c of want) if (!have.includes(c)) ins.run(c, productId);
  return { ok: true };
}

/** SQL piece: product row's extra barcodes as a JSON array (oldest first). */
export const EXTRA_BARCODES_SQL = `(SELECT json_group_array(barcode) FROM (SELECT barcode FROM product_barcodes WHERE product_id = p.id ORDER BY created_at, rowid)) AS extra_barcodes_json`;

