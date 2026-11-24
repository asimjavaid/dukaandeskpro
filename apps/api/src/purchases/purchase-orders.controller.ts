import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InventoryGuard } from '../auth/roles.guard';
import { MoneyRedactInterceptor } from '../auth/redact.interceptor';
import { AuthedRequest, SessionGuard } from '../auth/session.guard';
import { PurchaseOrdersService } from './purchase-orders.service';
import { purchaseTargets } from './purchase-targets';
import { DbService } from '../db/db.service';

type Body_ = Record<string, any>;

@Controller('purchase-orders')
@UseGuards(SessionGuard, InventoryGuard)
@UseInterceptors(MoneyRedactInterceptor)
export class PurchaseOrdersController {
  constructor(
    private readonly po: PurchaseOrdersService,
    private readonly db: DbService,
  ) {}

  @Get()
  list(@Query('status') status?: string) {
    const items = this.po.list(status);
    return { ok: true as const, items, count: items.length };
  }

  @Get('suggest')
  suggest() {
    return { ok: true as const, groups: this.po.suggest() };
  }

  /** How a product is bought (kg / carton / crate / piece) and units per package from the last bill. */
  @Get('buy-info')
  buyInfo(@Query('supplierId') supplierId?: string, @Query('ids') ids?: string) {
    return { ok: true as const, byProduct: this.po.buyInfo(String(supplierId ?? ''), String(ids ?? '').split(',').filter(Boolean).slice(0, 200)) };
  }

  /** Low-stock prefill: packed items become kg of their loose source; normal / bulk pass through. */
  @Post('targets')
  @HttpCode(200)
  targets(@Body() body: Body_) {
    const items = Array.isArray(body?.items) ? (body.items as Array<{ id: string; qty?: number }>).slice(0, 300) : [];
    return { ok: true as const, ...purchaseTargets(this.db.raw, items) };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.po.get(id);
  }

  @Post()
  @HttpCode(200)
  create(@Req() req: AuthedRequest, @Body() body: Body_) {
    return this.po.create({ supplierId: body?.supplierId, lines: body?.lines, note: body?.note, userId: req.session?.userId });
  }

  @Post('from-low-stock')
  @HttpCode(200)
  fromLowStock(@Req() req: AuthedRequest, @Body() body: Body_) {
    return this.po.fromLowStock({ groups: body?.groups, userId: req.session?.userId });
  }

  @Patch(':id')
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: Body_) {
    return this.po.update(id, { supplierId: body?.supplierId, lines: body?.lines, note: body?.note, userId: req.session?.userId });
  }

  @Post(':id/sent')
  @HttpCode(200)
  sent(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.po.markSent(id, req.session?.userId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.po.cancel(id, req.session?.userId);
  }

  @Post(':id/receive')
  @HttpCode(200)
  receive(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: Body_) {
    if (!body || typeof body !== 'object') throw new BadRequestException();
    const owner = req.session?.role === 'owner';
    return this.po.receive(id, {
      lines: body.lines,
      discountRs: body.discountRs,
      discountPaisa: body.discountPaisa,
      // Data entry never pays from the till (same as New bill).
      paidRs: owner ? body.paidRs : 0,
      paidPaisa: owner ? body.paidPaisa : undefined,
      purchasedOn: body.purchasedOn,
      note: body.note,
      extras: body.extras,
      close: body.close === true,
      userId: req.session?.userId,
      canSetPrice: owner,
    });
  }
}
