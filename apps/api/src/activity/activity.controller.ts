import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { ActivityService } from './activity.service';

@Controller('activity')
@UseGuards(SessionGuard, OwnerGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('kind') kind?: string,
    @Query('userId') userId?: string,
    @Query('day') day?: string,
  ) {
    return { ok: true as const, ...this.activity.list({ page: Number(page), pageSize: Number(pageSize), kind, userId, day }) };
  }
}
