import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { SupplierReturnsService } from './supplier-returns.service';

@Module({
  imports: [AuthModule],
  controllers: [SuppliersController],
  providers: [SuppliersService, SupplierReturnsService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
