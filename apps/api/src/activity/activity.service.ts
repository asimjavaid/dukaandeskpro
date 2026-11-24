import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export type ActivityItem = {
  at: string;
  kind: string;
  user_name: string | null;
  subject: string | null;
  amount_paisa: number | null;
  detail: string | null;
};

/**
 * Who did what: bills sold, voids / edits / returns (audit_log), price changes,
 * stock write-offs, purchases. One feed, newest first.
 */
@Injectable()
export class ActivityService {
  constructor(private readonly db: DbService) {}

  list(opts: { page?: number; pageSize?: number; kind?: string; userId?: string; day?: string }) {
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(opts.pageSize) || 50)));
    const page = Math.max(1, Math.floor(Number(opts.page) || 1));
    // All timestamps normalised to ISO-ish UTC text so they sort together.
    const feed = `
      SELECT s.recorded_at AS at, 'sale' AS kind, s.sold_by AS user_id, s.short_id AS subject,
             s.total_paisa AS amount_paisa, s.payment_method AS detail
        FROM sales s
      UNION ALL
      SELECT replace(a.created_at, ' ', 'T') || CASE WHEN a.created_at LIKE '%Z' THEN '' ELSE 'Z' END,
             a.action, a.user_id, a.subject_id, NULL, a.payload_json
        FROM audit_log a
      UNION ALL
      SELECT h.changed_at, 'price.change', h.changed_by, p.name, h.new_price_paisa,
             CAST(h.old_price_paisa AS TEXT)
        FROM price_history h JOIN products p ON p.id = h.product_id
      UNION ALL
      SELECT replace(i.created_at, ' ', 'T') || 'Z', 'purchase', i.created_by, su.name, i.total_paisa, i.purchased_on
        FROM purchase_invoices i JOIN suppliers su ON su.id = i.supplier_id
      UNION ALL
      SELECT e.created_at_iso, 'expense', NULL, e.kind, e.amount_paisa, e.note
        FROM (SELECT replace(created_at, ' ', 'T') || 'Z' AS created_at_iso, kind, amount_paisa, note FROM expenses) e
    `;
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.kind) {
      if (opts.kind === 'return') where.push(`f.kind LIKE 'sale.return%'`);
      else if (opts.kind === 'repack') where.push(`f.kind LIKE 'repack.%'`);
      else if (opts.kind === 'opening_stock') where.push(`f.kind LIKE 'opening_stock.%'`);
      else if (opts.kind === 'purchase_order') where.push(`f.kind LIKE 'purchase_order.%'`);
      else if (opts.kind === 'void') where.push(`f.kind IN ('sale.void', 'sale.replace')`);
      else {
        where.push(`f.kind = ?`);
        args.push(opts.kind);
      }
    }
    if (opts.userId) {
      where.push(`f.user_id = ?`);
      args.push(opts.userId);
    }
    if (opts.day && /^\d{4}-\d{2}-\d{2}$/.test(opts.day)) {
      where.push(`date(f.at, '+5 hours') = ?`);
      args.push(opts.day);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (
      this.db.raw.prepare(`SELECT COUNT(*) AS n FROM (${feed}) f ${w}`).get(...args) as { n: number }
    ).n;
    const rows = this.db.raw
      .prepare(
        `SELECT f.at, f.kind, u.display_name AS user_name, f.subject, f.amount_paisa, f.detail
         FROM (${feed}) f LEFT JOIN users u ON u.id = f.user_id
         ${w} ORDER BY f.at DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, (page - 1) * pageSize) as ActivityItem[];
    const users = this.db.raw
      .prepare(`SELECT id, display_name FROM users ORDER BY display_name COLLATE NOCASE`)
      .all();
    return { items: rows.map((r) => this.tidy(r)), total, page, pageSize, users };
  }

  /** Short human detail from audit payloads. */
  private tidy(r: ActivityItem): ActivityItem {
    if (r.detail && r.detail.startsWith('{')) {
      try {
        const p = JSON.parse(r.detail) as Record<string, unknown>;
        if (r.kind === 'catalog.size_prices') {
          const sz = Array.isArray(p.sizes) ? (p.sizes as Array<{ name?: string; old?: number; new?: number }>) : [];
          const rs = (v: unknown) => `Rs ${Math.round(Number(v ?? 0) / 100).toLocaleString('en-US')}`;
          return {
            ...r,
            subject: `${String(p.name ?? '')} ${rs(p.old_price_paisa)} → ${rs(p.new_price_paisa)}`,
            detail: sz.map((x) => `${x.name} ${rs(x.old)} → ${rs(x.new)}`).join(' · '),
          };
        }
        if (r.kind === 'offers.campaign') {
          const msg = String(p.message ?? '').replace(/\s+/g, ' ').slice(0, 120);
          const inv = Number(p.invalid_phones ?? 0);
          return {
            ...r,
            subject: `${Number(p.opened ?? 0)} of ${Number(p.selected ?? 0)} opened`,
            detail: [msg, Number(p.skipped ?? 0) ? `skipped ${p.skipped}` : null, inv ? `bad phone ${inv}` : null].filter(Boolean).join(' · '),
          };
        }
        const subj = (p.short_id ?? p.name ?? r.subject) as string | null;
        const amount = (p.total_paisa as number | undefined) ?? null;
        const bits = [p.reason, p.note, p.qty != null ? `qty ${p.qty}` : null, p.new_short_id ? `→ ${p.new_short_id}` : null]
          .filter((x) => x != null && String(x).trim() !== '')
          .map(String);
        return { ...r, subject: subj ?? r.subject, amount_paisa: r.amount_paisa ?? amount, detail: bits.join(' · ') || null };
      } catch {
        return { ...r, detail: null };
      }
    }
    return r;
  }
}
