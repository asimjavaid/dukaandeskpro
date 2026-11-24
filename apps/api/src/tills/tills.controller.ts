import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TillsService } from './tills.service';
import { tillAls } from './till-context';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { SupervisorGuard } from '../auth/roles.guard';

@Controller('tills')
export class TillsController {
  constructor(private readonly tills: TillsService) {}

  /** Which till this device is (no session needed: the login screen shows it). */
  @Get('me')
  me() {
    const ctx = tillAls.getStore();
    return {
      till: ctx?.till ?? null,
      keyRejected: ctx?.keyRejected ?? false,
      mode: this.tills.mode(),
    };
  }

  /** New till PC: pairing code → device key. */
  @Post('pair')
  pair(@Req() req: Request, @Body() body: { code?: unknown; deviceName?: unknown }) {
    const ip = (req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
    return this.tills.pair({ code: body?.code, deviceName: body?.deviceName, ip });
  }

  @Get()
  @UseGuards(SessionGuard, SupervisorGuard)
  list() {
    return { ok: true as const, ...this.tills.list() };
  }

  @Post('mode')
  @UseGuards(SessionGuard, OwnerGuard)
  mode(@Req() req: AuthedRequest, @Body() body: { mode?: unknown }) {
    return this.tills.setMode(body?.mode, req.session!.userId);
  }

  @Post()
  @UseGuards(SessionGuard, OwnerGuard)
  add(@Req() req: AuthedRequest, @Body() body: { name?: unknown }) {
    return this.tills.add({ name: body?.name, userId: req.session!.userId });
  }

  @Post(':id/pair-code')
  @UseGuards(SessionGuard, OwnerGuard)
  pairCode(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.tills.repair(id, req.session!.userId);
  }

  @Post(':id')
  @UseGuards(SessionGuard, OwnerGuard)
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { name?: unknown; active?: unknown }) {
    return this.tills.update(id, body ?? {}, req.session!.userId);
  }
}
