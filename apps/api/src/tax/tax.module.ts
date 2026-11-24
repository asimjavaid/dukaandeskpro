import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';
import { TAX_ADAPTER } from './tax-adapter.port';
import { SimulateTaxAdapter } from './simulate-tax.adapter';

@Module({
  imports: [AuthModule],
  controllers: [TaxController],
  providers: [
    TaxService,
    {
      provide: TAX_ADAPTER,
      useFactory: () => new SimulateTaxAdapter(),
    },
  ],
  exports: [TaxService],
})
export class TaxModule {}
