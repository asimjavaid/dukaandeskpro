import { isMeasure } from '../catalog/measures';
import type BetterSqlite3 from 'better-sqlite3';

type Db = BetterSqlite3.Database;
type Row = Record<string, unknown>;

/** Batch 2 columns added to existing tables (migration 034). */
const COLS: Record<string, string[]> = {
  sales: ['digital_paisa', 'digital_method', 'digital_ref', 'subtotal_paisa', 'discount_paisa', 'discount_label', 'rounding_paisa'],
  sale_lines: ['pack_label', 'pack_qty', 'pack_size'],
  parties: ['credit_limit_paisa'],
  products: ['reorder_level'],
  purchase_lines: ['expiry_date', 'batch_no', 'batch_left'],
};
const STORE_COLS = ['round_to_paisa', 'cashier_discount_max_bp', 'credit_limit_mode', 'drawer_kick', 'expiry_alert_days'];

export type Batch2Bundle = {
  cols: Record<string, Row[]>;
  store: Row | null;
  price_history: Row[];
  supplier_returns: Row[];
  supplier_return_lines: Row[];
  /** Batch 3 (optional on older v7 copies). */
  loyalty?: { store: Row | null; sales: Row[]; ledger: Row[] };
  /** Linked sizes (v8; missing on older copies). */
  sizes?: Row[];
  /** Purchase orders (v9; missing on older copies). */
  orders?: { orders: Row[]; lines: Row[]; bill_links: Row[]; line_links: Row[] };
  /** Packs + repack (v10; missing on older copies). */
  repack?: { packs: Row[]; supplier_packs: Row[]; bill_packs: Row[]; links: Row[]; repacks: Row[]; lines: Row[] };
  /** Pricing (v11; missing on older copies → defaults). */
  pricing?: { store: Row | null; products: Row[]; bill_totals: Row[]; order_totals: Row[] };
  /** Product types (v12; missing on older copies → all Normal, sorter runs on next start). */
  types?: { store: Row | null; products: Row[]; review: Row[]; runs: Row[]; repack_packing: Row[] };
  /** v13: purchase package per product, package order lines, buy-units runs. */
  buying?: { products: Row[]; order_lines: Row[]; runs: Row[] };
  /** v14: bill delivery / extra charges and each line's landed share. */
  landed?: { invoices: Row[]; lines: Row[]; extras: Row[] };
  /** Purchase measures (optional; older copies come back with none and work them out). */
  measures?: { products: Row[]; bill_lines: Row[]; order_lines: Row[] };
  /** v15: extra barcodes per product (older copies restore with none). */
  barcodes?: Row[];
  /** v16: opening stock draft, posted batches and their lines (older copies restore with none). */
  opening?: { drafts: Row[]; batches: Row[]; lines: Row[] };
};

