import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { CatalogService } from '../catalog/catalog.service';
import { SALE_TYPES } from '../purchases/purchase-targets';
import { readShopRules } from '../settings/shop-rules';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { SupervisorGuard } from '../auth/roles.guard';
import { tillAls } from '../tills/till-context';
import { SalesService } from './sales.service';

const BLOCK = 200;
const REFILL_BELOW = 50;
const MAX_BATCH = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OfflineLine = { productId?: string; qty?: number; unitPricePaisa?: number; overrideFromPaisa?: number | null };
type OfflineSale = {
  clientUuid?: string;
  offlineNo?: number;
  cashierId?: string;
  overrideBy?: string | null;
  deviceAt?: string;
  tenderedPaisa?: number;
  lines?: OfflineLine[];
};
type SyncResult = { clientUuid: string; status: 'saved' | 'duplicate' | 'rejected'; shortId?: string; error?: string; stockConflicts?: unknown[] };

/**
 * Lite offline selling. A paired till (device key) keeps a copy of what it needs to sell while the
 * main PC is down (items, prices, cashier / manager PIN checks, a block of offline bill numbers) and
 * sends its queued sales here when the main PC is back. Sync is idempotent (client UUID per sale).
 */
@Controller()
export class OfflineSyncController {
  constructor(
    private readonly db: DbService,
    private readonly sales: SalesService,
    private readonly catalog: CatalogService,
  ) {}

  /** The paired till this request comes from (device key required). */
  private till() {
    const ctx = tillAls.getStore();
    if (!ctx?.till || ctx.till.kind !== 'remote') throw new ForbiddenException({ ok: false, error: 'till_not_paired' });
    return ctx.till;
  }

  /** What a till needs to sell offline. `have` = offline numbers it still holds; below 50 it gets 200 more. */
  @Get('tills/offline-pack')
  pack(@Query('have') haveRaw?: string) {
    const till = this.till();
    const have = Math.max(0, Math.floor(Number(haveRaw) || 0));
    let block: { from: number; to: number } | null = null;
    if (have < REFILL_BELOW) {
      const r = this.db.raw
        .prepare(`UPDATE tills SET off_alloc_to = off_alloc_to + ? WHERE id = ? RETURNING off_alloc_to`)
        .get(BLOCK, till.id) as { off_alloc_to: number };
      const to = Number(r.off_alloc_to);
      block = { from: to - BLOCK + 1, to };
    }
    const products = this.catalog.list(false, { types: [...SALE_TYPES] }).items;
    // PIN checks for cashiers and managers only (the owner never signs in on a till offline).
    const users = (
      this.db.raw
        .prepare(
          `SELECT u.id, u.display_name, r.code AS role, u.pin_hash FROM users u JOIN roles r ON r.id = u.role_id
           WHERE u.disabled_at IS NULL AND u.pin_hash IS NOT NULL AND r.code IN ('cashier', 'manager')
           ORDER BY u.display_name`,
        )
        .all() as Array<{ id: string; display_name: string; role: string; pin_hash: string }>
    ).map((u) => ({ id: u.id, displayName: u.display_name, role: u.role, pinHash: u.pin_hash }));
    const store = this.db.raw.prepare(`SELECT id, name, receipt_footer FROM store LIMIT 1`).get() as
      | { id: string; name: string; receipt_footer: string | null }
      | undefined;
    return {
      ok: true as const,
      at: new Date().toISOString(),
      till: { id: till.id, code: till.code, name: till.name },
      store: store ?? null,
      rules: readShopRules(this.db.raw),
      products,
      users,
      block,
    };
  }

