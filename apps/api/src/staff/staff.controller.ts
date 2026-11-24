import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthedRequest, SessionGuard } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { karachiYmd, StaffService } from './staff.service';

type CashierBody = { displayName?: string; display_name?: string; pin?: string };
type StaffBody = {
  name?: string;
  displayName?: string;
  role?: string;
  position?: string | null;
  phone?: string | null;
  address?: string | null;
  monthlySalaryRs?: number | string | null;
  monthlySalaryPaisa?: number | null;
  pin?: string;
};
type EntryBody = {
  kind?: string;
  amountRs?: number | string;
  amountPaisa?: number;
  date?: string;
  fromDrawer?: boolean;
  note?: string | null;
  period?: string;
};

function fail(error: string): never {
  if (error === 'not_found') throw new NotFoundException(error);
  if (error === 'cannot_disable_owner' || error === 'cannot_change_owner') throw new ForbiddenException(error);
  throw new BadRequestException(error);
}

/**
 * Owner Staff + salary.
 * GET  /owner/staff                     list (no PIN data)
 * POST /owner/staff                     add (cashier | data_entry need a PIN; helper has no login)
 * POST /owner/staff/cashiers            add cashier (Slice 8 compat)
 * GET  /owner/staff/salary-run?period=  preview the month
 * POST /owner/staff/salary-run          add salary due + auto advance deduction
 * GET  /owner/staff/:id                 profile + salary khata
 * PATCH /owner/staff/:id                edit
 * POST /owner/staff/:id/pin             reset PIN (pin_once)
 * POST /owner/staff/:id/deactivate|activate
 * POST /owner/staff/:id/entries         payment | advance | bonus
 * POST /owner/staff/:id/entries/:entryId/void   same PKT day
 */
@Controller('owner/staff')
@UseGuards(SessionGuard, OwnerGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list() {
    return { ok: true as const, users: this.staff.list(), today: karachiYmd() };
  }

  @Post()
  create(@Body() body: StaffBody) {
    const r = this.staff.create({ ...body, name: body?.name ?? body?.displayName });
    if (!r.ok) fail(r.error);
    return r;
  }

  @Post('cashiers')
  createCashier(@Body() body: CashierBody) {
    const result = this.staff.createCashier({
      displayName: body.displayName ?? body.display_name ?? '',
      pin: body.pin ?? '',
    });
    if (!result.ok) throw new BadRequestException(result.error);
    return { ok: true as const, user: result.user, pin_once: result.pin_once };
  }

  @Get('salary-run')
  runPreview(@Query('period') period?: string) {
    const r = this.staff.runPreview(period || karachiYmd().slice(0, 7));
    if (!r.ok) fail(r.error);
    return r;
  }

  @Post('salary-run')
  run(@Req() req: AuthedRequest, @Body() body: { period?: string }) {
    const r = this.staff.run(body?.period || karachiYmd().slice(0, 7), req.session?.userId);
    if (!r.ok) fail(r.error);
    return r;
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const r = this.staff.get(id);
    if (!r.ok) fail(r.error);
    return r;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: StaffBody) {
    const r = this.staff.update(id, { ...body, name: body?.name ?? body?.displayName });
    if (!r.ok) fail(r.error);
    return r;
  }

  @Post(':id/pin')
  resetPin(@Param('id') id: string, @Body() body: { pin?: string }) {
    const r = this.staff.resetPin(id, body?.pin ?? '');
    if (!r.ok) fail(r.error);
    return r;
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    const r = this.staff.deactivate(id);
    if (!r.ok) fail(r.error);
    return r;
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    const r = this.staff.activate(id);
    if (!r.ok) fail(r.error);
    return r;
  }

  @Post(':id/entries')
  addEntry(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: EntryBody) {
    const r = this.staff.addEntry(id, { ...body, createdBy: req.session?.userId });
    if (!r.ok) fail(r.error);
    return r;
  }

  @Post(':id/entries/:entryId/void')
  voidEntry(@Param('id') id: string, @Param('entryId') entryId: string) {
    const r = this.staff.voidEntry(id, entryId);
    if (!r.ok) fail(r.error);
    return r;
  }
}