export function exportBatch2(db: Db): Batch2Bundle {
  const cols: Record<string, Row[]> = {};
  for (const [t, c] of Object.entries(COLS)) {
    cols[t] = db.prepare(`SELECT id, ${c.join(', ')} FROM ${t}`).all() as Row[];
  }
  return {
    cols,
    store: (db.prepare(`SELECT ${STORE_COLS.join(', ')} FROM store LIMIT 1`).get() as Row | undefined) ?? null,
    price_history: db.prepare(`SELECT * FROM price_history ORDER BY changed_at`).all() as Row[],
    supplier_returns: db.prepare(`SELECT * FROM supplier_returns ORDER BY created_at`).all() as Row[],
    supplier_return_lines: db.prepare(`SELECT * FROM supplier_return_lines`).all() as Row[],
    loyalty: {
      store: (db.prepare(`SELECT loyalty_enabled, loyalty_rs_per_point, loyalty_point_value_paisa FROM store LIMIT 1`).get() as Row | undefined) ?? null,
      sales: db.prepare(`SELECT id, loyalty_redeem_points, loyalty_redeem_paisa, loyalty_earned_points FROM sales
                         WHERE loyalty_redeem_points > 0 OR loyalty_earned_points > 0`).all() as Row[],
      ledger: db.prepare(`SELECT * FROM loyalty_ledger ORDER BY created_at`).all() as Row[],
    },
    sizes: db.prepare(`SELECT id, size_group_id, size_qty FROM products WHERE size_group_id IS NOT NULL`).all() as Row[],
    orders: {
      orders: db.prepare(`SELECT * FROM purchase_orders ORDER BY number`).all() as Row[],
      lines: db.prepare(`SELECT * FROM purchase_order_lines`).all() as Row[],
      bill_links: db.prepare(`SELECT id, purchase_order_id FROM purchase_invoices WHERE purchase_order_id IS NOT NULL`).all() as Row[],
      line_links: db.prepare(`SELECT id, order_line_id FROM purchase_lines WHERE order_line_id IS NOT NULL`).all() as Row[],
    },
    repack: {
      packs: db.prepare(`SELECT * FROM product_packs`).all() as Row[],
      supplier_packs: db.prepare(`SELECT * FROM supplier_product_pack`).all() as Row[],
      bill_packs: db.prepare(`SELECT id, pack_id, pack_name, pack_units, pack_qty FROM purchase_lines WHERE pack_name IS NOT NULL`).all() as Row[],
      links: db.prepare(`SELECT id, repack_from_id, size_qty FROM products WHERE repack_from_id IS NOT NULL`).all() as Row[],
      repacks: db.prepare(`SELECT * FROM repacks ORDER BY created_at`).all() as Row[],
      lines: db.prepare(`SELECT * FROM repack_lines`).all() as Row[],
    },
    pricing: {
      store: (db.prepare(`SELECT default_markup_bp, price_round_paisa, price_round_mode, min_margin_bp FROM store LIMIT 1`).get() as Row | undefined) ?? null,
      products: db.prepare(`SELECT id, fixed_price, markup_bp FROM products WHERE fixed_price = 1 OR markup_bp IS NOT NULL`).all() as Row[],
      bill_totals: db.prepare(`SELECT id, line_total_paisa FROM purchase_lines WHERE line_total_paisa IS NOT NULL`).all() as Row[],
      order_totals: db.prepare(`SELECT id, line_total_paisa FROM purchase_order_lines WHERE line_total_paisa IS NOT NULL`).all() as Row[],
    },
    types: {
      store: (db.prepare(`SELECT sell_bulk_loose FROM store LIMIT 1`).get() as Row | undefined) ?? null,
      products: db.prepare(`SELECT id, product_type, type_source FROM products WHERE product_type != 'normal' OR type_source IS NOT NULL`).all() as Row[],
      review: db.prepare(`SELECT * FROM product_type_review`).all() as Row[],
      runs: db.prepare(`SELECT * FROM product_type_runs ORDER BY ran_at`).all() as Row[],
      repack_packing: db.prepare(`SELECT id, packing_per_pack_paisa FROM repacks WHERE packing_per_pack_paisa IS NOT NULL`).all() as Row[],
    },
    buying: {
      products: db.prepare(`SELECT id, buy_unit, buy_unit_source FROM products WHERE buy_unit IS NOT NULL OR buy_unit_source IS NOT NULL`).all() as Row[],
      order_lines: db.prepare(`SELECT id FROM purchase_order_lines WHERE by_package = 1`).all() as Row[],
      runs: db.prepare(`SELECT * FROM buy_unit_runs ORDER BY ran_at`).all() as Row[],
    },
    measures: {
      products: db.prepare(`SELECT id, buy_measure FROM products WHERE buy_measure IS NOT NULL`).all() as Row[],
      bill_lines: db.prepare(`SELECT id, unit FROM purchase_lines WHERE unit IS NOT NULL`).all() as Row[],
      order_lines: db.prepare(`SELECT id, unit FROM purchase_order_lines WHERE unit IS NOT NULL`).all() as Row[],
    },
    barcodes: db.prepare(`SELECT barcode, product_id, created_at FROM product_barcodes ORDER BY product_id, created_at, rowid`).all() as Row[],
    opening: {
      drafts: db.prepare(`SELECT * FROM opening_stock_drafts ORDER BY product_id`).all() as Row[],
      batches: db.prepare(`SELECT * FROM opening_stock_batches ORDER BY number`).all() as Row[],
      lines: db.prepare(`SELECT * FROM opening_stock_lines ORDER BY batch_id, sort`).all() as Row[],
    },
    landed: {
      invoices: db.prepare(`SELECT id, extras_paisa, extras_owed_paisa FROM purchase_invoices WHERE extras_paisa > 0`).all() as Row[],
      lines: db.prepare(`SELECT id, extra_share_paisa FROM purchase_lines WHERE extra_share_paisa != 0`).all() as Row[],
      extras: db.prepare(`SELECT * FROM purchase_extras ORDER BY invoice_id, sort`).all() as Row[],
    },
  };
}

