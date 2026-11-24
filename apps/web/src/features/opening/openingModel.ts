import type { MessageKey } from '../../i18n/dictionary';
import { fmtDateTime } from '../shared/dates';

export type OsPack = { name: string; units: number } | null;

export type OsDraft = {
  mode: 'base' | 'pack';
  qty: number | null;
  packs: number | null;
  pack_units: number | null;
  pack_name: string | null;
  cost_paisa: number | null;
  updated_at: string;
};

export type OsItem = {
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
  pack_default: boolean;
  packed_from: string | null;
  has_activity: boolean;
  draft: OsDraft | null;
};

export type OsTotals = { entered: number; qty_pieces: number; qty_kg: number; value_paisa: number; no_cost: number };

export type OsBatch = {
  id: string;
  number: number;
  posted_at: string;
  posted_by_name: string | null;
  item_count: number;
  total_value_paisa: number;
  undone_at: string | null;
  undone_by_name: string | null;
  can_undo: boolean;
  undo_block: string | null;
};

export type OsBatchLine = {
  product_id: string;
  name: string;
  barcode: string | null;
  unit_label: string;
  mode: string;
  packs: number | null;
  pack_units: number | null;
  pack_name: string | null;
  qty: number;
  cost_paisa: number | null;
  value_paisa: number;
  price_paisa: number | null;
  added: boolean;
  qty_before: number;
  qty_after: number;
};

export type OsBatchFull = OsBatch & { lines: OsBatchLine[] };

export type OsList = { ok: true; items: OsItem[]; totals: OsTotals; batches: OsBatch[]; draft_count: number };

export type OsImport = {
  ok: true;
  applied: boolean;
  matched: Array<{ row: number; product_id: string; name: string; unit_label: string; qty: number | null; cost_paisa: number | null; mode: string; packs: number | null; pack_units: number | null; change: 'new' | 'update' | 'same' }>;
  unmatched: Array<{ row: number; name: string; barcode: string }>;
  errors: Array<{ row: number; name: string; error: string }>;
  skipped: number;
  totals: OsTotals;
};

export type OsPreview = {
  ok: true;
  items: number;
  total_value_paisa: number;
  no_cost: string[];
  added: Array<{ product_id: string; name: string; unit_label: string; qty_on_hand: number; qty: number; qty_after: number }>;
};

/** "1,240" / "12.5" — qty with grouping, kg up to 3 decimals. */
export function fmtNum(n: number, frac = false): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: frac ? 3 : 0 });
}

export function unitShort(unit: string): string {
  const u = unit.trim().toLowerCase();
  if (u === 'piece' || u === 'pieces' || u === 'pcs' || u === 'pc') return 'pcs';
  return u;
}

export function fmtQty(n: number, unit: string, frac: boolean): string {
  return `${fmtNum(n, frac)} ${unitShort(unit)}`;
}

/** Server time ('YYYY-MM-DD HH:MM:SS' UTC) → "22 Oct 2026, 11:40 am" in Karachi. */
export function fmtPkt(utc: string): string {
  const d = new Date(utc.includes('T') ? utc : `${utc.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return utc;
  return fmtDateTime(d);
}

export function blockKey(code: string | null): MessageKey | null {
  switch (code) {
    case 'sold_since':
      return 'osBlockSold';
    case 'bought_since':
      return 'osBlockBought';
    case 'returned_since':
      return 'osBlockReturned';
    case 'repacked_since':
      return 'osBlockRepacked';
    case 'stock_changed_since':
      return 'osBlockChanged';
    case 'not_last':
      return 'osBlockNotLast';
    default:
      return null;
  }
}

export function importErrorText(code: string, t: (k: MessageKey) => string): string {
  const dup = /^duplicate_of_row_(\d+)$/.exec(code);
  if (dup) return t('osErrDup').replace('{n}', dup[1]);
  const m: Record<string, MessageKey> = {
    same_name_twice: 'osErrSameName',
    qty_and_cartons: 'osErrBoth',
    invalid_qty: 'osErrQty',
    invalid_cost: 'osErrCost',
    pack_units_required: 'osErrUnits',
    not_xlsx: 'osErrFile',
    empty_sheet: 'osErrFile',
    file_required: 'osErrFile',
    no_product_column: 'osErrNoCols',
    no_qty_column: 'osErrNoCols',
    nothing_to_post: 'osErrNothing',
    errorGeneric: 'errorGeneric',
    save_failed: 'osSaveFailed',
    not_found: 'errorGeneric',
    cannot_undo: 'errorGeneric',
  };
  const b = blockKey(code);
  if (b) return t(b);
  return m[code] ? t(m[code]) : code.replace(/_/g, ' ');
}

/** Rs text from the cost input → paisa, or null when blank, or NaN when not a number. */
export function parseRs(s: string): number | null {
  const v = s.trim().replace(/,/g, '');
  if (!v) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return Number.NaN;
  return Math.round(Number(v) * 100);
}

export function parseQty(s: string): number | null {
  const v = s.trim().replace(/,/g, '');
  if (!v) return null;
  if (!/^\d+(\.\d+)?$/.test(v)) return Number.NaN;
  return Number(v);
}

export async function fileToBase64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
