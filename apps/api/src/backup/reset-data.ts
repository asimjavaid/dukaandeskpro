/**
 * Reset data (testing helper, owner only): wipe everything that happened in the
 * shop and keep what defines it. Every table in the schema must be listed in
 * exactly one of these lists; an unknown table stops the reset so a new table
 * is never kept or wiped by accident.
 */

/** Kept as they are. */
export const RESET_KEEP_TABLES = [
  'products', // names, prices, cost fields, type, packed-from, buy unit, pictures
  'product_barcodes', // extra barcodes
  'product_packs', // carton / pack presets (pcs per carton)
  'product_type_review', // product type check list
  'product_type_runs', // product type tool undo log (products only)
  'buy_unit_runs', // buy unit tool undo log (products only)
  'barcode_seq', // next in-store barcode (kept so new codes never clash)
  'users',
  'roles',
  'staff',
  'owner_recovery',
  'auth_throttle',
  'store', // shop profile, pricing, tax config, receipt and printer settings
  'auto_backup',
  'schema_migrations',
  'tills', // Lite: paired till PCs and their bill counters (numbers never restart)
] as const;

/** Rows kept, quantity set to 0. */
export const RESET_ZERO_TABLES = ['stock_balances'] as const;

/** Emptied, in this order (children before parents). */
export const RESET_WIPE_TABLES = [
  'opening_stock_drafts',
  'opening_stock_lines',
  'opening_stock_batches',
  'stock_reviews', // Lite: stock went below zero after offline sales
  'sale_return_lines',
  'sale_returns',
  'loyalty_ledger',
  'party_ledger',
  'tax_documents',
  'sale_lines',
  'sales',
  'parties',
  'supplier_return_lines',
  'supplier_returns',
  'supplier_payments',
  'supplier_product_pack',
  'purchase_extras',
  'stock_receives',
  'purchase_lines',
  'purchase_invoices',
  'purchase_order_lines',
  'purchase_orders',
  'suppliers',
  'stock_adjustments',
  'stock_count_lines',
  'stock_count_sessions',
  'repack_lines',
  'repacks',
  'staff_ledger',
  'expenses',
  'till_moves',
  'till_shifts',
  'price_history',
  'audit_log',
] as const;

export const RESET_CONFIRM_WORD = 'RESET';
export const RESET_AUDIT_ACTION = 'data.reset';
