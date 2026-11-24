/**
 * Owner notification center — computed on the client from existing endpoints.
 * No new tables, no push. Each source can fail on its own; the last good copy is kept.
 */
import type { MessageKey } from '../../i18n/dictionary';
import { apiGet } from '../../lib/api';
import { formatRs } from '../analytics/analyticsTypes';
import {
  discountStatusOf,
  formatStoreDateTime,
  type ProductDiscountFields,
} from '../shared/discount';
import { NO_SUPPLIER_ID } from '../shared/noSupplier';
import { LOW_STOCK_THRESHOLD } from '../shared/stock';

/** Sales whose end falls inside this window show as "ending soon". */
export const SALE_ENDING_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Backup reminder once the last export is older than this (or there is none). */
export const BACKUP_STALE_DAYS = 7;
/** Names listed under each alert before "+N more". */
const MAX_LINES = 3;

export type AlertSeverity = 'urgent' | 'warning' | 'info';

/** Screens an alert can open. All exist in the owner rail. */
export type AlertTarget =
  | 'catalog'
  | 'purchases'
  | 'suppliers'
  | 'parties'
  | 'stockCare'
  | 'backup';

export type AlertKind =
  | 'stock-out'
  | 'stock-low'
  | 'sale-ending'
  | 'supplier-due'
  | 'customer-udhaar'
  | 'expiry'
  | 'backup-stale';

export type AppAlert = {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  lines: string[];
  more: number;
  detail?: string;
  action: { target: AlertTarget; label: string };
  /**
   * Changes when the alert has something new to say (e.g. another product ran out),
   * so a "seen" alert comes back unread. Small changes (qty 4 → 3) do not.
   */
  signature: string;
};

type ProductRow = ProductDiscountFields & {
  id: string;
  name: string;
  qty_on_hand: number;
};

type SupplierRow = { id: string; name: string; balance_paisa: number };
type PartyRow = { id: string; name: string; balance_paisa: number };
type BackupStatus = { last_export_at: string | null };

export type AlertSources = {
  products?: ProductRow[];
  suppliers?: SupplierRow[];
  parties?: PartyRow[];
  backup?: BackupStatus;
  expiring?: Array<{ batch_line_id: string; product_name: string; expiry_date: string; expired: boolean; days_left: number }>;
};

export type FetchResult = {
  sources: AlertSources;
  /** Number of endpoints that failed this round. */
  failed: number;
  total: number;
};

/**
 * One round = four small local GETs, all in parallel. Every endpoint is owner-safe and
 * already used by its own screen. Failures are counted, never thrown.
 */
export async function fetchAlertSources(): Promise<FetchResult> {
  const jobs: Promise<AlertSources>[] = [
    listOf<ProductRow>('/catalog/products').then((products) => ({ products })),
    listOf<SupplierRow>('/suppliers').then((suppliers) => ({ suppliers })),
    listOf<PartyRow>('/parties').then((parties) => ({ parties })),
    listOf<NonNullable<AlertSources['expiring']>[number]>('/stock/expiring').then((expiring) => ({ expiring })),
    apiGet<BackupStatus>('/backup').then((r) => {
      if (!r || typeof r !== 'object') throw new Error('bad_backup_status');
      return { backup: { last_export_at: r.last_export_at ?? null } };
    }),
  ];
  const settled = await Promise.allSettled(jobs);
  const sources: AlertSources = {};
  let failed = 0;
  for (const s of settled) {
    if (s.status === 'fulfilled') Object.assign(sources, s.value);
    else failed += 1;
  }
  return { sources, failed, total: jobs.length };
}

async function listOf<T>(path: string): Promise<T[]> {
  const r = await apiGet<{ items?: unknown }>(path);
  if (!Array.isArray(r?.items)) throw new Error('bad_list');
  return r.items as T[];
}

/** SQLite "YYYY-MM-DD HH:MM:SS" is UTC without a zone; ISO strings pass through. */
export function parseServerTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Keep names and amounts readable inside the other script (Urdu ⇄ Latin). */
function iso(s: string): string {
  return `\u2068${s}\u2069`;
}

