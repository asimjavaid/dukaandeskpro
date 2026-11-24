import { BadRequestException, Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { LicenseService } from './license.service';

@Controller('license')
export class LicenseController {
  constructor(private readonly licence: LicenseService) {}

  @Get('status')
  status() {
    return this.licence.status(true);
  }

  /** The app calls this about once a minute while someone is using it (trial usage cap). */
  @Get('heartbeat')
  heartbeat() {
    this.licence.heartbeat();
    return { ok: true };
  }

  /**
   * Open route (the shop may be read-only). Keys are signature-checked, so no auth needed.
   * Full / transfer / renewal keys license the PC; an extension key adds trial days.
   */
  @Post('activate')
  @HttpCode(200)
  activate(@Body() body: { key?: string }) {
    const key = typeof body?.key === 'string' ? body.key.trim() : '';
    if (!key || key.length > 4000) throw new BadRequestException({ code: 'KEY_REQUIRED' });
    const s = this.licence.activate(key);
    if (s.activated && !s.activationError) return { ok: true, kind: s.activated, status: s };
    return { ok: false, reason: s.activationError ?? 'invalid', status: s };
  }
}
