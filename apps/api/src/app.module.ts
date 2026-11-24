import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './common/health.controller';
import { DbModule } from './db/db.module';
import { CatalogModule } from './catalog/catalog.module';
import { AuthModule } from './auth/auth.module';
import { TaxModule } from './tax/tax.module';
import { StockModule } from './stock/stock.module';
import { SalesModule } from './sales/sales.module';
import { PartiesModule } from './parties/parties.module';
import { BackupModule } from './backup/backup.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { StaffModule } from './staff/staff.module';
import { SettingsModule } from './settings/settings.module';
import { CashierModule } from './cashier/cashier.module';
import { ExpensesModule } from './expenses/expenses.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchasesModule } from './purchases/purchases.module';
import { RepackModule } from './repack/repack.module';
import { ExportModule } from './export/export.module';
import { PricingModule } from './pricing/pricing.module';
import { ReturnsModule } from './returns/returns.module';
import { ActivityModule } from './activity/activity.module';
import { ImportModule } from './import/import.module';
import { LicenseModule } from './license/license.module';
import { OpeningStockModule } from './opening/opening-stock.module';
import { TillsModule } from './tills/tills.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    CatalogModule,
    AuthModule,
    TaxModule,
    StockModule,
    SalesModule,
    PartiesModule,
    BackupModule,
    AnalyticsModule,
    StaffModule,
    SettingsModule,
    CashierModule,
    ExpensesModule,
    SuppliersModule,
    PurchasesModule,
    RepackModule,
    ExportModule,
    PricingModule,
    ReturnsModule,
    ActivityModule,
    ImportModule,
    LicenseModule,
    OpeningStockModule,
    TillsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
