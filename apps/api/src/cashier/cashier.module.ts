import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CashierController } from './cashier.controller';
import { TillService } from './till.service';

@Module({
  imports: [AuthModule, AnalyticsModule],
  controllers: [CashierController],
  providers: [TillService],
  exports: [TillService],
})
export class CashierModule {}
