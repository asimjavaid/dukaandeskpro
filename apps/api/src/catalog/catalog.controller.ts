import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IMAGE_FILE_RE } from './product-images';
import { InventoryGuard, SellerGuard } from '../auth/roles.guard';
import { CostRedactInterceptor, MoneyRedactInterceptor } from '../auth/redact.interceptor';
import { AuthedRequest, SessionGuard } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { parseListPage } from '../common/list-page';
import { checkNewProductType, setProductType } from './product-types';
import { PURCHASE_TYPES, SALE_TYPES } from '../purchases/purchase-targets';
import { setBuyMeasure } from './measures';
import { classifyBuyUnit, setBuyUnit } from './buy-units';
import { CatalogService } from './catalog.service';
import type { DiscountInput } from './discount';
import { writeAudit } from '../sales/sale-reversal';
import { DbService } from '../db/db.service';

@Controller('catalog')
@UseInterceptors(CostRedactInterceptor)
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly db: DbService,
  ) {}

  @Get('products')
  @UseGuards(SessionGuard)
  list(
    @Req() req: AuthedRequest,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('for') purpose?: string,
    @Query('types') typesRaw?: string,
  ) {
    const includeCost = req.session?.role === 'owner';
    const paging = parseListPage({ page, pageSize, limit, offset });
    const types = typesRaw ? typesRaw.split(',') : this.typesFor(purpose);
    const listed = this.catalog.list(includeCost, { q, paging, types });
    return {
      items: listed.items,
      count: listed.items.length,
      total: listed.total,
    };
  }

  /** Exact barcode lookup (sell, purchase, stock count). Matches the primary or any extra barcode. */
  @Get('lookup')
  @UseGuards(SessionGuard)
  lookup(@Req() req: AuthedRequest, @Query('barcode') barcode?: string, @Query('for') purpose?: string) {
    const includeCost = req.session?.role === 'owner';
    const result = this.catalog.findByBarcode(barcode ?? '', includeCost);
    if (!result.ok) {
      throw new NotFoundException({ ok: false, error: result.error });
    }
    const allowed = this.typesFor(purpose);
    if (allowed && !allowed.includes(result.product.product_type)) {
      const error = result.product.product_type === 'bulk' ? 'bulk_not_sold_loose' : 'not_for_sale';
      const bulk = result.product.repack_from_id
        ? (this.db.raw.prepare(`SELECT name FROM products WHERE id = ?`).get(result.product.repack_from_id) as { name: string } | undefined)
        : undefined;
      throw new BadRequestException({
        ok: false,
        error,
        product: { id: result.product.id, name: result.product.name, product_type: result.product.product_type, bulk_id: result.product.repack_from_id, bulk_name: bulk?.name ?? null },
      });
    }
    return { ok: true as const, product: result.product };
  }

  /** PO / bill: everything. Till: never loose (bulk) items; they are sold as packs. */
  private typesFor(purpose?: string): string[] | null {
    if (purpose === 'purchase') return [...PURCHASE_TYPES];
    if (purpose === 'sale') return [...SALE_TYPES];
    return null;
  }

  /** Loose items are bought by kg (or bag / gram on the line). */
  private looseByKg(id: string) {
    this.db.raw.prepare(`UPDATE products SET buy_measure = 'kg' WHERE id = ? AND product_type = 'bulk' AND buy_measure NOT IN ('kg', 'gram', 'bag')`).run(id);
    this.db.raw.prepare(`UPDATE products SET buy_measure = 'kg' WHERE id = ? AND product_type = 'bulk' AND buy_measure IS NULL`).run(id);
  }

  /** Normal items always have a purchase package: the one asked for (manual) or a guess from the name. */
  private fillBuyUnit(id: string, wanted?: string) {
    const p = this.db.raw.prepare(`SELECT name, unit_label, product_type, buy_unit FROM products WHERE id = ?`).get(id) as
      | { name: string; unit_label: string; product_type: string; buy_unit: string | null }
      | undefined;
    if (!p || p.product_type !== 'normal') return;
    if (wanted) setBuyUnit(this.db.raw, id, wanted);
    else if (!p.buy_unit) this.db.raw.prepare(`UPDATE products SET buy_unit = ?, buy_unit_source = 'auto' WHERE id = ?`).run(classifyBuyUnit(p.name, p.unit_label).unit, id);
  }

  /**
   * Owner-gated add product. Sell unit is always piece (no carton price).
   * Optional `discount`: { kind: 'percent'|'fixed'|'none', percent?, amountRs?,
   * amountPaisa?, startAt?, endAt? }. Dates without a zone are Asia/Karachi.
   */
  @Post('products')
  @UseGuards(SessionGuard, InventoryGuard)
  create(
    @Body()
    body: {
      name?: string;
      priceRs?: number;
      pricePaisa?: number;
      unit?: string;
      unitLabel?: string;
      piecesPerCarton?: number;
      barcode?: string | null;
      extraBarcodes?: unknown;
      discount?: DiscountInput | null;
      fixedPrice?: boolean;
      markupPct?: number | string | null;
      productType?: string;
      bulkId?: string;
      packKg?: number | string;
      buyUnit?: string;
      buyMeasure?: string;
    },
  ) {
    if (body?.buyUnit != null && !['carton', 'crate', 'piece'].includes(body.buyUnit)) this.fail('invalid_buy_unit');
    if (body?.productType && !['normal', 'bulk', 'packed'].includes(body.productType)) this.fail('invalid_product_type');
    if (body?.productType === 'bulk' && (body.unitLabel ?? 'piece') !== 'kg') this.fail('bulk_needs_kg');
    if (body?.productType && body.productType !== 'normal') {
      const pre = checkNewProductType(this.db.raw, { type: body.productType, bulkId: body.bulkId, kg: body.packKg, unitLabel: String(body.unitLabel ?? 'piece').trim().toLowerCase() });
      if (!pre.ok) this.fail(pre.error);
    }
    const result = this.catalog.create({
      fixedPrice: body?.fixedPrice === true,
      markupPct: body?.markupPct,
      name: body?.name ?? '',
      priceRs: body?.priceRs,
      pricePaisa: body?.pricePaisa,
      unit: body?.unit,
      unitLabel: body?.unitLabel,
      piecesPerCarton: body?.piecesPerCarton,
      barcode: body?.barcode,
      extraBarcodes: body?.extraBarcodes,
      discount: body?.discount,
    });
    if (!result.ok) {
      this.fail(result.error);
    }
    // kg items are Bulk by default (bought in bags, repacked into packets).
    const wantType = body?.productType ?? (result.product.unit_label === 'kg' ? 'bulk' : undefined);
    if (wantType && wantType !== 'normal') {
      const t = setProductType(this.db.raw, result.product.id, { type: wantType, bulkId: body?.bulkId, kg: body?.packKg });
      if (!t.ok) {
        this.db.raw.prepare(`UPDATE products SET active = 0 WHERE id = ?`).run(result.product.id);
        this.fail(t.error);
      }
    } else this.fillBuyUnit(result.product.id, body?.buyUnit);
    this.looseByKg(result.product.id);
    if (body?.buyMeasure) {
      const m = setBuyMeasure(this.db.raw, result.product.id, body.buyMeasure);
      if (!m.ok) {
        this.db.raw.prepare(`UPDATE products SET active = 0 WHERE id = ?`).run(result.product.id);
        this.fail(m.error);
      }
    }
    return { ok: true as const, product: this.catalog.byId(result.product.id) };
  }

  /**
   * Owner edit. Empty barcode regenerates an in-store EAN-13.
   * `discount` omitted keeps it; null or { kind: 'none' } clears it.
   */
  /** Selling-price changes for one product (owner + data entry). */
  @Get('products/:id/price-history')
  @UseGuards(SessionGuard, InventoryGuard)
  priceHistory(@Param('id') id: string) {
    return { ok: true as const, items: this.catalog.priceHistory(id) };
  }

  @Patch('products/:id')
  @UseGuards(SessionGuard, InventoryGuard)
  update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body()
    body: {
      reorderLevel?: number | string | null;
      name?: string;
      priceRs?: number;
      pricePaisa?: number;
      barcode?: string | null;
      extraBarcodes?: unknown;
      unitLabel?: string;
      discount?: DiscountInput | null;
      fixedPrice?: boolean;
      markupPct?: number | string | null;
      productType?: string;
      bulkId?: string;
      packKg?: number | string;
      buyUnit?: string;
      buyMeasure?: string;
      /** Also reprice linked sizes from this size's new price. */
      updateSizes?: boolean;
    },
  ) {
    const payload = body ?? {};
    const before = this.catalog.getProduct(id);
    const result = this.catalog.update(id, {
      name: payload.name,
      priceRs: payload.priceRs,
      pricePaisa: payload.pricePaisa,
      barcode: payload.barcode,
      barcodeProvided: Object.prototype.hasOwnProperty.call(payload, 'barcode'),
      extraBarcodes: payload.extraBarcodes,
      extraBarcodesProvided: Object.prototype.hasOwnProperty.call(payload, 'extraBarcodes'),
      unitLabel: payload.unitLabel,
      unitLabelProvided: Object.prototype.hasOwnProperty.call(payload, 'unitLabel'),
      discount: payload.discount,
      discountProvided: Object.prototype.hasOwnProperty.call(payload, 'discount'),
      reorderLevel: payload.reorderLevel,
      reorderLevelProvided: Object.prototype.hasOwnProperty.call(payload, 'reorderLevel'),
      fixedPrice: payload.fixedPrice === true,
      fixedPriceProvided: Object.prototype.hasOwnProperty.call(payload, 'fixedPrice'),
      markupPct: payload.markupPct,
      markupProvided: Object.prototype.hasOwnProperty.call(payload, 'markupPct'),
      userId: req.session?.userId ?? null,
    });
    if (!result.ok) {
      this.fail(result.error);
    }
    if (payload.productType != null) {
      const cur = result.product;
      const same =
        cur.product_type === payload.productType &&
        (payload.productType !== 'packed' || (cur.repack_from_id === payload.bulkId && Number(cur.size_qty) === Math.round(Number(payload.packKg) * 1000) / 1000));
      if (!same) {
        const t = setProductType(this.db.raw, id, { type: payload.productType, bulkId: payload.bulkId, kg: payload.packKg });
        if (!t.ok) this.fail(t.error);
        result.product = this.catalog.byId(id);
      }
    }
    if (payload.buyUnit != null && payload.buyUnit !== result.product.buy_unit) {
      const b = setBuyUnit(this.db.raw, id, payload.buyUnit);
      if (!b.ok) this.fail(b.error);
    }
    this.fillBuyUnit(id);
    this.looseByKg(id);
    if (payload.buyMeasure != null && payload.buyMeasure !== '') {
      const m = setBuyMeasure(this.db.raw, id, payload.buyMeasure);
      if (!m.ok) this.fail(m.error);
    }
    result.product = this.catalog.byId(id);
    let sizes: ReturnType<CatalogService['applySizePrices']> = [];
    if (payload.updateSizes === true && before && before.price_paisa !== result.product.price_paisa) {
      sizes = this.catalog.applySizePrices(id, result.product.price_paisa, req.session?.userId ?? null);
      if (sizes.length) {
        writeAudit(this.db.raw, {
          action: 'catalog.size_prices',
          userId: req.session?.userId ?? null,
          storeId: req.session?.storeId ?? null,
          subjectType: 'product',
          subjectId: id,
          payload: {
            name: result.product.name,
            old_price_paisa: before.price_paisa,
            new_price_paisa: result.product.price_paisa,
            sizes: sizes.map((x) => ({ name: x.name, old: x.old_price_paisa, new: x.new_price_paisa })),
          },
        });
      }
    }
    return { ok: true as const, product: result.product, sizes };
  }

  /** Linked sizes of a product (same size group). */
  @Get('products/:id/sizes')
  @UseGuards(SessionGuard, InventoryGuard)
  sizes(@Param('id') id: string) {
    return { ok: true as const, items: this.catalog.sizes(id) };
  }

  /** Preview: other sizes' prices if this one becomes pricePaisa. */
  @Get('products/:id/size-plan')
  @UseGuards(SessionGuard, InventoryGuard)
  sizePlan(@Param('id') id: string, @Query('pricePaisa') pricePaisa?: string) {
    const n = Math.round(Number(pricePaisa));
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException({ ok: false, error: 'invalid_price' });
    return { ok: true as const, items: this.catalog.sizePricePlan(id, n) };
  }

  /** Body { withProductId?, qty } links into that product's size group; qty null unlinks. */
  @Post('products/:id/size-link')
  @UseGuards(SessionGuard, InventoryGuard)
  sizeLink(@Param('id') id: string, @Body() body: { withProductId?: string | null; qty?: number | string | null }) {
    const result = this.catalog.linkSize(id, { withProductId: body?.withProductId ?? null, qty: body?.qty ?? null });
    if (!result.ok) this.fail(result.error);
    return { ok: true as const, product: result.product };
  }

  /**
   * Product picture. File names change on every upload, so they are cached
   * as immutable. Not session-gated: <img> tags carry no bearer token.
   */
  @Get('images/:file')
  image(@Param('file') file: string, @Res() res: Response) {
    if (!IMAGE_FILE_RE.test(file ?? '')) {
      res.status(404).end();
      return;
    }
    const full = path.join(this.catalog.imagesDir(), file);
    if (!fs.existsSync(full)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/jpeg');
    res.sendFile(full);
  }

  /** Owner: body { image: "data:image/jpeg;base64,..." } (256px JPEG). */
  @Post('products/:id/image')
  @UseGuards(SessionGuard, InventoryGuard)
  setImage(@Param('id') id: string, @Body() body: { image?: string }) {
    const result = this.catalog.setImage(id, body?.image);
    if (!result.ok) this.fail(result.error);
    return { ok: true as const, product: result.product };
  }

  /** Copy the photo of another product (Add another size). */
  @Post('products/:id/image/copy')
  @UseGuards(SessionGuard, InventoryGuard)
  copyImage(@Param('id') id: string, @Body() body: { fromProductId?: string }) {
    const result = this.catalog.copyImage(id, String(body?.fromProductId ?? ''));
    if (!result.ok) this.fail(result.error);
    return { ok: true as const, product: result.product };
  }

  @Delete('products/:id/image')
  @UseGuards(SessionGuard, InventoryGuard)
  removeImage(@Param('id') id: string) {
    const result = this.catalog.removeImage(id);
    if (!result.ok) this.fail(result.error);
    return { ok: true as const, product: result.product };
  }

  /** First-run optional sample product (Owner). One kiryana SKU + stock. */
  @Post('sample')
  @UseGuards(SessionGuard, InventoryGuard)
  sample(@Req() req: AuthedRequest) {
    const result = this.catalog.createSample(req.session?.userId);
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    return {
      ok: true as const,
      product: result.product,
      created: result.created,
    };
  }

  private fail(error: string): never {
    const body = { ok: false as const, error };
    if (error === 'duplicate_barcode') {
      throw new ConflictException(body);
    }
    if (error === 'product_not_found' || error === 'barcode_not_found') {
      throw new NotFoundException(body);
    }
    throw new BadRequestException(body);
  }
}
