import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OpeningStockController } from './opening-stock.controller';
import { OpeningStockService } from './opening-stock.service';

@Module({
  imports: [AuthModule],
  controllers: [OpeningStockController],
  providers: [OpeningStockService],
  exports: [OpeningStockService],
})
export class OpeningStockModule {}
