import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { InventoryGuard } from '../auth/roles.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { AuthedRequest, SessionGuard } from '../auth/session.guard';
import { DbService } from '../db/db.service';
import { applyPrices, readPricing, savePricing, suggestPrices } from './pricing';

@Controller('pricing')
@UseGuards(SessionGuard, InventoryGuard)
export class PricingController {
  constructor(private readonly db: DbService) {}

  @Get('settings')
  settings() {
    return { ok: true as const, pricing: readPricing(this.db.raw) };
  }

  @Post('settings')
  @HttpCode(200)
  @UseGuards(OwnerGuard)
  save(@Body() body: Record<string, unknown>) {
    const r = savePricing(this.db.raw, body ?? {});
    if (!r.ok) throw new BadRequestException(r);
    return r;
  }

  /** { lines: [{ productId, costPaisa, prevCostPaisa? }], onlyChanged? } */
  @Post('suggest')
  @HttpCode(200)
  suggest(@Body() body: { lines?: Array<Record<string, unknown>>; onlyChanged?: boolean }) {
    const lines = (Array.isArray(body?.lines) ? body.lines : []).slice(0, 500).map((l) => ({
      productId: String(l.productId ?? ''),
      costPaisa: Math.round(Number(l.costPaisa) || 0),
      prevCostPaisa: l.prevCostPaisa == null ? null : Math.round(Number(l.prevCostPaisa)),
    }));
    return { ok: true as const, items: suggestPrices(this.db.raw, lines, { onlyChanged: body?.onlyChanged === true }) };
  }

  @Post('apply')
  @HttpCode(200)
  apply(@Req() req: AuthedRequest, @Body() body: { items?: Array<{ productId?: unknown; pricePaisa?: unknown }> }) {
    const r = applyPrices(this.db.raw, body?.items ?? [], req.session?.userId ?? null);
    if (!r.ok) throw new BadRequestException(r);
    return r;
  }
}
