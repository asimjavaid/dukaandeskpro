import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InventoryGuard, SellerGuard } from '../auth/roles.guard';
import { CostRedactInterceptor, MoneyRedactInterceptor } from '../auth/redact.interceptor';
import { AuthedRequest, SessionGuard } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { parseListPage } from '../common/list-page';
import { PurchaseLineInput, PurchasesService } from './purchases.service';

@Controller('purchases')
@UseGuards(SessionGuard, InventoryGuard)
@UseInterceptors(MoneyRedactInterceptor)
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const paging = parseListPage({ page, pageSize, limit, offset });
    const listed = this.purchases.list(paging);
    return { ok: true as const, ...listed, count: listed.items.length };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const result = this.purchases.get(id);
    if (!result.ok) return { ok: false as const, error: result.error };
    return result;
  }

  @Post()
  create(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      supplierId?: string;
      lines?: PurchaseLineInput[];
      discountRs?: number;
      discountPaisa?: number;
      paidRs?: number;
      paidPaisa?: number;
      purchasedOn?: string;
      note?: string | null;
      extras?: unknown;
    },
  ) {
    // Data entry copies the supplier's bill (costs included) but never pays from the till.
    const owner = req.session?.role === 'owner';
    const result = this.purchases.create({
      supplierId: body?.supplierId,
      lines: body?.lines,
      discountRs: body?.discountRs,
      discountPaisa: body?.discountPaisa,
      paidRs: owner ? body?.paidRs : 0,
      paidPaisa: owner ? body?.paidPaisa : undefined,
      purchasedOn: body?.purchasedOn,
      note: body?.note,
      extras: body?.extras,
      createdBy: req.session?.userId,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    return result;
  }
}
