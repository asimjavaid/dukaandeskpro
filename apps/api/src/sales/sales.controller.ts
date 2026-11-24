import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { SellerGuard } from '../auth/roles.guard';
import {
  SalesService,
  SaleLineInput,
  PaymentMethod,
} from './sales.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { SalesQueryService } from './sales-query.service';
import { SalesWriteService } from './sales-write.service';
import { ApprovalService } from '../auth/approval.service';
import { isSupervisor } from '../auth/session.types';

const REFUSALS: Record<string, number> = {
  owner_only: 403,
  sale_not_found: 404,
  sale_not_today: 409,
  sale_already_voided: 409,
  sale_has_returns: 409,
  reason_required: 400,
};

function refuse(error: string): never {
  const code = REFUSALS[error] ?? 400;
  const body = { ok: false, error };
  if (code === 403) throw new ForbiddenException(body);
  if (code === 404) throw new NotFoundException(body);
  if (code === 409) throw new ConflictException(body);
  throw new BadRequestException(body);
}

@Controller('sales')
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly analytics: AnalyticsService,
    private readonly salesQuery: SalesQueryService,
    private readonly salesWrite: SalesWriteService,
    private readonly approvals: ApprovalService,
  ) {}

  /** Remove a bill (Owner, same PKT day, reason required, no returns). */
  @Post(':id/void')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  voidSale(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    const r = this.salesWrite.voidSale({
      saleId: id,
      reason: body?.reason,
      role: req.session!.role,
      userId: req.session!.userId,
      storeId: req.session!.storeId,
    });
    if (!r.ok) refuse(r.error);
    return r;
  }

  /** Edit a bill = remove it and issue a new one (Owner, same PKT day). */
  @Post(':id/replace')
  @HttpCode(201)
  @UseGuards(SessionGuard)
  replaceSale(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      lines?: SaleLineInput[];
      paymentMethod?: string;
      partyId?: string | null;
      cashAmountPaisa?: number;
      udhaarAmountPaisa?: number;
      tenderedPaisa?: number;
      applySurplusToKhata?: boolean;
      clientDeviceAt?: string;
      discount?: { kind?: string; value?: number } | null;
      digitalPaisa?: number | null;
      digitalMethod?: string | null;
      digitalRef?: string | null;
      overrideCreditLimit?: boolean | null;
      loyaltyRedeemPoints?: number | null;
    },
  ) {
    const m = String(body?.paymentMethod ?? 'cash').toLowerCase().trim();
    if (m !== 'cash' && m !== 'udhaar' && m !== 'split') {
      throw new BadRequestException({ ok: false, error: 'payment_method_not_supported' });
    }
    const r = this.salesWrite.replaceSale({
      saleId: id,
      role: req.session!.role,
      userId: req.session!.userId,
      storeId: req.session!.storeId,
      lines: body?.lines ?? [],
      paymentMethod: m as PaymentMethod,
      partyId: body?.partyId,
      cashAmountPaisa: body?.cashAmountPaisa,
      udhaarAmountPaisa: body?.udhaarAmountPaisa,
      tenderedPaisa: body?.tenderedPaisa,
      applySurplusToKhata: Boolean(body?.applySurplusToKhata),
      clientDeviceAt: body?.clientDeviceAt,
      extras: {
        discount: body?.discount ?? null,
        digitalPaisa: body?.digitalPaisa ?? null,
        digitalMethod: body?.digitalMethod ?? null,
        digitalRef: body?.digitalRef ?? null,
        overrideCreditLimit: body?.overrideCreditLimit ?? null,
        loyaltyRedeemPoints: body?.loyaltyRedeemPoints ?? null,
        role: req.session!.role,
      },
    });
    if (!r.ok) {
      if (r.error === 'insufficient_stock') {
        throw new ConflictException({ ok: false, error: r.error, shortages: r.shortages ?? [] });
      }
      if (r.error === 'price_changed') {
        throw new ConflictException({ ok: false, error: r.error, prices: r.prices ?? [] });
      }
      refuse(r.error);
    }
    return { ok: true as const, sale: r.sale, replaces: r.replaces };
  }

  /**
   * Sales screen list. Owner: any PKT day range. Cashier: today only
   * (range/from/to ignored). Search q matches bill no, customer name/phone,
   * item name / Urdu name / exact barcode, or a Rs amount (= bill total).
   * paid=all|cash|khata|both · status=all|active|removed|returned · page.
   */
  @Get()
  @UseGuards(SessionGuard)
  list(
    @Req() req: AuthedRequest,
    @Query('q') q?: string,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('paid') paid?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const result = this.salesQuery.list({
      role: req.session!.role,
      storeId: req.session!.storeId,
      q,
      range,
      from,
      to,
      paid,
      status,
      page: page != null && page !== '' ? Number(page) : undefined,
      pageSize: pageSize != null && pageSize !== '' ? Number(pageSize) : undefined,
    });
    if (!result.ok) {
      throw new BadRequestException({ ok: false, error: result.error });
    }
    return result;
  }

  /**
   * Slice 14 — Today summary (Cashier + Owner). Alias of GET /cashier/today.
   * Non-voided only; Asia/Karachi day. No cost/margin/profit.
   */
  @Get('today')
  @UseGuards(SessionGuard, SellerGuard)
  today(
    @Req() req: AuthedRequest,
    @Query('listLimit') listLimit?: string,
  ) {
    const limit =
      listLimit != null && listLimit !== '' ? Number(listLimit) : undefined;
    return this.analytics.cashierToday({
      storeId: req.session!.storeId,
      listLimit: limit,
    });
  }

  /**
   * Complete a cash, udhaar, or split sale: write sales + sale_lines
   * (+ ledger debit for udhaar portion; optional surplus credit to khata)
   * and decrement stock in one txn.
   * Split: cashAmountPaisa + udhaarAmountPaisa = total; party optional on all methods.
   * applySurplusToKhata: when party set and overpay, credit surplus instead of change.
   * Without party the flag is ignored (change returned).
   * Tax V1 (D30 LOCK): no FBR — never enqueues a tax document. When the
   * Owner has Sales Tax ON, the sale carries an inclusive tax snapshot
   * (taxEnabled / taxRateBp / taxPaisa / taxBasePaisa); totals are unchanged.
   * Refuses with 409 if any line would drive on-hand below zero.
   * Session: Owner or Cashier.
   */
  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, SellerGuard)
  complete(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      lines?: SaleLineInput[];
      paymentMethod?: string;
      partyId?: string | null;
      cashAmountPaisa?: number;
      udhaarAmountPaisa?: number;
      tenderedPaisa?: number;
      applySurplusToKhata?: boolean;
      /** Aliases accepted for Archie / clients */
      cash_amount?: number;
      udhaar_amount?: number;
      tendered_paisa?: number;
      apply_surplus_to_khata?: boolean;
      keep_change_as_credit?: boolean;
      keepChangeAsCredit?: boolean;
      clientDeviceAt?: string;
      discount?: { kind?: string; value?: number } | null;
      digitalPaisa?: number | null;
      digitalMethod?: string | null;
      digitalRef?: string | null;
      overrideCreditLimit?: boolean | null;
      loyaltyRedeemPoints?: number | null;
      /** Manager approval token for line price overrides (cashier). */
      approval?: string | null;
      /** Lite: id of this payment attempt; a retry after a lost answer returns the bill already saved. */
      clientUuid?: string | null;
    },
  ) {
    const clientUuid =
      typeof body.clientUuid === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.clientUuid)
        ? body.clientUuid.toLowerCase()
        : null;
    if (clientUuid) {
      const done = this.sales.findByClientUuid(clientUuid);
      if (done) return { ok: true as const, duplicate: true, sale: done };
    }
    // Line price override: owner / manager themselves, or a cashier with a manager's approval.
    const lines = Array.isArray(body.lines) ? body.lines : [];
    let overrideBy: string | null = null;
    if (lines.some((l) => l && l.overridePricePaisa != null)) {
      if (isSupervisor(req.session?.role)) overrideBy = req.session!.userId;
      else {
        overrideBy = this.approvals.peek(body.approval, 'price_override');
        if (!overrideBy) throw new ForbiddenException({ ok: false, error: 'manager_approval_needed' });
      }
    }
    const methodRaw = (body.paymentMethod ?? 'cash').toLowerCase().trim();
    if (
      methodRaw !== 'cash' &&
      methodRaw !== 'udhaar' &&
      methodRaw !== 'split'
    ) {
      return { ok: false as const, error: 'payment_method_not_supported' };
    }
    const paymentMethod = methodRaw as PaymentMethod;

    const cashAmountPaisa =
      body.cashAmountPaisa != null
        ? body.cashAmountPaisa
        : body.cash_amount != null
          ? body.cash_amount
          : undefined;
    const udhaarAmountPaisa =
      body.udhaarAmountPaisa != null
        ? body.udhaarAmountPaisa
        : body.udhaar_amount != null
          ? body.udhaar_amount
          : undefined;

    const tenderedPaisa =
      body.tenderedPaisa != null
        ? body.tenderedPaisa
        : body.tendered_paisa != null
          ? body.tendered_paisa
          : undefined;

    const applySurplusToKhata = Boolean(
      body.applySurplusToKhata ??
        body.apply_surplus_to_khata ??
        body.keepChangeAsCredit ??
        body.keep_change_as_credit,
    );

    const result = this.sales.completeSale({
      lines: body.lines ?? [],
      paymentMethod,
      partyId: body.partyId,
      cashAmountPaisa,
      udhaarAmountPaisa,
      tenderedPaisa,
      applySurplusToKhata,
      clientDeviceAt: body.clientDeviceAt,
      soldBy: req.session?.userId,
      storeId: req.session?.storeId,
      extras: {
        discount: body.discount ?? null,
        digitalPaisa: body.digitalPaisa ?? null,
        digitalMethod: body.digitalMethod ?? null,
        digitalRef: body.digitalRef ?? null,
        overrideCreditLimit: body.overrideCreditLimit ?? null,
        loyaltyRedeemPoints: body.loyaltyRedeemPoints ?? null,
        role: req.session?.role ?? null,
        overrideBy,
      },
      clientUuid,
    });
    if (!result.ok && result.error === 'duplicate' && clientUuid) {
      const done = this.sales.findByClientUuid(clientUuid);
      if (done) return { ok: true as const, duplicate: true, sale: done };
    }

    if (result.ok && overrideBy && !isSupervisor(req.session?.role)) this.approvals.consume(body.approval, 'price_override');
    if (result.ok && overrideBy) {
      this.sales.auditOverride(result.sale.id, req.session!.userId, overrideBy);
    }

    if (!result.ok) {
      if (result.error === 'insufficient_stock') {
        throw new ConflictException({
          ok: false,
          error: 'insufficient_stock',
          shortages: result.shortages ?? [],
        });
      }
      if (result.error === 'price_changed') {
        throw new ConflictException({
          ok: false,
          error: 'price_changed',
          prices: result.prices ?? [],
        });
      }
      return { ok: false as const, error: result.error };
    }

    // FBR is out of scope for P1 (D30 LOCK) — nothing is queued after commit.
    return { ok: true as const, sale: result.sale, creditWarning: result.creditWarning ?? null };
  }

  /**
   * One bill: lines, payment split, customer, cashier, status.
   * Accepts the sale id or the bill no. Cashier: today's bills only.
   */
  @Get(':id')
  @UseGuards(SessionGuard)
  detail(@Req() req: AuthedRequest, @Param('id') id: string) {
    const result = this.salesQuery.get(id, { role: req.session!.role });
    if (!result.ok) {
      if (result.error === 'forbidden') {
        throw new ForbiddenException({ ok: false, error: 'sale_not_today' });
      }
      throw new NotFoundException({ ok: false, error: 'sale_not_found' });
    }
    return { ok: true as const, sale: result.sale };
  }
}
