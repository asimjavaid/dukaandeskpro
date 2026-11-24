import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  HttpCode,
  InternalServerErrorException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { ResetDataService } from './reset-data.service';
import { RESET_CONFIRM_WORD } from './reset-data';

/** POST /settings/reset-data { confirm: "RESET" } — owner only; backs up, then wipes activity. */
@Controller('settings')
@UseGuards(SessionGuard, OwnerGuard)
export class ResetDataController {
  constructor(private readonly reset: ResetDataService) {}

  @Post('reset-data')
  @HttpCode(200)
  run(@Req() req: AuthedRequest, @Body() body: { confirm?: unknown }) {
    if (body?.confirm !== RESET_CONFIRM_WORD) {
      throw new BadRequestException({ code: 'confirm_required', reason: `type ${RESET_CONFIRM_WORD}` });
    }
    const s = req.session!;
    const r = this.reset.reset({ userId: s.userId, storeId: s.storeId });
    if (r.ok) return r;
    if (r.error === 'unknown_tables') throw new ConflictException({ code: r.error, reason: r.detail });
    throw new InternalServerErrorException({ code: r.error, reason: r.detail ?? r.error });
  }
}