function fill(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** Tiny stable hash so signatures stay short in localStorage. */
function hash(parts: string[]): string {
  let h = 5381;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function sig(kind: AlertKind, keys: string[]): string {
  return `${kind}:${hash([...keys].sort())}`;
}

function capped<T>(rows: T[], line: (row: T) => string) {
  return {
    lines: rows.slice(0, MAX_LINES).map(line),
    more: Math.max(0, rows.length - MAX_LINES),
  };
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  urgent: 0,
  warning: 1,
  info: 2,
};

export function buildAlerts(
  src: AlertSources,
  now: number,
  t: (key: MessageKey) => string,
  locale: string,
): AppAlert[] {
  const alerts: AppAlert[] = [];
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);

  if (src.products) {
    const out = src.products
      .filter((p) => (p.qty_on_hand ?? 0) <= 0)
      .sort(byName);
    const low = src.products
      .filter((p) => p.qty_on_hand > 0 && p.qty_on_hand <= LOW_STOCK_THRESHOLD)
      .sort((a, b) => a.qty_on_hand - b.qty_on_hand || byName(a, b));
    const stockLine = (p: ProductRow) =>
      fill(t('notifStockLine'), { name: iso(p.name), qty: iso(String(p.qty_on_hand)) });

    if (out.length > 0) {
      alerts.push({
        kind: 'stock-out',
        severity: 'urgent',
        title: fill(t('notifOutTitle'), { n: out.length }),
        ...capped(out, (p) => iso(p.name)),
        action: { target: 'purchases', label: t('notifActionRestock') },
        signature: sig('stock-out', out.map((p) => p.id)),
      });
    }
    if (low.length > 0) {
      alerts.push({
        kind: 'stock-low',
        severity: 'warning',
        title: fill(t('notifLowTitle'), {
          n: low.length,
          threshold: LOW_STOCK_THRESHOLD,
        }),
        ...capped(low, stockLine),
        action: { target: 'purchases', label: t('notifActionRestock') },
        signature: sig('stock-low', low.map((p) => p.id)),
      });
    }

    const ending = src.products
      .map((p) => ({ p, end: parseServerTime(p.discount_end_at) }))
      .filter(
        (x): x is { p: ProductRow; end: number } =>
          x.end != null &&
          discountStatusOf(x.p, now) === 'active' &&
          x.end - now <= SALE_ENDING_WINDOW_MS,
      )
      .sort((a, b) => a.end - b.end);
    if (ending.length > 0) {
      alerts.push({
        kind: 'sale-ending',
        severity: 'info',
        title: fill(t('notifSaleEndingTitle'), { n: ending.length }),
        ...capped(ending, (x) =>
          fill(t('notifSaleEndingLine'), {
            name: iso(x.p.name),
            date: iso(formatStoreDateTime(x.p.discount_end_at!, locale)),
          }),
        ),
        action: { target: 'catalog', label: t('notifActionCatalog') },
        signature: sig(
          'sale-ending',
          ending.map((x) => `${x.p.id}@${x.p.discount_end_at}`),
        ),
      });
    }
  }

  if (src.suppliers) {
    // "No supplier" is a bookkeeping bucket, not someone you can pay.
    const owed = src.suppliers
      .filter((s) => s.id !== NO_SUPPLIER_ID && s.balance_paisa > 0)
      .sort((a, b) => b.balance_paisa - a.balance_paisa);
    if (owed.length > 0) {
      const sum = owed.reduce((acc, s) => acc + s.balance_paisa, 0);
      alerts.push({
        kind: 'supplier-due',
        severity: 'warning',
        title: fill(t('notifSupplierTitle'), { amount: iso(formatRs(sum)) }),
        ...capped(owed, (s) => `${iso(s.name)} · ${iso(formatRs(s.balance_paisa))}`),
        action: { target: 'suppliers', label: t('notifActionSuppliers') },
        signature: sig('supplier-due', owed.map((s) => s.id)),
      });
    }
  }

  if (src.parties) {
    const owing = src.parties
      .filter((p) => p.balance_paisa > 0)
      .sort((a, b) => b.balance_paisa - a.balance_paisa);
    if (owing.length > 0) {
      const sum = owing.reduce((acc, p) => acc + p.balance_paisa, 0);
      alerts.push({
        kind: 'customer-udhaar',
        severity: 'info',
        title: fill(t('notifCustomerTitle'), { amount: iso(formatRs(sum)) }),
        ...capped(owing, (p) => `${iso(p.name)} · ${iso(formatRs(p.balance_paisa))}`),
        action: { target: 'parties', label: t('notifActionCustomers') },
        signature: sig('customer-udhaar', owing.map((p) => p.id)),
      });
    }
  }

  if (src.expiring && src.expiring.length > 0) {
    const rows = [...src.expiring].sort((a, b) => a.days_left - b.days_left);
    const expired = rows.filter((r) => r.expired).length;
    alerts.push({
      kind: 'expiry',
      severity: expired > 0 ? 'urgent' : 'warning',
      title: fill(t('notifExpiryTitle'), { n: rows.length }),
      ...capped(rows, (r) => `${iso(r.product_name)} · ${iso(r.expiry_date)}`),
      action: { target: 'stockCare', label: t('notifActionExpiry') },
      signature: sig('expiry', rows.map((r) => r.batch_line_id)),
    });
  }

  if (src.backup) {
    const last = parseServerTime(src.backup.last_export_at);
    const ageDays = last == null ? null : Math.floor((now - last) / 86_400_000);
    if (ageDays == null || ageDays >= BACKUP_STALE_DAYS) {
      // Re-nag once a week while it stays stale.
      const week = Math.floor(now / (7 * 86_400_000));
      alerts.push({
        kind: 'backup-stale',
        severity: 'warning',
        title:
          ageDays == null
            ? t('notifBackupNeverTitle')
            : fill(t('notifBackupOldTitle'), { n: ageDays }),
        lines: [],
        more: 0,
        detail:
          last == null
            ? t('notifBackupDetail')
            : `${fill(t('notifBackupLast'), {
                date: iso(formatStoreDateTime(new Date(last).toISOString(), locale)),
              })} ${t('notifBackupDetail')}`,
        action: { target: 'backup', label: t('notifActionBackup') },
        signature: `backup-stale:${src.backup.last_export_at ?? 'never'}:${week}`,
      });
    }
  }

  return alerts.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
