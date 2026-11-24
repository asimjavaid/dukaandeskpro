import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { OwnerGuard } from '../auth/owner.guard';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { SupplierReturnsService } from './supplier-returns.service';
import { InventoryGuard } from '../auth/roles.guard';
import { MoneyRedactInterceptor } from '../auth/redact.interceptor';
import { parseListPage } from '../common/list-page';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
@UseGuards(SessionGuard, InventoryGuard)
@UseInterceptors(MoneyRedactInterceptor)
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly returns: SupplierReturnsService,
  ) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const paging = parseListPage({ page, pageSize, limit, offset });
    const listed = this.suppliers.list(paging);
    return { ok: true as const, ...listed, count: listed.items.length };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const result = this.suppliers.get(id);
    if (!result.ok) return { ok: false as const, error: result.error };
    return result;
  }

  @Post()
  create(
    @Body()
    body: {
      name?: string;
      contact_name?: string | null;
      phone?: string | null;
      address?: string | null;
    },
  ) {
    const result = this.suppliers.create({
      name: body?.name,
      contact_name: body?.contact_name,
      phone: body?.phone,
      address: body?.address,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, supplier: result.supplier };
  }


  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      contact_name?: string | null;
      phone?: string | null;
      address?: string | null;
    },
  ) {
    const result = this.suppliers.update(id, {
      name: body?.name,
      contact_name: body?.contact_name,
      phone: body?.phone,
      address: body?.address,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    return { ok: true as const, supplier: result.supplier };
  }

  @Post(':id/payments')
  @UseGuards(OwnerGuard)
  pay(
    @Param('id') id: string,
    @Body()
    body: {
      amountRs?: number;
      amountPaisa?: number;
      paidOn?: string;
      date?: string;
      note?: string | null;
    },
  ) {
    const result = this.suppliers.pay(id, {
      amountRs: body?.amountRs,
      amountPaisa: body?.amountPaisa,
      paidOn: body?.paidOn ?? body?.date,
      note: body?.note,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    return {
      ok: true as const,
      supplier: result.supplier,
      payment: result.payment,
    };
  }

  /** Owner: send goods back to this supplier (stock down, owed amount down). */
  @Post(':id/returns')
  @UseGuards(OwnerGuard)
  sendBack(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { lines?: Array<{ productId?: unknown; qty?: unknown; unitCostRs?: unknown }>; note?: string },
  ) {
    return this.returns.create({
      supplierId: id,
      lines: body?.lines,
      note: body?.note,
      userId: req.session!.userId,
      storeId: req.session!.storeId,
    });
  }

  @Get('returns/:rid')
  @UseGuards(OwnerGuard)
  oneReturn(@Param('rid') rid: string) {
    const r = this.returns.get(rid);
    return r ? { ok: true as const, return: r } : { ok: false as const, error: 'not_found' };
  }
}
