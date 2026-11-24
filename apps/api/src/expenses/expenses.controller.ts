import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { parseListPage } from '../common/list-page';
import { ExpensesService } from './expenses.service';

/**
 * Owner expenses: bill, salary, or commission.
 * Cashier → 403. Not payroll.
 */
@Controller('expenses')
@UseGuards(SessionGuard, OwnerGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(
    @Query('period') period?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const paging = parseListPage({ page, pageSize, limit, offset });
    return { ok: true as const, ...this.expenses.list(period, paging) };
  }

  @Post()
  create(
    @Req() req: AuthedRequest,
    @Body()
    body: {
      kind?: string;
      amountRs?: number;
      amountPaisa?: number;
      expenseDate?: string;
      date?: string;
      note?: string;
    },
  ) {
    const result = this.expenses.create({
      kind: body.kind,
      amountRs: body.amountRs,
      amountPaisa: body.amountPaisa,
      expenseDate: body.expenseDate ?? body.date,
      note: body.note,
      createdBy: req.session?.userId,
    });
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    return {
      ok: true as const,
      expense: result.expense,
      today: result.today,
      today_total_paisa: result.today_total_paisa,
    };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    const result = this.expenses.remove(id);
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    const listed = this.expenses.list();
    return {
      ok: true as const,
      today: listed.today,
      today_total_paisa: listed.today_total_paisa,
    };
  }
}
