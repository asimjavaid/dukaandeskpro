import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TillService } from './till.service';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { SellerGuard } from '../auth/roles.guard';
import { AnalyticsService } from '../analytics/analytics.service';
import { TillsService } from '../tills/tills.service';
import { currentTillId } from '../tills/till-context';
import { isSupervisor } from '../auth/session.types';

type Target = { ok: true; tillId: string } | { ok: false; error: string };

/**
 * Slice 14 — Cashier Today (also OK for Owner).
 * GET /cashier/today — SessionGuard only; does not expose Owner /analytics.
 * Non-voided sales only (voided_at IS NULL). Asia/Karachi day helpers.
 */
@Controller('cashier')
@UseGuards(SessionGuard, SellerGuard)
export class CashierController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly till: TillService,
    private readonly tills: TillsService,
  ) {}

  /** This device's till, or another one (owner / manager only). */
  private target(req: AuthedRequest, asked: unknown): Target {
    const here = currentTillId();
    const want = typeof asked === 'string' && asked.trim() ? asked.trim() : here;
    if (!want) return { ok: false, error: 'no_till' };
    if (want !== here && !isSupervisor(req.session!.role)) return { ok: false, error: 'manager_only' };
    const t = this.tills.get(want);
    if (!t || !Number(t.active)) return { ok: false, error: 'till_not_found' };
    return { ok: true, tillId: want };
  }

  @Get('today')
  today(
    @Req() req: AuthedRequest,
    @Query('listLimit') listLimit?: string,
  ) {
    const limit =
      listLimit != null && listLimit !== '' ? Number(listLimit) : undefined;
    return this.analytics.cashierToday({
      storeId: req.session!.storeId,
      listLimit: limit,
    });
  }

  @Get('till')
  tillCurrent(@Req() req: AuthedRequest, @Query('tillId') tillId?: string) {
    const t = this.target(req, tillId);
    if (!t.ok) return { ...t, shift: null, summary: null, moves: [], last_counted_paisa: null };
    return { till: this.tills.view(t.tillId), ...this.till.current(t.tillId) };
  }

  @Post('till/open')
  tillOpen(@Req() req: AuthedRequest, @Body() body: { floatRs?: unknown; floatPaisa?: unknown; tillId?: unknown }) {
    const t = this.target(req, body?.tillId);
    if (!t.ok) return t;
    return this.till.open({ tillId: t.tillId, userId: req.session!.userId, floatRs: body?.floatRs, floatPaisa: body?.floatPaisa });
  }

  @Post('till/moves')
  tillMove(
    @Req() req: AuthedRequest,
    @Body() body: { kind?: unknown; amountRs?: unknown; amountPaisa?: unknown; reason?: unknown; tillId?: unknown },
  ) {
    const t = this.target(req, body?.tillId);
    if (!t.ok) return t;
    return this.till.move({ ...body, tillId: t.tillId, userId: req.session!.userId });
  }

  @Post('till/moves/:id/void')
  tillMoveVoid(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { tillId?: unknown }) {
    const t = this.target(req, body?.tillId);
    if (!t.ok) return t;
    return this.till.voidMove(t.tillId, id);
  }

  @Post('till/close')
  tillClose(
    @Req() req: AuthedRequest,
    @Body() body: { countedRs?: unknown; countedPaisa?: unknown; note?: unknown; tillId?: unknown },
  ) {
    const t = this.target(req, body?.tillId);
    if (!t.ok) return t;
    return this.till.close({ ...body, tillId: t.tillId, userId: req.session!.userId });
  }

  /** Shift history: this till; owner / manager may ask for one till or all (tillId=all). */
  @Get('till/shifts')
  tillHistory(
    @Req() req: AuthedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('tillId') tillId?: string,
  ) {
    let filter: string | null = currentTillId();
    if (isSupervisor(req.session!.role)) {
      if (tillId === 'all' || (!tillId && !filter)) filter = null;
      else if (tillId) filter = tillId;
    }
    return this.till.history({ page: Number(page), pageSize: Number(pageSize), tillId: filter });
  }

  @Get('till/shifts/:id')
  tillReport(@Param('id') id: string) {
    const r = this.till.report(id);
    if (!r) throw new NotFoundException('shift not found');
    return r;
  }
}
