import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { AnalyticsService } from './analytics.service';
import { karachiYmd } from '../sales/sale-reversal';

/**
 * Owner analytics home (Slice 7).
 * GET /analytics — today + last 7 days sales, top products, low stock, udhaar outstanding.
 * Cashier → 403 via OwnerGuard. All aggregates from local SQLite.
 */
@Controller('analytics')
@UseGuards(SessionGuard, OwnerGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  summary(
    @Req() req: AuthedRequest,
    @Query('lowStockThreshold') lowStockThreshold?: string,
    @Query('topLimit') topLimit?: string,
  ) {
    const threshold =
      lowStockThreshold != null && lowStockThreshold !== ''
        ? Number(lowStockThreshold)
        : undefined;
    const top =
      topLimit != null && topLimit !== '' ? Number(topLimit) : undefined;

    return this.analytics.summary({
      storeId: req.session!.storeId,
      lowStockThreshold: threshold,
      topLimit: top,
    });
  }

  /** Today extras: cash expected in till, top 3 udhaar customers, not sold in 30 days (first 10). */
  @Get('insights')
  insights(@Req() req: AuthedRequest) {
    return this.analytics.insights({ storeId: req.session!.storeId });
  }

  /** Full "not sold in 30 days" list, paged. */
  @Get('slow-movers')
  slowMovers(
    @Req() req: AuthedRequest,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.analytics.slowMovers({
      storeId: req.session!.storeId,
      page: page != null && page !== '' ? Number(page) : undefined,
      pageSize: pageSize != null && pageSize !== '' ? Number(pageSize) : undefined,
    });
  }

  /** Profit tab extras: this week vs last week, top items by profit (this week). */
  @Get('profit-compare')
  profitCompare(@Req() req: AuthedRequest, @Query('topLimit') topLimit?: string) {
    return this.analytics.profitCompare({
      storeId: req.session!.storeId,
      topLimit: topLimit != null && topLimit !== '' ? Number(topLimit) : undefined,
    });
  }

  /** Profit per product for a date range (YYYY-MM-DD, Karachi). Owner only. */
  @Get('product-profit')
  productProfit(@Req() req: AuthedRequest, @Query('from') from?: string, @Query('to') to?: string) {
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    const today = karachiYmd(new Date());
    const toDay = to && ymd.test(to) ? to : today;
    const fromDay = from && ymd.test(from) ? from : toDay.slice(0, 8) + '01';
    return { ok: true as const, ...this.analytics.productProfit(fromDay, toDay, req.session?.storeId) };
  }
}
