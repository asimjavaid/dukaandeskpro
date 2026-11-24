import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';
import { OffersController } from './offers.controller';

@Module({
  imports: [AuthModule],
  controllers: [PartiesController, OffersController],
  providers: [PartiesService],
  exports: [PartiesService],
})
export class PartiesModule {}