  /** Queued offline sales from a till. Each result: saved / duplicate (already here) / rejected. */
  @Post('sales/offline-sync')
  @HttpCode(200)
  sync(@Body() body: { sales?: OfflineSale[] }) {
    const till = this.till();
    const list = Array.isArray(body?.sales) ? body.sales.slice(0, MAX_BATCH) : [];
    const allocTo = Number(
      (this.db.raw.prepare(`SELECT off_alloc_to FROM tills WHERE id = ?`).get(till.id) as { off_alloc_to: number }).off_alloc_to,
    );
    const store = this.db.raw.prepare(`SELECT id FROM store LIMIT 1`).get() as { id: string } | undefined;
    const userRole = (id: unknown): string | null => {
      if (typeof id !== 'string' || !id) return null;
      const r = this.db.raw
        .prepare(`SELECT r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`)
        .get(id) as { role: string } | undefined;
      return r?.role ?? null;
    };
    const results: SyncResult[] = [];
    for (const s of list) {
      const clientUuid = String(s?.clientUuid ?? '');
      const reject = (error: string) => results.push({ clientUuid, status: 'rejected', error });
      if (!UUID_RE.test(clientUuid)) { reject('invalid_client_uuid'); continue; }
      const dup = this.db.raw.prepare(`SELECT short_id FROM sales WHERE client_uuid = ?`).get(clientUuid) as { short_id: string } | undefined;
      if (dup) { results.push({ clientUuid, status: 'duplicate', shortId: dup.short_id }); continue; }
      const offlineNo = Math.floor(Number(s.offlineNo));
      if (!(offlineNo >= 1 && offlineNo <= allocTo)) { reject('invalid_offline_no'); continue; }
      const role = userRole(s.cashierId);
      if (!role || !['cashier', 'manager', 'owner'].includes(role)) { reject('invalid_cashier'); continue; }
      const lines = Array.isArray(s.lines) ? s.lines : [];
      const hasOverride = lines.some((l) => l && l.overrideFromPaisa != null);
      let overrideBy: string | null = null;
      if (hasOverride) {
        const ar = userRole(s.overrideBy);
        if (ar !== 'manager' && ar !== 'owner') { reject('manager_approval_needed'); continue; }
        overrideBy = String(s.overrideBy);
      }
      const fixedPrices = new Map<string, number>();
      for (const l of lines) {
        const base = l?.overrideFromPaisa ?? l?.unitPricePaisa;
        if (l?.productId && Number.isFinite(Number(base))) fixedPrices.set(String(l.productId), Math.round(Number(base)));
      }
      const result = this.sales.completeSale({
        lines: lines.map((l) => ({
          productId: String(l?.productId ?? ''),
          qty: Number(l?.qty),
          unit: 'piece',
          ...(l?.overrideFromPaisa != null ? { overridePricePaisa: Math.round(Number(l.unitPricePaisa)) } : {}),
        })),
        paymentMethod: 'cash',
        tenderedPaisa: s.tenderedPaisa != null ? Math.round(Number(s.tenderedPaisa)) : null,
        clientDeviceAt: s.deviceAt,
        soldBy: String(s.cashierId),
        storeId: store?.id,
        tillId: till.id,
        fixedPrices,
        offline: { clientUuid, offlineNo },
        extras: { role, overrideBy },
      });
      if (result.ok) {
        if (overrideBy) this.sales.auditOverride(result.sale.id, String(s.cashierId), overrideBy);
        results.push({ clientUuid, status: 'saved', shortId: result.sale.shortId, stockConflicts: result.stockConflicts ?? [] });
      } else if (result.error === 'duplicate') {
        const d = this.db.raw.prepare(`SELECT short_id FROM sales WHERE client_uuid = ?`).get(clientUuid) as { short_id: string } | undefined;
        results.push({ clientUuid, status: 'duplicate', shortId: d?.short_id });
      } else {
        reject(result.error);
      }
    }
    return { ok: true as const, results };
  }

  /** Stock that went below zero after offline sales (manager / owner). */
  @Get('stock/reviews')
  @UseGuards(SessionGuard, SupervisorGuard)
  reviews(@Query('all') all?: string) {
    const rows = this.db.raw
      .prepare(
        `SELECT r.id, r.product_id, p.name AS product_name, r.sale_id, s.short_id, r.till_id, t.code AS till_code,
                r.qty_sold, r.qty_after, r.created_at, r.resolved_at, r.note, b.qty_on_hand AS qty_now
         FROM stock_reviews r
         JOIN products p ON p.id = r.product_id
         LEFT JOIN sales s ON s.id = r.sale_id
         LEFT JOIN tills t ON t.id = r.till_id
         LEFT JOIN stock_balances b ON b.product_id = r.product_id
         ${all === '1' ? '' : 'WHERE r.resolved_at IS NULL'}
         ORDER BY r.created_at DESC LIMIT 500`,
      )
      .all() as Array<Record<string, unknown>>;
    return {
      ok: true as const,
      items: rows.map((r) => ({
        ...r,
        qty_sold: Number(r.qty_sold),
        qty_after: Number(r.qty_after),
        qty_now: r.qty_now == null ? null : Number(r.qty_now),
        till_label: r.till_code != null ? `T${r.till_code}` : null,
      })),
    };
  }

  @Post('stock/reviews/:id/resolve')
  @HttpCode(200)
  @UseGuards(SessionGuard, SupervisorGuard)
  resolve(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { note?: string }) {
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 200) : null;
    const info = this.db.raw
      .prepare(`UPDATE stock_reviews SET resolved_at = ?, resolved_by = ?, note = ? WHERE id = ? AND resolved_at IS NULL`)
      .run(new Date().toISOString(), req.session!.userId, note || null, id);
    if (info.changes !== 1) return { ok: false as const, error: 'not_found' };
    this.db.raw
      .prepare(`INSERT INTO audit_log (id, action, user_id, subject_type, subject_id, payload_json) VALUES (?, 'stock.review_resolved', ?, 'stock_review', ?, ?)`)
      .run(randomUUID(), req.session!.userId, id, JSON.stringify({ note }));
    return { ok: true as const };
  }
}

