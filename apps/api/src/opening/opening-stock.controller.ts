import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { OpeningStockService } from './opening-stock.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Opening stock (owner only): draft, Excel fill, post as a batch, undo the last batch. */
@Controller('opening-stock')
@UseGuards(SessionGuard, OwnerGuard)
export class OpeningStockController {
  constructor(private readonly os: OpeningStockService) {}

  @Get()
  list() {
    return { ok: true as const, ...this.os.list() };
  }

  @Put('draft/:productId')
  save(@Req() req: AuthedRequest, @Param('productId') productId: string, @Body() body: Record<string, unknown>) {
    const r = this.os.saveDraft(productId, body ?? {}, req.session!.userId);
    if (!r.ok) {
      if (r.error === 'product_not_found') throw new NotFoundException({ error: r.error });
      throw new BadRequestException({ error: r.error });
    }
    return r;
  }

  @Delete('draft')
  clear() {
    return this.os.clearDraft();
  }

  @Get('template.xlsx')
  template(@Res() res: Response) {
    const t = this.os.template();
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${t.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(t.file);
  }

  @Post('import')
  @HttpCode(200)
  import(@Req() req: AuthedRequest, @Body() body: { fileBase64?: unknown; apply?: unknown }) {
    const r = this.os.importSheet(body?.fileBase64, body?.apply === true, req.session!.userId);
    if (!r.ok) throw new BadRequestException({ error: r.error });
    return r;
  }

  @Get('post-preview')
  preview() {
    return this.os.postPreview();
  }

  @Post('post')
  @HttpCode(200)
  post(@Req() req: AuthedRequest, @Body() body: { confirm?: unknown }) {
    if (body?.confirm !== true) throw new BadRequestException({ error: 'confirm_required' });
    const r = this.os.post({ userId: req.session!.userId, storeId: req.session!.storeId });
    if (!r.ok) throw new BadRequestException({ error: r.error });
    return r;
  }

  @Get('batches')
  batches() {
    return { ok: true as const, items: this.os.batches() };
  }

  @Get('batches/:id')
  batch(@Param('id') id: string) {
    const b = this.os.batch(id);
    if (!b) throw new NotFoundException({ error: 'not_found' });
    return { ok: true as const, batch: b };
  }

  @Get('batches/:id/export.xlsx')
  export(@Param('id') id: string, @Res() res: Response) {
    const t = this.os.exportBatch(id);
    if (!t) throw new NotFoundException({ error: 'not_found' });
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${t.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(t.file);
  }

  @Post('batches/:id/undo')
  @HttpCode(200)
  undo(@Req() req: AuthedRequest, @Param('id') id: string) {
    const r = this.os.undo(id, { userId: req.session!.userId, storeId: req.session!.storeId });
    if (!r.ok) {
      if (r.error === 'not_found') throw new NotFoundException({ error: r.error });
      throw new BadRequestException({ error: r.error });
    }
    return r;
  }
}
