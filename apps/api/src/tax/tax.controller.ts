import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { TaxService, TaxDisposition } from './tax.service';
import { TaxSimulateOutcome } from './tax-adapter.port';
import { normalizeRateBp } from './inclusive';

/**
 * Tax routes are Owner-only.
 * D31 / D31.1: GET summary / years / months — period tax + All|Selected scope.
 * D30/D23: FBR queue routes stay dormant no-ops.
 */
@Controller('tax')
@UseGuards(SessionGuard, OwnerGuard)
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  @Get()
  info() {
    return this.tax.info();
  }

  /**
   * D31 / D31.1 — sales base (+ optional tax) for inclusive PKT from–to days.
   * scope=all (default) | products (+ product_ids, ≥1, ≤200).
   */
  @Get('summary')
  summary(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('rate_bp') rateBpRaw?: string,
    @Query('scope') scopeRaw?: string,
    @Query('product_ids') productIdsRaw?: string | string[],
  ) {
    const scoped = this.tax.resolveScope(scopeRaw, productIdsRaw);
    if (!scoped.ok) {
      throw new BadRequestException({ ok: false, error: scoped.error });
    }
    const rateBp =
      rateBpRaw !== undefined && String(rateBpRaw).trim() !== ''
        ? normalizeRateBp(rateBpRaw)
        : null;
    const result = this.tax.summarizePeriod({
      fromYmd: (from ?? '').trim(),
      toYmd: (to ?? '').trim(),
      rateBp: rateBp != null && rateBp > 0 ? rateBp : null,
      scope: scoped.scope,
      productIds: scoped.scope === 'products' ? scoped.productIds : null,
    });
    if (!result.ok) {
      throw new BadRequestException({ ok: false, error: result.error });
    }
    return result;
  }

  /** D31 — years with ≥1 non-voided sale, always including current PKT year. */
  @Get('years')
  years() {
    return this.tax.listTaxYears();
  }

  /**
   * D31.3 — Pakistan FYs (1 Jul–30 Jun) with ≥1 non-voided sale + current FY.
   * Newest first. Optional rate_bp for tax_paisa on each row.
   */
  @Get('fiscal-years')
  fiscalYears(@Query('rate_bp') rateBpRaw?: string) {
    const rateBp =
      rateBpRaw !== undefined && String(rateBpRaw).trim() !== ''
        ? normalizeRateBp(rateBpRaw)
        : null;
    return this.tax.listFiscalYears({
      rateBp: rateBp != null && rateBp > 0 ? rateBp : null,
    });
  }

  /**
   * D31 / D31.1 — twelve months for a year; same scope filter as summary.
   */
  @Get('months')
  months(
    @Query('year') yearRaw?: string,
    @Query('rate_bp') rateBpRaw?: string,
    @Query('scope') scopeRaw?: string,
    @Query('product_ids') productIdsRaw?: string | string[],
  ) {
    const scoped = this.tax.resolveScope(scopeRaw, productIdsRaw);
    if (!scoped.ok) {
      throw new BadRequestException({ ok: false, error: scoped.error });
    }
    const year = Number(yearRaw);
    const rateBp =
      rateBpRaw !== undefined && String(rateBpRaw).trim() !== ''
        ? normalizeRateBp(rateBpRaw)
        : null;
    const result = this.tax.listTaxMonths({
      year,
      rateBp: rateBp != null && rateBp > 0 ? rateBp : null,
      scope: scoped.scope,
      productIds: scoped.scope === 'products' ? scoped.productIds : null,
    });
    if (!result.ok) {
      throw new BadRequestException({ ok: false, error: result.error });
    }
    return result;
  }

  /** Owner tax queue: pending (queued/submitting) + rejected needing disposition. */
  @Get('queue')
  queue() {
    const items = this.tax.listQueue({ pendingOnly: true });
    return { items, count: items.length };
  }

  /** Historic one-liner (Owner-only; no longer fetched by Sell). */
  @Get('by-sale/:saleId')
  bySale(@Param('saleId') saleId: string) {
    return this.tax.bySale(saleId);
  }

  /**
   * Dormant while FBR is out of scope — returns { processed: false, disabled: true }.
   */
  @Post('process-next')
  processNext(
    @Body() body?: { outcome?: string },
  ) {
    const raw = (body?.outcome ?? '').toLowerCase().trim();
    let outcome: TaxSimulateOutcome | undefined;
    if (raw === 'accepted' || raw === 'accept') outcome = 'accepted';
    if (raw === 'rejected' || raw === 'reject') outcome = 'rejected';
    return this.tax.processNext({ outcome });
  }

  /** @deprecated alias → process-next */
  @Post('drain')
  drain() {
    return this.tax.processNext();
  }

  /** Dormant while FBR is out of scope — returns { ok: false, error: 'fbr_disabled' }. */
  @Post('enqueue')
  enqueue(@Body() body: { saleId?: string }) {
    return this.tax.enqueue(body?.saleId);
  }

  @Post(':id/void')
  voidSale(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.dispose(req, id, 'void');
  }

  @Post(':id/keep-flag')
  keepFlag(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.dispose(req, id, 'keep_flag');
  }

  @Post(':id/credit-note')
  creditNote(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.dispose(req, id, 'credit_note');
  }

  private dispose(
    req: AuthedRequest,
    id: string,
    disposition: TaxDisposition,
  ) {
    const result = this.tax.dispose(id, disposition, req.session?.userId);
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    return {
      ok: true as const,
      disposition: result.disposition,
      status: result.status,
      message: result.message,
      saleId: result.saleId,
    };
  }
}
