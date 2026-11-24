/** Slice 6/12 — Owner local JSON store export + restore. */

export const BACKUP_PRODUCT = 'DukaanDesk' as const;
export const BACKUP_FORMAT = 'dukaandesk-store-export' as const;
/**
 * Export bundle schema version (independent of SQL migration filenames).
 * v6 adds till_shifts / till_moves (cash drawer shifts). Older restores clear
 * them along with the bills they summarise. Quantities for kg/litre may be decimals.
 * v5 adds staff (profiles), staff_ledger (salary khata) and expenses.staff_id /
 * from_drawer. Older restores keep staff profiles and clear the salary khata
 * (its expenses are replaced by the copy's).
 * v4 adds products.image_file and product_images (base64 JPEG, ~10-40 KB
 * each). v1-v3 restores keep each product's current picture.
 * v3 adds sale_returns / sale_return_lines and the sales remove/edit columns
 * (voided_by, void_reason, replaces_sale_id, replaced_by_sale_id) and
 * party_ledger.return_id. v1/v2 restores clear returns along with sales.
 * v2 adds suppliers, purchases, supplier payments, stock receives, expenses and
 * printer settings. v1 copies still restore (tables they lack are left as-is).
 */
/** v9 adds purchase orders (batch2.orders); v10 adds packs + repack (batch2.repack); v11 adds pricing (batch2.pricing);
 * v12 adds product types (batch2.types); v13 adds purchase packages (batch2.buying); v14 adds bill extras / landed cost (batch2.landed);
 * v15 adds extra barcodes per product (batch2.barcodes); v16 adds opening stock drafts / batches (batch2.opening). */
export const BACKUP_SCHEMA_VERSION = 16 as const;
/** Oldest copy version restore still accepts. */
export const BACKUP_MIN_SCHEMA_VERSION = 1 as const;
export const BACKUP_DATA_REGION = 'local_device' as const;
export const BACKUP_AUDIT_ACTION = 'backup.export' as const;
export const BACKUP_RESTORE_AUDIT_ACTION = 'backup.restore' as const;

export type BackupHeader = {
  product: typeof BACKUP_PRODUCT;
  format: typeof BACKUP_FORMAT;
  /** 2 for new copies; 1 on older copies. */
  schema_version: number;
  exported_at: string;
  data_region_disclosed: typeof BACKUP_DATA_REGION;
  store_id: string;
};

export type StoreExportBundle = {
  header: BackupHeader;
  store: Record<string, unknown>;
  products: unknown[];
  stock_balances: unknown[];
  parties: unknown[];
  party_ledger: unknown[];
  sales: unknown[];
  sale_lines: unknown[];
  /** Tax document statuses only — no payload_json / raw_detail. */
  tax_documents: unknown[];
  /** Stock count v2 (D29-l). Optional on older bundles — restore treats missing as []. */
  stock_count_sessions?: unknown[];
  stock_count_lines?: unknown[];
  stock_adjustments?: unknown[];
  /** v2+. Missing on v1 copies — restore then leaves these tables untouched. */
  suppliers?: unknown[];
  supplier_payments?: unknown[];
  purchase_invoices?: unknown[];
  purchase_lines?: unknown[];
  stock_receives?: unknown[];
  expenses?: unknown[];
  /** v3: returns against bills. */
  sale_returns?: unknown[];
  sale_return_lines?: unknown[];
  /** v4: picture files referenced by products.image_file. */
  product_images?: Array<{ file: string; data_base64: string }>;
  /** v5: staff profiles and salary khata. */
  staff?: unknown[];
  staff_ledger?: unknown[];
  /** v6: till shifts and cash in/out. */
  till_shifts?: unknown[];
  till_moves?: unknown[];
  batch2?: unknown;
};

/** Restored together or not at all (a v1 copy has none of them). */
export const BACKUP_PURCHASE_KEYS = [
  'suppliers',
  'supplier_payments',
  'purchase_invoices',
  'purchase_lines',
  'stock_receives',
] as const;

export const BACKUP_STOCK_COUNT_KEYS = [
  'stock_count_sessions',
  'stock_count_lines',
  'stock_adjustments',
] as const;

export type BackupStatus = {
  last_export_at: string | null;
  last_restore_at?: string | null;
  data_region_disclosed: typeof BACKUP_DATA_REGION;
  product: typeof BACKUP_PRODUCT;
  schema_version: typeof BACKUP_SCHEMA_VERSION;
  /** Oldest copy version this app can restore. */
  min_schema_version: typeof BACKUP_MIN_SCHEMA_VERSION;
};

/** Keys that must never appear in an export payload. */
export const FORBIDDEN_EXPORT_KEY_RE =
  /^(pin_hash|session_secret|jwt_secret|password|token|access_token|refresh_token|api_key|psp_secret|webhook_secret|raw_webhook|payload_raw|payload_json|raw_detail|SESSION_SECRET)$/i;

export const FORBIDDEN_EXPORT_SUBSTRINGS = [
  'SESSION_SECRET',
  'JWT_SECRET',
  'pin_hash',
] as const;

/** Clear 400 codes when restore header fails validation (no DB mutate). */
export type RestoreHeaderErrorCode =
  | 'invalid_backup_product'
  | 'invalid_backup_format'
  | 'invalid_backup_schema_version'
  | 'invalid_backup_bundle';

/** Restore hit a data problem; the transaction rolled back so nothing changed. */
export type RestoreRunErrorCode = 'restore_failed';
