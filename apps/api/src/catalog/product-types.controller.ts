import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InventoryGuard } from '../auth/roles.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { AuthedRequest, SessionGuard } from '../auth/session.guard';
import { ProductTypesService } from './product-types.service';

@Controller('product-types')
@UseGuards(SessionGuard, InventoryGuard)
export class ProductTypesController {
  constructor(private readonly svc: ProductTypesService) {}

  /** Dry run: what a run would change. */
  @Get('plan')
  plan() {
    return this.svc.plan();
  }

  @Post('run')
  @HttpCode(200)
  @UseGuards(OwnerGuard)
  run(@Req() req: AuthedRequest) {
    return this.svc.run(req.session?.userId ?? null);
  }

  @Get('runs')
  runs() {
    return { ok: true as const, items: this.svc.runs() };
  }

  @Post('runs/:id/undo')
  @HttpCode(200)
  @UseGuards(OwnerGuard)
  undo(@Param('id') id: string) {
    const r = this.svc.undo(id);
    if (!r.ok) throw new BadRequestException(r);
    return r;
  }

  @Post('buy-units/run')
  @HttpCode(200)
  @UseGuards(OwnerGuard)
  runBuy(@Req() req: AuthedRequest) {
    return this.svc.runBuy(req.session?.userId ?? null);
  }

  @Get('buy-units/runs')
  buyRuns() {
    return { ok: true as const, items: this.svc.buyRuns() };
  }

  @Post('buy-units/runs/:id/undo')
  @HttpCode(200)
  @UseGuards(OwnerGuard)
  undoBuy(@Param('id') id: string) {
    const r = this.svc.undoBuy(id);
    if (!r.ok) throw new BadRequestException(r);
    return r;
  }

  @Get('settings')
  getSettings() {
    return { ok: true as const, settings: this.svc.settings() };
  }

  @Post('settings')
  @HttpCode(200)
  @UseGuards(OwnerGuard)
  setSettings(@Body() body: { sell_bulk_loose?: unknown }) {
    const r = this.svc.setSettings(body ?? {});
    if (!r.ok) throw new BadRequestException(r);
    return r;
  }

  @Get('review')
  review(@Query('all') all?: string) {
    const items = this.svc.review(all === '1');
    return { ok: true as const, items, bulks: this.svc.bulkList() };
  }

  @Post('review/:productId')
  @HttpCode(200)
  resolve(@Req() req: AuthedRequest, @Param('productId') id: string, @Body() body: { type?: unknown; bulkId?: unknown; kg?: unknown }) {
    const r = this.svc.resolve(id, body ?? {}, req.session?.userId ?? null);
    if (!r.ok) throw new BadRequestException(r);
    return r;
  }
}
