import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { LicenseService } from './license.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Data-changing routes that stay open in read-only mode (trial over / clock set back):
 * sign in and out, licence activation, backup copy (export / saved / auto copy), restore,
 * price suggestions and Excel file building (calculations, nothing is written).
 */
export const READ_ONLY_ALLOW: RegExp[] = [
  /^\/health(\/|$)/,
  /^\/license(\/|$)/,
  /^\/auth(\/|$)/,
  /^\/backup\/(export|saved|restore|auto\/run)\/?$/,
  /^\/pricing\/suggest\/?$/,
  /^\/export\/xlsx\/?$/,
];

export const READ_ONLY_CODE = 'READ_ONLY';

/**
 * Global guard. Licensed / trial: everything open.
 * Trial over (or clock set back): READ-ONLY. Every GET still works (screens, reports,
 * Excel/PDF exports); POST/PUT/PATCH/DELETE are refused with 402 READ_ONLY unless allow-listed.
 * Nothing is ever deleted.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private readonly licence: LicenseService) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has((req.method || 'GET').toUpperCase())) return true;
    const p = (req.path || req.url || '').split('?')[0];
    if (READ_ONLY_ALLOW.some((re) => re.test(p))) return true;
    const s = this.licence.status();
    if (!s.locked) return true;
    throw new HttpException(
      {
        statusCode: 402,
        code: READ_ONLY_CODE,
        state: s.state,
        message: 'DukaanDesk Pro is read-only until it is activated',
      },
      402,
    );
  }
}
