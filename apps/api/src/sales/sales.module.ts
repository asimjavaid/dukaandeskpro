import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { SalesController } from './sales.controller';
import { OfflineSyncController } from './offline-sync.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { SalesService } from './sales.service';
import { SalesQueryService } from './sales-query.service';
import { SalesWriteService } from './sales-write.service';

@Module({
  imports: [AuthModule, AnalyticsModule, CatalogModule],
  controllers: [SalesController, OfflineSyncController],
  providers: [SalesService, SalesQueryService, SalesWriteService],
  exports: [SalesService, SalesQueryService],
})
export class SalesModule {}