/** Wipe Batch 2 tables before the main restore deletes products / suppliers. */
export function wipeBatch2(db: Db): void {
  db.prepare(`DELETE FROM opening_stock_drafts`).run();
  db.prepare(`DELETE FROM opening_stock_lines`).run();
  db.prepare(`DELETE FROM opening_stock_batches`).run();
  db.prepare(`DELETE FROM product_barcodes`).run();
  db.prepare(`DELETE FROM product_type_review`).run();
  db.prepare(`DELETE FROM product_type_runs`).run();
  db.prepare(`DELETE FROM buy_unit_runs`).run();
  db.prepare(`DELETE FROM repack_lines`).run();
  db.prepare(`DELETE FROM repacks`).run();
  db.prepare(`DELETE FROM supplier_product_pack`).run();
  db.prepare(`DELETE FROM product_packs`).run();
  db.prepare(`UPDATE products SET repack_from_id = NULL WHERE repack_from_id IS NOT NULL`).run();
  db.prepare(`UPDATE purchase_lines SET order_line_id = NULL WHERE order_line_id IS NOT NULL`).run();
  db.prepare(`UPDATE purchase_invoices SET purchase_order_id = NULL WHERE purchase_order_id IS NOT NULL`).run();
  db.prepare(`DELETE FROM purchase_order_lines`).run();
  db.prepare(`DELETE FROM purchase_orders`).run();
  db.prepare(`DELETE FROM loyalty_ledger`).run();
  db.prepare(`DELETE FROM supplier_return_lines`).run();
  db.prepare(`DELETE FROM supplier_returns`).run();
  db.prepare(`DELETE FROM price_history`).run();
}

const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const txt = (v: unknown) => (v == null ? null : String(v));

