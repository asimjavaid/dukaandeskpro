import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { DbService } from '../db/db.service';
import { writeAudit } from '../sales/sale-reversal';

export type AudienceRow = {
  id: string;
  name: string;
  phone: string | null;
  balance_paisa: number;
  last_sale_at: string | null;
  spent_30d_paisa: number;
  spent_90d_paisa: number;
};

const FILTERS = ['all', 'khata', 'recent', 'top'] as const;

/** Owner: WhatsApp offers — pick customers, then log the campaign. Nothing is sent by the server. */
@Controller('parties/offers')
@UseGuards(SessionGuard, OwnerGuard)
export class OffersController {
  constructor(private readonly db: DbService) {}

  @Get('audience')
  audience(@Query('filter') filterRaw?: string) {
    const filter = (FILTERS as readonly string[]).includes(String(filterRaw)) ? String(filterRaw) : 'all';
    const now = Date.now();
    const d30 = new Date(now - 30 * 86400_000).toISOString();
    const d90 = new Date(now - 90 * 86400_000).toISOString();
    let rows = this.db.raw
      .prepare(
        `SELECT p.id, p.name, p.phone,
                COALESCE((SELECT SUM(CASE WHEN l.entry_type = 'debit' THEN l.amount_paisa ELSE -l.amount_paisa END)
                          FROM party_ledger l WHERE l.party_id = p.id), 0) AS balance_paisa,
                (SELECT MAX(s.recorded_at) FROM sales s WHERE s.party_id = p.id AND s.voided_at IS NULL) AS last_sale_at,
                COALESCE((SELECT SUM(s.total_paisa) FROM sales s WHERE s.party_id = p.id AND s.voided_at IS NULL AND s.recorded_at >= ?), 0) AS spent_30d_paisa,
                COALESCE((SELECT SUM(s.total_paisa) FROM sales s WHERE s.party_id = p.id AND s.voided_at IS NULL AND s.recorded_at >= ?), 0) AS spent_90d_paisa
         FROM parties p
         ORDER BY p.name COLLATE NOCASE`,
      )
      .all(d30, d90) as AudienceRow[];
    if (filter === 'khata') rows = rows.filter((r) => Number(r.balance_paisa) > 0);
    if (filter === 'recent') rows = rows.filter((r) => r.last_sale_at != null && r.last_sale_at >= d30);
    if (filter === 'top') {
      rows = rows
        .filter((r) => Number(r.spent_90d_paisa) > 0)
        .sort((a, b) => Number(b.spent_90d_paisa) - Number(a.spent_90d_paisa))
        .slice(0, 20);
    }
    return { ok: true as const, filter, items: rows, count: rows.length };
  }

  /** Log one finished (or stopped) step-through campaign in the activity feed. */
  @Post('campaign')
  @HttpCode(200)
  campaign(
    @Req() req: AuthedRequest,
    @Body() body: { message?: string; selected?: number; opened?: number; skipped?: number; invalidPhones?: number },
  ) {
    const message = String(body?.message ?? '').trim();
    if (!message) throw new BadRequestException({ ok: false, error: 'message_required' });
    const n = (v: unknown) => Math.max(0, Math.min(100000, Math.floor(Number(v) || 0)));
    const payload = {
      message: message.slice(0, 2000),
      selected: n(body?.selected),
      opened: n(body?.opened),
      skipped: n(body?.skipped),
      invalid_phones: n(body?.invalidPhones),
    };
    const id = randomUUID();
    writeAudit(this.db.raw, {
      action: 'offers.campaign',
      userId: req.session?.userId ?? null,
      storeId: req.session?.storeId ?? null,
      subjectType: 'campaign',
      subjectId: id,
      payload,
    });
    return { ok: true as const, id, ...payload };
  }
}
