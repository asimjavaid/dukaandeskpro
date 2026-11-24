import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InventoryGuard, SellerGuard } from '../auth/roles.guard';
import { CostRedactInterceptor, MoneyRedactInterceptor } from '../auth/redact.interceptor';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { StockService } from './stock.service';
import { StockCountService } from './stock-count.service';
import { StockExtraService } from './stock-extra.service';
import { BadRequestException, HttpCode } from '@nestjs/common';

@Controller('stock')
@UseInterceptors(MoneyRedactInterceptor)
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly counts: StockCountService,
    private readonly extra: StockExtraService,
  ) {}

  /** Damaged / expired quick write-off (owner + data entry). */
  @Post('write-off')
  @HttpCode(201)
  @UseGuards(SessionGuard, InventoryGuard)
  writeOff(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    const r = this.extra.writeOff({ ...body, userId: req.session!.userId, storeId: req.session!.storeId });
    if (!r.ok) throw new BadRequestException(r);
    return r;
  }

  /** Write-off report with value (owner). */
  @Get('write-offs')
  @UseGuards(SessionGuard, OwnerGuard)
  writeOffs(@Query('from') from?: string, @Query('to') to?: string) {
    return { ok: true as const, ...this.extra.writeOffs({ from, to }) };
  }

  /** Reorder list: at/under reorder level with a suggested buy. */
  @Get('reorder')
  @UseGuards(SessionGuard, InventoryGuard)
  @UseInterceptors(CostRedactInterceptor)
  reorder() {
    return { ok: true as const, items: this.extra.reorder() };
  }

  /** Near-expiry / expired batches still on the shelf. */
  @Get('expiring')
  @UseGuards(SessionGuard, InventoryGuard)
  expiring(@Query('days') days?: string) {
    return { ok: true as const, ...this.extra.expiring(days ? Number(days) : undefined) };
  }

  @Post('expiring/:id/dismiss')
  @HttpCode(200)
  @UseGuards(SessionGuard, InventoryGuard)
  dismiss(@Param('id') id: string) {
    const r = this.extra.dismissBatch(id);
    if (!r.ok) throw new BadRequestException(r);
    return r;
  }

  /** List on-hand balances (base unit = piece). No cost. */
  @Get()
  @UseGuards(SessionGuard)
  list() {
    const items = this.stock.list();
    return { items, count: items.length };
  }

  /**
   * Owner receive.
   * piece: pieces + total Rs paid.
   * carton: pieces inside + carton cost Rs.
   * Unit cost = round(amount paisa / pieces). Does not rewrite past sales.
   */
  @Post('receive')
  @UseGuards(SessionGuard, InventoryGuard)
  receive(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      productId?: string;
      qty?: number;
      pieces?: number;
      unit?: string;
      amountRs?: number;
      amountPaisa?: number;
      note?: string;
      supplierId?: string;
      paidNow?: boolean;
    },
  ) {
    const result = this.stock.receive({
      productId: body.productId ?? '',
      qty: body.qty,
      pieces: body.pieces,
      unit: body.unit,
      amountRs: body.amountRs,
      amountPaisa: body.amountPaisa,
      receivedBy: req.session?.userId,
      note: body.note,
      supplierId: body.supplierId,
      paidNow: body.paidNow === true && req.session?.role === 'owner',
    });
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    return {
      ok: true as const,
      receive: result.receive,
      balance: result.balance,
      lastUnitCostPaisa: result.lastUnitCostPaisa,
    };
  }

  /** Current draft stock-count session for this store, or null. Owner-only. */
  @Get('counts/draft')
  @UseGuards(SessionGuard, OwnerGuard)
  draft(@Req() req: AuthedRequest) {
    const draft = this.counts.getDraft(req.session!.storeId);
    if (!draft) return { ok: true as const, session: null, lines: [] };
    return { ok: true as const, session: draft.session, lines: draft.lines };
  }

  /**
   * History list + dashboard stats (D29-c).
   * Default status=posted,draft (cancelled excluded). Owner-only.
   */
  @Get('counts')
  @UseGuards(SessionGuard, OwnerGuard)
  listCounts(
    @Req() req: AuthedRequest,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const n = limit != null ? Number(limit) : 20;
    const result = this.counts.listHistory({
      storeId: req.session!.storeId,
      status,
      source,
      limit: Number.isFinite(n) ? n : 20,
      before,
    });
    return {
      ok: true as const,
      items: result.items,
      count: result.items.length,
      lastFullCount: result.lastFullCount,
      monthlyShrinkage: result.monthlyShrinkage,
    };
  }

  /** Start a draft session. Fails with draft_exists if one is open — resume that. */
  @Post('counts')
  @UseGuards(SessionGuard, OwnerGuard)
  start(
    @Req() req: AuthedRequest,
    @Body() body: { source?: string; note?: string },
  ) {
    const result = this.counts.start({
      storeId: req.session!.storeId,
      userId: req.session!.userId,
      source: body?.source,
      note: body?.note,
    });
    if (!result.ok) {
      return {
        ok: false as const,
        error: result.error,
        session: result.draft?.session ?? null,
        lines: result.draft?.lines ?? [],
      };
    }
    return {
      ok: true as const,
      session: result.session,
      lines: result.lines,
    };
  }

  /** One-product quick count (Catalog later). Engine ready for S-SC3. */
  @Post('counts/quick')
  @UseGuards(SessionGuard, OwnerGuard)
  quick(
    @Req() req: AuthedRequest,
    @Body()
    body: { productId?: string; countedQty?: number; reasonCode?: string },
  ) {
    const result = this.counts.quick({
      storeId: req.session!.storeId,
      userId: req.session!.userId,
      productId: body?.productId ?? '',
      countedQty: body?.countedQty,
      reasonCode: body?.reasonCode,
    });
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    return {
      ok: true as const,
      mode: result.mode,
      session: result.session,
      adjusted: result.adjusted,
      totalAbsDelta: result.totalAbsDelta,
      adjustments: result.adjustments,
      lines: result.lines,
    };
  }

  /** Worksheet: active products × session lines with filter + progress (D29-e). */
  @Get('counts/:id/items')
  @UseGuards(SessionGuard, OwnerGuard)
  worksheet(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Query('filter') filter?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const pageN = page != null ? Number(page) : 1;
    const sizeN = pageSize != null ? Number(pageSize) : 20;
    const result = this.counts.getWorksheet({
      sessionId: id,
      storeId: req.session!.storeId,
      filter,
      q,
      page: Number.isFinite(pageN) ? pageN : 1,
      pageSize: Number.isFinite(sizeN) ? sizeN : 20,
    });
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    return {
      ok: true as const,
      session: result.session,
      items: result.items,
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      progress: result.progress,
    };
  }

  /** Session report for Review / Past Report (D29-d). */
  @Get('counts/:id')
  @UseGuards(SessionGuard, OwnerGuard)
  report(@Req() req: AuthedRequest, @Param('id') id: string) {
    const result = this.counts.getReport(id, req.session!.storeId);
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    return {
      ok: true as const,
      session: result.session,
      lines: result.lines,
      adjustments: result.adjustments,
      aggregates: result.aggregates,
      progress: result.progress,
    };
  }

  /** Upsert counted lines on a draft. Blank/null counted_qty = not counted. */
  @Put('counts/:id/lines')
  @UseGuards(SessionGuard, OwnerGuard)
  upsertLines(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      lines?: Array<{
        productId?: string;
        countedQty?: number | null;
        reasonCode?: string | null;
      }>;
      productId?: string;
      countedQty?: number | null;
      reasonCode?: string | null;
    },
  ) {
    const lines =
      Array.isArray(body?.lines) && body.lines.length > 0
        ? body.lines
        : body?.productId
          ? [
              {
                productId: body.productId,
                countedQty: body.countedQty,
                reasonCode: body.reasonCode,
              },
            ]
          : [];
    const result = this.counts.upsertLines({
      sessionId: id,
      storeId: req.session!.storeId,
      lines,
    });
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    return {
      ok: true as const,
      session: result.session,
      lines: result.lines,
    };
  }

  /** Post draft: absolute set on-hand from counted; ledger only when delta ≠ 0. */
  @Post('counts/:id/post')
  @UseGuards(SessionGuard, OwnerGuard)
  post(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {
    const result = this.counts.post({
      sessionId: id,
      storeId: req.session!.storeId,
      userId: req.session!.userId,
      note: body?.note,
    });
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    return {
      ok: true as const,
      session: result.session,
      adjusted: result.adjusted,
      skipped: result.skipped,
      totalAbsDelta: result.totalAbsDelta,
      adjustments: result.adjustments,
    };
  }

  @Post('counts/:id/cancel')
  @UseGuards(SessionGuard, OwnerGuard)
  cancel(@Req() req: AuthedRequest, @Param('id') id: string) {
    const result = this.counts.cancel({
      sessionId: id,
      storeId: req.session!.storeId,
    });
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    return { ok: true as const, session: result.session };
  }

  @Get('adjustments')
  @UseGuards(SessionGuard, InventoryGuard)
  adjustments(
    @Query('productId') productId?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit != null ? Number(limit) : 50;
    const items = this.counts.listAdjustments(
      productId?.trim() || undefined,
      Number.isFinite(n) ? n : 50,
    );
    return { items, count: items.length };
  }
}
