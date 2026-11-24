import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TillsController } from './tills.controller';
import { TillsService } from './tills.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [TillsController],
  providers: [TillsService],
  exports: [TillsService],
})
export class TillsModule {}
