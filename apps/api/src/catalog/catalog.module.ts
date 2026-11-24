import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockModule } from '../stock/stock.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ProductTypesController } from './product-types.controller';
import { ProductTypesService } from './product-types.service';

@Module({
  imports: [AuthModule, StockModule],
  controllers: [CatalogController, ProductTypesController],
  providers: [CatalogService, ProductTypesService],
  exports: [CatalogService, ProductTypesService],
})
export class CatalogModule {}
