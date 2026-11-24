import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PacksController, RepackController } from './repack.controller';
import { RepackService } from './repack.service';

@Module({
  imports: [AuthModule],
  controllers: [PacksController, RepackController],
  providers: [RepackService],
  exports: [RepackService],
})
export class RepackModule {}
