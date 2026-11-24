import {
  BadRequestException, ForbiddenException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { SellerGuard } from '../auth/roles.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { ReturnsService, ReturnLineInput } from './returns.service';
import { SalesQueryService } from '../sales/sales-query.service';
import { ApprovalService } from '../auth/approval.service';
import { isSupervisor } from '../auth/session.types';
import { DbService } from '../db/db.service';
import { readShopRules } from '../settings/shop-rules';

@Controller('returns')
export class ReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly salesQuery: SalesQueryService,
    private readonly approvals: ApprovalService,
    private readonly db: DbService,
  ) {}

  @Get()
  @UseGuards(SessionGuard, SellerGuard)
  list(
    @Req() req: AuthedRequest,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('saleId') saleId?: string,
    @Query('page') page?: string,
  ) {
    const r = this.returns.list({ role: req.session!.role, q, from, to, saleId, page: Number(page) || 1 });
    if (!r.ok) throw new BadRequestException(r);
    return r;
  }

  /** Bills a return can be made against (last 90 days, not removed). Both roles. */
  @Get('bills')
  @UseGuards(SessionGuard, SellerGuard)
  bills(@Query('q') q?: string) {
    return { ok: true as const, items: this.returns.findBills(q ?? '') };
  }

  /** One bill for the Returns screen (any day, both roles). */
  @Get('bills/:id')
  @UseGuards(SessionGuard, SellerGuard)
  bill(@Param('id') id: string) {
    const r = this.salesQuery.get(id, { role: 'owner' });
    if (!r.ok) throw new NotFoundException({ ok: false, error: 'sale_not_found' });
    return {
      ok: true as const,
      sale: { ...r.sale, cash_refundable_paisa: this.returns.cashRefundable(r.sale.id, r.sale.cash_amount_paisa) },
    };
  }

  /** Owner: undo a return made today. */
  @Post(':id/undo')
  @HttpCode(200)
  @UseGuards(SessionGuard, OwnerGuard)
  undo(@Req() req: AuthedRequest, @Param('id') id: string) {
    const r = this.returns.undo({ returnId: id, userId: req.session!.userId, storeId: req.session!.storeId });
    if (!r.ok) {
      if (r.error === 'return_not_found') throw new NotFoundException(r);
      throw new BadRequestException(r);
    }
    return r;
  }

  @Get(':id')
  @UseGuards(SessionGuard, SellerGuard)
  get(@Param('id') id: string) {
    const r = this.returns.get(id);
    if (!r.ok) throw new NotFoundException(r);
    return r;
  }

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, SellerGuard)
  create(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      saleId?: string;
      lines?: ReturnLineInput[];
      refundCashPaisa?: number | null;
      refundKhataPaisa?: number | null;
      reason?: string | null;
      clientDeviceAt?: string | null;
      /** Manager approval token (cashier refunds, when the shop rule asks for it). */
      approval?: string | null;
    },
  ) {
    const role = req.session!.role;
    let approvedBy: string | null = isSupervisor(role) ? req.session!.userId : null;
    const needs = !isSupervisor(role) && readShopRules(this.db.raw).cashier_refund_needs_manager;
    if (needs) {
      approvedBy = this.approvals.peek(body?.approval, 'refund');
      if (!approvedBy) throw new ForbiddenException({ ok: false, error: 'manager_approval_needed' });
    }
    const r = this.returns.create({
      approvedBy,
      saleId: body?.saleId ?? '',
      lines: body?.lines ?? [],
      refundCashPaisa: body?.refundCashPaisa,
      refundKhataPaisa: body?.refundKhataPaisa,
      reason: body?.reason,
      clientDeviceAt: body?.clientDeviceAt,
      userId: req.session!.userId,
      storeId: req.session!.storeId,
    });
    if (!r.ok) {
      if (r.error === 'sale_not_found') throw new NotFoundException(r);
      throw new BadRequestException(r);
    }
    if (needs) this.approvals.consume(body?.approval, 'refund');
    return r;
  }
}
