import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { StockCountService } from './stock-count.service';
import { StockExtraService } from './stock-extra.service';

@Module({
  imports: [AuthModule],
  controllers: [StockController],
  providers: [StockService, StockCountService, StockExtraService],
  exports: [StockService, StockCountService, StockExtraService],
})
export class StockModule {}
