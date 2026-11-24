import { BadRequestException, Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { InventoryGuard } from '../auth/roles.guard';
import { ImportService, type ImportRow } from './import.service';

@Controller('catalog/import')
@UseGuards(SessionGuard, InventoryGuard)
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  /** Rows parsed from Excel / CSV by the app. `dryRun: true` only checks. */
  @Post()
  @HttpCode(200)
  run(@Req() req: AuthedRequest, @Body() body: { rows?: ImportRow[]; dryRun?: boolean }) {
    const r = this.imports.run({
      rows: body?.rows,
      dryRun: body?.dryRun !== false,
      userId: req.session!.userId,
      storeId: req.session!.storeId,
    });
    if (!r.ok) throw new BadRequestException(r);
    return r;
  }
}
