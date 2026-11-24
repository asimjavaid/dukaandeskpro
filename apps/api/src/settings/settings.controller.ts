import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  Res,
} from '@nestjs/common';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { SettingsService } from './settings.service';
import { SessionService } from '../auth/session.service';
import { DbService } from '../db/db.service';
import { readShopRules, saveShopRules } from './shop-rules';
import { writeAudit } from '../sales/sale-reversal';
import type { Response } from 'express';

type StoreBody = {
  name?: string;
  phone?: string | null;
  address?: string | null;
  receipt_footer?: string | null;
  receiptFooter?: string | null;
  locale_default?: string;
  localeDefault?: string;
  receipt_printer_name?: string | null;
  receiptPrinterName?: string | null;
  receipt_width_mm?: number;
  receiptWidthMm?: number;
  receipt_print_enabled?: boolean;
  receiptPrintEnabled?: boolean;
  reports_printer_name?: string | null;
  reportsPrinterName?: string | null;
  reports_paper?: string;
  reportsPaper?: string;
  label_printer_name?: string | null;
  labelPrinterName?: string | null;
  label_size?: string;
  labelSize?: string;
  label_per_row?: number;
  labelPerRow?: number;
  sales_tax_enabled?: boolean;
  salesTaxEnabled?: boolean;
  sales_tax_rate_percent?: number | string | null;
  salesTaxRatePercent?: number | string | null;
  sales_tax_rate_bp?: number | null;
  salesTaxRateBp?: number | null;
};

type PinBody = {
  current_pin?: string;
  currentPin?: string;
  new_pin?: string;
  newPin?: string;
};

/**
 * Owner Settings (Slice 13).
 * GET/PATCH /settings/store — store profile
 * POST /settings/pin — change Owner PIN
 * GET /settings/about — product / version (sqlite path redacted)
 * Tax V1: Sales Tax switch + rate live on /settings/store (Owner-only, audited).
 * Cashier → 403 on mutate via OwnerGuard.
 */
@Controller('settings')
@UseGuards(SessionGuard, OwnerGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly sessions: SessionService,
    private readonly db: DbService,
  ) {}

  @Get('store')
  getStore(@Req() req: AuthedRequest) {
    const store = this.settings.getStore(req.session!.storeId);
    if (!store) throw new NotFoundException('store not found');
    return { ok: true as const, store };
  }

  @Patch('store')
  patchStore(@Req() req: AuthedRequest, @Body() body: StoreBody) {
    const result = this.settings.patchStore(req.session!.storeId, {
      name: body.name,
      phone: body.phone,
      address: body.address,
      receipt_footer:
        body.receipt_footer !== undefined
          ? body.receipt_footer
          : body.receiptFooter,
      locale_default:
        body.locale_default !== undefined
          ? body.locale_default
          : body.localeDefault,
      receipt_printer_name:
        body.receipt_printer_name !== undefined
          ? body.receipt_printer_name
          : body.receiptPrinterName,
      receipt_width_mm:
        body.receipt_width_mm !== undefined
          ? body.receipt_width_mm
          : body.receiptWidthMm,
      receipt_print_enabled:
        body.receipt_print_enabled !== undefined
          ? body.receipt_print_enabled
          : body.receiptPrintEnabled,
      reports_printer_name:
        body.reports_printer_name !== undefined
          ? body.reports_printer_name
          : body.reportsPrinterName,
      reports_paper:
        body.reports_paper !== undefined ? body.reports_paper : body.reportsPaper,
      label_printer_name:
        body.label_printer_name !== undefined
          ? body.label_printer_name
          : body.labelPrinterName,
      label_size: body.label_size !== undefined ? body.label_size : body.labelSize,
      label_per_row:
        body.label_per_row !== undefined ? body.label_per_row : body.labelPerRow,
      sales_tax_enabled:
        body.sales_tax_enabled !== undefined
          ? body.sales_tax_enabled
          : body.salesTaxEnabled,
      sales_tax_rate_percent:
        body.sales_tax_rate_percent !== undefined
          ? body.sales_tax_rate_percent
          : body.salesTaxRatePercent,
      sales_tax_rate_bp:
        body.sales_tax_rate_bp !== undefined
          ? body.sales_tax_rate_bp
          : body.salesTaxRateBp,
    }, req.session!.userId);
    if (!result.ok) {
      if (result.code === 'not_found') {
        throw new NotFoundException(result.reason);
      }
      throw new BadRequestException({
        code: result.code,
        reason: result.reason,
      });
    }
    return { ok: true as const, store: result.store };
  }

  @Post('pin')
  @HttpCode(HttpStatus.OK)
  changePin(@Req() req: AuthedRequest, @Body() body: PinBody, @Res({ passthrough: true }) res: Response) {
    const currentPin = body.current_pin ?? body.currentPin ?? '';
    const newPin = body.new_pin ?? body.newPin ?? '';
    const result = this.settings.changePin({
      userId: req.session!.userId,
      currentPin,
      newPin,
    });
    if (!result.ok) {
      if (result.code === 'bad_current_pin') {
        throw new UnauthorizedException({
          code: result.code,
          reason: result.reason,
        });
      }
      if (result.code === 'not_found') {
        throw new NotFoundException(result.reason);
      }
      throw new BadRequestException({
        code: result.code,
        reason: result.reason,
      });
    }
    // Other sessions of this user end (trigger); this device gets a fresh one.
    const s = req.session!;
    const token = this.sessions.sign({ userId: s.userId, storeId: s.storeId, role: s.role, displayName: s.displayName });
    res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions());
    return { ok: true as const, sessionToken: token };
  }

  /** Batch 2 shop rules: rounding, cashier discount limit, credit limit mode, drawer kick, expiry days. */
  @Get('rules')
  getRules() {
    return { ok: true as const, rules: readShopRules(this.db.raw) };
  }

  @Post('rules')
  @HttpCode(HttpStatus.OK)
  setRules(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    const r = saveShopRules(this.db.raw, body ?? {});
    if (!r.ok) throw new BadRequestException(r);
    writeAudit(this.db.raw, {
      action: 'settings.rules',
      userId: req.session!.userId,
      storeId: req.session!.storeId,
      subjectType: 'store',
      subjectId: req.session!.storeId,
      payload: r.rules,
    });
    return r;
  }

  @Get('about')
  about() {
    return { ok: true as const, about: this.settings.about() };
  }
}
