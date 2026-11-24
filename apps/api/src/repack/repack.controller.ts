import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InventoryGuard } from '../auth/roles.guard';
import { CostRedactInterceptor } from '../auth/redact.interceptor';
import { OwnerGuard } from '../auth/owner.guard';
import { AuthedRequest, SessionGuard } from '../auth/session.guard';
import { RepackService } from './repack.service';

type B = Record<string, any>;

@Controller('packs')
@UseGuards(SessionGuard, InventoryGuard)
@UseInterceptors(CostRedactInterceptor)
export class PacksController {
  constructor(private readonly svc: RepackService) {}

  @Get()
  list(@Query('productId') productId?: string, @Query('ids') ids?: string) {
    if (ids) return { ok: true as const, byProduct: this.svc.packsFor(ids.split(',').filter(Boolean).slice(0, 200)) };
    return { ok: true as const, items: this.svc.packs(String(productId ?? '')), names: this.svc.packNames() };
  }

  @Get('hint')
  hint(@Query('supplierId') supplierId?: string, @Query('productId') productId?: string) {
    return this.svc.hint(String(supplierId ?? ''), String(productId ?? ''));
  }

  @Get('lookup')
  lookup(@Query('barcode') barcode?: string) {
    return this.svc.lookupPack(String(barcode ?? ''));
  }

  @Post()
  @HttpCode(200)
  add(@Body() b: B) {
    return this.svc.addPack({ productId: b?.productId, name: b?.name, units: b?.units, barcode: b?.barcode });
  }

  @Post(':id/remove')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.svc.removePack(id);
  }
}

@Controller('repack')
@UseGuards(SessionGuard, InventoryGuard)
@UseInterceptors(CostRedactInterceptor)
export class RepackController {
  constructor(private readonly svc: RepackService) {}

  @Get()
  list(@Query('from') from?: string, @Query('to') to?: string) {
    return { ok: true as const, items: this.svc.list({ from, to }) };
  }

  @Get('report')
  report(@Query('from') from?: string, @Query('to') to?: string) {
    return { ok: true as const, ...this.svc.report({ from, to }) };
  }

  @Get('bulk')
  bulk() {
    return { ok: true as const, items: this.svc.bulkItems() };
  }

  @Post('link')
  @HttpCode(200)
  link(@Body() b: B) {
    return this.svc.link({ productId: b?.productId, bulkId: b?.bulkId, qtyEach: b?.qtyEach });
  }

  @Get('link/:productId')
  getLink(@Param('productId') productId: string) {
    return this.svc.getLink(productId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  @HttpCode(200)
  create(@Req() req: AuthedRequest, @Body() b: B) {
    return this.svc.create({
      bulkId: b?.bulkId,
      lines: b?.lines,
      bulkUsed: b?.bulkUsed,
      wastage: b?.wastage,
      packingCostRs: b?.packingCostRs,
      packingCostPaisa: b?.packingCostPaisa,
      packingPerPackRs: b?.packingPerPackRs,
      packingPerPackPaisa: b?.packingPerPackPaisa,
      bulkCostRs: b?.bulkCostRs,
      bulkCostPaisa: b?.bulkCostPaisa,
      note: b?.note,
      userId: req.session?.userId,
    });
  }

  @Post(':id/undo')
  @HttpCode(200)
  @UseGuards(OwnerGuard)
  undo(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.svc.undo(id, req.session?.userId);
  }
}
