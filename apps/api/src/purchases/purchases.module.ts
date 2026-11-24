import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

@Module({
  imports: [AuthModule, SuppliersModule],
  controllers: [PurchasesController, PurchaseOrdersController],
  providers: [PurchasesService, PurchaseOrdersService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