/** After the main restore: put Batch 2 columns and tables back (v7 copies). */
export function restoreBatch2(db: Db, b: Batch2Bundle | undefined | null): void {
  if (!b || typeof b !== 'object') return;
  for (const [t, c] of Object.entries(COLS)) {
    const rows = Array.isArray(b.cols?.[t]) ? b.cols[t] : [];
    const st = db.prepare(`UPDATE ${t} SET ${c.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`);
    for (const r of rows) {
      const vals = c.map((x) => {
        const v = r[x];
        if (x === 'digital_paisa' || x === 'discount_paisa' || x === 'rounding_paisa') return Math.round(num(v) ?? 0);
        if (x === 'digital_method') return ['jazzcash', 'easypaisa', 'bank'].includes(String(v)) ? String(v) : null;
        if (x.endsWith('_paisa') || x.endsWith('_qty') || x.endsWith('_size') || x === 'reorder_level' || x === 'batch_left') return num(v);
        return txt(v);
      });
      try {
        st.run(...vals, String(r.id));
      } catch {
        /* a value the schema refuses: keep the default */
      }
    }
  }
  if (b.store) {
    const s = b.store;
    const round = [0, 100, 500, 1000].includes(Number(s.round_to_paisa)) ? Number(s.round_to_paisa) : 0;
    const bp = Math.min(10000, Math.max(0, Math.round(Number(s.cashier_discount_max_bp) || 0)));
    const mode = s.credit_limit_mode === 'block' ? 'block' : 'warn';
    const days = Math.min(365, Math.max(1, Math.floor(Number(s.expiry_alert_days) || 30)));
    db.prepare(
      `UPDATE store SET round_to_paisa = ?, cashier_discount_max_bp = ?, credit_limit_mode = ?, drawer_kick = ?, expiry_alert_days = ?`,
    ).run(round, bp, mode, Number(s.drawer_kick) === 1 ? 1 : 0, days);
  }
  const has = (t: string, id: unknown) => !!db.prepare(`SELECT 1 FROM ${t} WHERE id = ?`).get(String(id ?? ''));
  const insPh = db.prepare(
    `INSERT OR IGNORE INTO price_history (id, product_id, old_price_paisa, new_price_paisa, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const r of Array.isArray(b.price_history) ? b.price_history : []) {
    if (!has('products', r.product_id)) continue;
    insPh.run(String(r.id), String(r.product_id), Math.round(num(r.old_price_paisa) ?? 0), Math.round(num(r.new_price_paisa) ?? 0),
      has('users', r.changed_by) ? String(r.changed_by) : null, String(r.changed_at ?? new Date().toISOString()));
  }
  const insR = db.prepare(
    `INSERT OR IGNORE INTO supplier_returns (id, short_id, supplier_id, total_paisa, note, returned_on, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ids = new Set<string>();
  for (const r of Array.isArray(b.supplier_returns) ? b.supplier_returns : []) {
    if (!has('suppliers', r.supplier_id) || !(Number(r.total_paisa) > 0)) continue;
    insR.run(String(r.id), String(r.short_id ?? ''), String(r.supplier_id), Math.round(Number(r.total_paisa)), txt(r.note),
      String(r.returned_on ?? ''), has('users', r.created_by) ? String(r.created_by) : null, String(r.created_at ?? new Date().toISOString()));
    ids.add(String(r.id));
  }
  const insL = db.prepare(
    `INSERT OR IGNORE INTO supplier_return_lines (id, return_id, product_id, product_name, qty, unit_cost_paisa, line_total_paisa)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const l of Array.isArray(b.supplier_return_lines) ? b.supplier_return_lines : []) {
    if (!ids.has(String(l.return_id)) || !has('products', l.product_id) || !(Number(l.qty) > 0)) continue;
    insL.run(String(l.id), String(l.return_id), String(l.product_id), String(l.product_name ?? ''), Math.round(Number(l.qty) * 1000) / 1000,
      Math.max(0, Math.round(Number(l.unit_cost_paisa) || 0)), Math.max(0, Math.round(Number(l.line_total_paisa) || 0)));
  }
  const L = b.loyalty;
  if (L && typeof L === 'object') {
    if (L.store) {
      const clamp = (v: unknown, d: number) => Math.min(100000, Math.max(1, Math.round(Number(v) || d)));
      db.prepare(`UPDATE store SET loyalty_enabled = ?, loyalty_rs_per_point = ?, loyalty_point_value_paisa = ?`).run(
        Number(L.store.loyalty_enabled) === 1 ? 1 : 0, clamp(L.store.loyalty_rs_per_point, 100), clamp(L.store.loyalty_point_value_paisa, 100));
    }
    const nn = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
    const st = db.prepare(`UPDATE sales SET loyalty_redeem_points = ?, loyalty_redeem_paisa = ?, loyalty_earned_points = ? WHERE id = ?`);
    for (const r of Array.isArray(L.sales) ? L.sales : []) st.run(nn(r.loyalty_redeem_points), nn(r.loyalty_redeem_paisa), nn(r.loyalty_earned_points), String(r.id));
    const ins = db.prepare(`INSERT OR IGNORE INTO loyalty_ledger (id, party_id, sale_id, points, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const r of Array.isArray(L.ledger) ? L.ledger : []) {
      if (!has('parties', r.party_id) || !['earn', 'redeem', 'reverse', 'return'].includes(String(r.kind))) continue;
      ins.run(String(r.id), String(r.party_id), has('sales', r.sale_id) ? String(r.sale_id) : null, Math.round(Number(r.points) || 0),
        String(r.kind), txt(r.note), String(r.created_at ?? new Date().toISOString()));
    }
  }
  if (Array.isArray(b.sizes)) {
    const st = db.prepare(`UPDATE products SET size_group_id = ?, size_qty = ? WHERE id = ?`);
    for (const r of b.sizes) {
      const q = num(r.size_qty);
      if (!r.size_group_id || q == null || !(q > 0)) continue;
      st.run(String(r.size_group_id), q, String(r.id));
    }
  }
  const O = b.orders;
  if (O && typeof O === 'object') {
    const okStatus = ['draft', 'sent', 'partial', 'received', 'cancelled'];
    const insO = db.prepare(
      `INSERT OR IGNORE INTO purchase_orders (id, number, supplier_id, status, note, sent_at, closed_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const orderIds = new Set<string>();
    for (const r of Array.isArray(O.orders) ? O.orders : []) {
      if (!has('suppliers', r.supplier_id) || !(Number(r.number) > 0)) continue;
      const now = new Date().toISOString();
      const res = insO.run(String(r.id), Math.floor(Number(r.number)), String(r.supplier_id),
        okStatus.includes(String(r.status)) ? String(r.status) : 'draft', txt(r.note), txt(r.sent_at), txt(r.closed_at),
        has('users', r.created_by) ? String(r.created_by) : null, String(r.created_at ?? now), String(r.updated_at ?? now));
      if (res.changes) orderIds.add(String(r.id));
    }
    const insL = db.prepare(
      `INSERT OR IGNORE INTO purchase_order_lines (id, order_id, product_id, qty_ordered, qty_received, expected_cost_paisa, sort,
         pack_id, pack_name, pack_units, pack_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const lineIds = new Set<string>();
    for (const l of Array.isArray(O.lines) ? O.lines : []) {
      if (!orderIds.has(String(l.order_id)) || !has('products', l.product_id) || !(Number(l.qty_ordered) > 0)) continue;
      const c = num(l.expected_cost_paisa);
      insL.run(String(l.id), String(l.order_id), String(l.product_id), Number(l.qty_ordered), Math.max(0, num(l.qty_received) ?? 0),
        c == null ? null : Math.max(0, Math.round(c)), Math.floor(num(l.sort) ?? 0),
        txt(l.pack_id), txt(l.pack_name), num(l.pack_units), num(l.pack_qty));
      lineIds.add(String(l.id));
    }
    const upB = db.prepare(`UPDATE purchase_invoices SET purchase_order_id = ? WHERE id = ?`);
    for (const r of Array.isArray(O.bill_links) ? O.bill_links : []) {
      if (orderIds.has(String(r.purchase_order_id))) upB.run(String(r.purchase_order_id), String(r.id));
    }
    const upL = db.prepare(`UPDATE purchase_lines SET order_line_id = ? WHERE id = ?`);
    for (const r of Array.isArray(O.line_links) ? O.line_links : []) {
      if (lineIds.has(String(r.order_line_id))) upL.run(String(r.order_line_id), String(r.id));
    }
  }
  const P = b.repack;
  if (!P || typeof P !== 'object') {
    // Older copy: rebuild Carton packs from the old carton size.
    db.prepare(
      `INSERT INTO product_packs (id, product_id, name, units, sort)
       SELECT lower(hex(randomblob(16))), id, 'Carton', pieces_per_carton, 0 FROM products WHERE pieces_per_carton > 1`,
    ).run();
  }
  if (P && typeof P === 'object') {
    const arr = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
    const insP = db.prepare(`INSERT OR IGNORE INTO product_packs (id, product_id, name, units, barcode, active, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of arr(P.packs)) {
      if (!has('products', r.product_id) || !(Number(r.units) > 0)) continue;
      insP.run(String(r.id), String(r.product_id), String(r.name ?? 'Carton').slice(0, 30), Number(r.units), txt(r.barcode),
        Number(r.active) === 0 ? 0 : 1, Math.floor(num(r.sort) ?? 0), String(r.created_at ?? new Date().toISOString()));
    }
    const insS = db.prepare(`INSERT OR IGNORE INTO supplier_product_pack (supplier_id, product_id, pack_id, pack_units, last_cost_paisa, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const r of arr(P.supplier_packs)) {
      if (!has('suppliers', r.supplier_id) || !has('products', r.product_id)) continue;
      insS.run(String(r.supplier_id), String(r.product_id), has('product_packs', r.pack_id) ? String(r.pack_id) : null, num(r.pack_units),
        num(r.last_cost_paisa), String(r.updated_at ?? new Date().toISOString()));
    }
    const upB = db.prepare(`UPDATE purchase_lines SET pack_id = ?, pack_name = ?, pack_units = ?, pack_qty = ? WHERE id = ?`);
    for (const r of arr(P.bill_packs)) upB.run(txt(r.pack_id), txt(r.pack_name), num(r.pack_units), num(r.pack_qty), String(r.id));
    const upL = db.prepare(`UPDATE products SET repack_from_id = ?, size_qty = ? WHERE id = ?`);
    for (const r of arr(P.links)) {
      if (!has('products', r.repack_from_id) || !(Number(r.size_qty) > 0) || r.repack_from_id === r.id) continue;
      upL.run(String(r.repack_from_id), Number(r.size_qty), String(r.id));
    }
    const insR = db.prepare(
      `INSERT OR IGNORE INTO repacks (id, short_id, bulk_product_id, bulk_qty_used, wastage_qty, bulk_unit_cost_paisa, packing_cost_paisa, note, created_by, created_at, voided_at, voided_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const ids = new Set<string>();
    for (const r of arr(P.repacks)) {
      if (!has('products', r.bulk_product_id) || !(Number(r.bulk_qty_used) > 0)) continue;
      insR.run(String(r.id), String(r.short_id ?? ''), String(r.bulk_product_id), Number(r.bulk_qty_used), Math.max(0, num(r.wastage_qty) ?? 0),
        Math.round(num(r.bulk_unit_cost_paisa) ?? 0), Math.max(0, Math.round(num(r.packing_cost_paisa) ?? 0)), txt(r.note),
        has('users', r.created_by) ? String(r.created_by) : null, String(r.created_at ?? new Date().toISOString()), txt(r.voided_at),
        has('users', r.voided_by) ? String(r.voided_by) : null);
      ids.add(String(r.id));
    }
    const insRL = db.prepare(`INSERT OR IGNORE INTO repack_lines (id, repack_id, product_id, packets, qty_each, unit_cost_paisa, prev_cost_paisa) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const l of arr(P.lines)) {
      if (!ids.has(String(l.repack_id)) || !has('products', l.product_id) || !(Number(l.packets) > 0) || !(Number(l.qty_each) > 0)) continue;
      insRL.run(String(l.id), String(l.repack_id), String(l.product_id), Number(l.packets), Number(l.qty_each),
        Math.round(num(l.unit_cost_paisa) ?? 0), num(l.prev_cost_paisa));
    }
  }
  const R = b.pricing && typeof b.pricing === 'object' ? b.pricing : null;
  const st = R?.store ?? null;
  const step = Number(st?.price_round_paisa);
  const mk = Math.round(Number(st?.default_markup_bp));
  const mm = Math.round(Number(st?.min_margin_bp));
  db.prepare(`UPDATE store SET default_markup_bp = ?, price_round_paisa = ?, price_round_mode = ?, min_margin_bp = ?`).run(
    Number.isInteger(mk) && mk >= 0 && mk <= 100000 ? mk : 3000,
    [100, 500, 1000].includes(step) ? step : 500,
    st?.price_round_mode === 'nearest' ? 'nearest' : 'up',
    Number.isInteger(mm) && mm >= 0 && mm <= 9900 ? mm : 500,
  );
  db.prepare(`UPDATE products SET fixed_price = 0, markup_bp = NULL`).run();
  if (R) {
    const arr = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
    const upP = db.prepare(`UPDATE products SET fixed_price = ?, markup_bp = ? WHERE id = ?`);
    for (const r of arr(R.products)) {
      const m = r.markup_bp == null ? null : Math.round(Number(r.markup_bp));
      upP.run(Number(r.fixed_price) === 1 ? 1 : 0, m != null && Number.isInteger(m) && m >= 0 && m <= 100000 ? m : null, String(r.id));
    }
    const upBT = db.prepare(`UPDATE purchase_lines SET line_total_paisa = ? WHERE id = ?`);
    for (const r of arr(R.bill_totals)) { const n = Math.round(Number(r.line_total_paisa)); if (Number.isSafeInteger(n) && n >= 0) upBT.run(n, String(r.id)); }
    const upOT = db.prepare(`UPDATE purchase_order_lines SET line_total_paisa = ? WHERE id = ?`);
    for (const r of arr(R.order_totals)) { const n = Math.round(Number(r.line_total_paisa)); if (Number.isSafeInteger(n) && n >= 0) upOT.run(n, String(r.id)); }
  }
  restoreTypes(db, b.types);
  restoreBuying(db, b.buying);
  restoreLanded(db, b.landed);
  restoreMeasures(db, b.measures);
  restoreBarcodes(db, b.barcodes);
  restoreOpening(db, b.opening);

}

/** v12: product types, review list, sorter runs, loose selling. Older copies: all Normal, loose on. */
function restoreTypes(db: Db, T: Batch2Bundle['types'] | undefined): void {
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
  const loose = T?.store && Number(T.store.sell_bulk_loose) === 0 ? 0 : 1;
  db.prepare(`UPDATE store SET sell_bulk_loose = ?`).run(loose);
  db.prepare(`UPDATE products SET product_type = 'normal', type_source = NULL`).run();
  if (!T || typeof T !== 'object') return;
  const has = (id: unknown) => !!db.prepare(`SELECT 1 FROM products WHERE id = ?`).get(String(id ?? ''));
  const upT = db.prepare(`UPDATE products SET product_type = ?, type_source = ? WHERE id = ?`);
  for (const r of arr(T.products)) {
    const t = ['normal', 'bulk', 'packed'].includes(String(r.product_type)) ? String(r.product_type) : 'normal';
    const src = r.type_source === 'auto' || r.type_source === 'manual' ? String(r.type_source) : null;
    upT.run(t, src, String(r.id));
  }
  const insR = db.prepare(
    `INSERT OR IGNORE INTO product_type_review (product_id, reason, kg, candidates_json, created_at, resolved_at, resolved_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of arr(T.review)) {
    if (!has(r.product_id)) continue;
    insR.run(String(r.product_id), String(r.reason ?? 'pick_bulk'), num(r.kg), txt(r.candidates_json), String(r.created_at ?? new Date().toISOString()),
      txt(r.resolved_at), txt(r.resolved_by));
  }
  const insRun = db.prepare(`INSERT OR IGNORE INTO product_type_runs (id, ran_at, user_id, changes_json, undone_at) VALUES (?, ?, ?, ?, ?)`);
  for (const r of arr(T.runs)) {
    if (typeof r.changes_json !== 'string') continue;
    insRun.run(String(r.id), String(r.ran_at ?? new Date().toISOString()), txt(r.user_id), r.changes_json, txt(r.undone_at));
  }
  const upP = db.prepare(`UPDATE repacks SET packing_per_pack_paisa = ? WHERE id = ?`);
  for (const r of arr(T.repack_packing)) {
    const n = Math.round(Number(r.packing_per_pack_paisa));
    if (Number.isSafeInteger(n) && n >= 0) upP.run(n, String(r.id));
  }
}

/** v13: purchase packages. Older copies come back with none set (the next start sorts them again). */
function restoreBuying(db: Db, B: Batch2Bundle['buying'] | undefined): void {
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
  db.prepare(`UPDATE products SET buy_unit = NULL, buy_unit_source = NULL`).run();
  if (!B || typeof B !== 'object') return;
  const upP = db.prepare(`UPDATE products SET buy_unit = ?, buy_unit_source = ? WHERE id = ?`);
  for (const r of arr(B.products)) {
    const u = ['carton', 'crate', 'piece'].includes(String(r.buy_unit)) ? String(r.buy_unit) : null;
    const src = r.buy_unit_source === 'auto' || r.buy_unit_source === 'manual' ? String(r.buy_unit_source) : null;
    upP.run(u, src, String(r.id));
  }
  const upL = db.prepare(`UPDATE purchase_order_lines SET by_package = 1 WHERE id = ?`);
  for (const r of arr(B.order_lines)) upL.run(String(r.id));
  const insRun = db.prepare(`INSERT OR IGNORE INTO buy_unit_runs (id, ran_at, user_id, changes_json, undone_at) VALUES (?, ?, ?, ?, ?)`);
  for (const r of arr(B.runs)) {
    if (typeof r.changes_json !== 'string') continue;
    insRun.run(String(r.id), String(r.ran_at ?? new Date().toISOString()), txt(r.user_id), r.changes_json, txt(r.undone_at));
  }
}

/** v14: bill extras. Older copies: no extras (bill totals and landed unit costs come back as stored). */
function restoreMeasures(db: Db, M: Batch2Bundle['measures'] | undefined): void {
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
  db.prepare(`UPDATE products SET buy_measure = NULL`).run();
  if (M && typeof M === 'object') {
    const ok = (u: unknown) => (isMeasure(u) ? u : null);
    const upP = db.prepare(`UPDATE products SET buy_measure = ? WHERE id = ?`);
    for (const r of arr(M.products)) upP.run(ok(r.buy_measure), String(r.id));
    const upB = db.prepare(`UPDATE purchase_lines SET unit = ? WHERE id = ?`);
    for (const r of arr(M.bill_lines)) upB.run(ok(r.unit), String(r.id));
    const upO = db.prepare(`UPDATE purchase_order_lines SET unit = ? WHERE id = ?`);
    for (const r of arr(M.order_lines)) upO.run(ok(r.unit), String(r.id));
  }
  // same mapping as migration 043 for anything not set
  db.prepare(`UPDATE products SET buy_measure = 'kg' WHERE buy_measure IS NULL AND product_type = 'bulk'`).run();
  db.prepare(`UPDATE products SET buy_measure = buy_unit WHERE buy_measure IS NULL AND buy_unit IN ('carton', 'crate', 'piece')`).run();
}

function restoreLanded(db: Db, L: Batch2Bundle['landed'] | undefined): void {
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
  db.prepare(`DELETE FROM purchase_extras WHERE invoice_id NOT IN (SELECT id FROM purchase_invoices)`).run();
  if (!L || typeof L !== 'object') {
    db.prepare(`DELETE FROM purchase_extras WHERE invoice_id IN (SELECT id FROM purchase_invoices WHERE extras_paisa = 0)`).run();
    return;
  }
  db.prepare(`DELETE FROM purchase_extras`).run();
  const int0 = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isSafeInteger(n) ? n : 0;
  };
  const upI = db.prepare(`UPDATE purchase_invoices SET extras_paisa = ?, extras_owed_paisa = ? WHERE id = ?`);
  for (const r of arr(L.invoices)) upI.run(Math.max(0, int0(r.extras_paisa)), Math.max(0, int0(r.extras_owed_paisa)), String(r.id));
  const upL = db.prepare(`UPDATE purchase_lines SET extra_share_paisa = ? WHERE id = ?`);
  for (const r of arr(L.lines)) upL.run(int0(r.extra_share_paisa), String(r.id));
  const has = db.prepare(`SELECT 1 FROM purchase_invoices WHERE id = ?`);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO purchase_extras (id, invoice_id, label, amount_paisa, paid_separately, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of arr(L.extras)) {
    if (!has.get(String(r.invoice_id ?? ''))) continue;
    ins.run(String(r.id), String(r.invoice_id), String(r.label ?? 'Delivery').slice(0, 60), Math.max(0, int0(r.amount_paisa)),
      Number(r.paid_separately) === 1 ? 1 : 0, int0(r.sort), String(r.created_at ?? new Date().toISOString()));
  }
}

/** v15: extra barcodes. Rows whose product is gone or whose code is now someone's primary are skipped. */
function restoreBarcodes(db: Db, rows: Row[] | undefined): void {
  if (!Array.isArray(rows)) return;
  const has = db.prepare(`SELECT 1 FROM products WHERE id = ?`);
  const taken = db.prepare(`SELECT 1 FROM products WHERE barcode = ? UNION SELECT 1 FROM product_barcodes WHERE barcode = ?`);
  const ins = db.prepare(`INSERT INTO product_barcodes (barcode, product_id, created_at) VALUES (?, ?, COALESCE(?, datetime('now')))`);
  for (const r of rows) {
    const code = String(r.barcode ?? '').trim();
    const pid = String(r.product_id ?? '');
    if (!code || code.length > 64 || !has.get(pid) || taken.get(code, code)) continue;
    ins.run(code, pid, txt(r.created_at));
  }
}

/** v16: opening stock. Rows for products that are gone are skipped; unknown users become NULL. */
/** Row ids change on restore, so a restored batch can only be undone if nothing at all happened after it. */
const RESTORED_MARKS = JSON.stringify({ sale_lines: 0, stock_receives: 0, purchase_lines: 0, sale_return_lines: 0, repack_lines: 0, repacks: 0, supplier_return_lines: 0, stock_adjustments: 0, restored: 1 });

function restoreOpening(db: Db, O: Batch2Bundle['opening'] | undefined): void {
  if (!O || typeof O !== 'object') return;
  const hasP = db.prepare(`SELECT 1 FROM products WHERE id = ?`);
  const hasU = db.prepare(`SELECT 1 FROM users WHERE id = ?`);
  const user = (v: unknown) => (v != null && hasU.get(String(v)) ? String(v) : null);
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
  const insB = db.prepare(
    `INSERT OR IGNORE INTO opening_stock_batches (id, number, posted_by, posted_at, item_count, total_value_paisa, undone_at, undone_by, marks_json)
     VALUES (?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?)`,
  );
  const batchIds = new Set<string>();
  for (const r of arr(O.batches)) {
    const n = Math.round(Number(r.number));
    if (!r.id || !Number.isSafeInteger(n)) continue;
    insB.run(String(r.id), n, user(r.posted_by), txt(r.posted_at), Math.round(num(r.item_count) ?? 0), Math.round(num(r.total_value_paisa) ?? 0), txt(r.undone_at), user(r.undone_by), RESTORED_MARKS);
    batchIds.add(String(r.id));
  }
  const insL = db.prepare(
    `INSERT OR IGNORE INTO opening_stock_lines (id, batch_id, product_id, product_name, unit_label, mode, packs, pack_units, pack_name, qty,
       cost_paisa, value_paisa, added, qty_before, qty_after, cost_before, cost_after, adjustment_id, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const int = (v: unknown) => { const n = num(v); return n == null ? null : Math.round(n); };
  for (const r of arr(O.lines)) {
    if (!r.id || !batchIds.has(String(r.batch_id)) || !hasP.get(String(r.product_id))) continue;
    insL.run(String(r.id), String(r.batch_id), String(r.product_id), String(r.product_name ?? ''), String(r.unit_label ?? 'piece'),
      r.mode === 'pack' ? 'pack' : 'base', int(r.packs), int(r.pack_units), txt(r.pack_name), num(r.qty) ?? 0, int(r.cost_paisa),
      int(r.value_paisa) ?? 0, Number(r.added) === 1 ? 1 : 0, num(r.qty_before) ?? 0, num(r.qty_after) ?? 0, int(r.cost_before),
      int(r.cost_after), txt(r.adjustment_id), int(r.sort) ?? 0);
  }
  const insD = db.prepare(
    `INSERT OR IGNORE INTO opening_stock_drafts (product_id, mode, qty, packs, pack_units, pack_name, cost_paisa, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  );
  for (const r of arr(O.drafts)) {
    if (!hasP.get(String(r.product_id))) continue;
    const q = num(r.qty);
    const c = int(r.cost_paisa);
    const pu = int(r.pack_units);
    insD.run(String(r.product_id), r.mode === 'pack' ? 'pack' : 'base', q != null && q >= 0 ? q : null, int(r.packs), pu != null && pu > 0 ? pu : null,
      txt(r.pack_name), c != null && c >= 0 ? c : null, user(r.updated_by), txt(r.updated_at));
  }
}
