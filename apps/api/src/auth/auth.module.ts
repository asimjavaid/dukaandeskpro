import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { SessionGuard } from './session.guard';
import { OwnerGuard } from './owner.guard';
import { InventoryGuard, SellerGuard, SupervisorGuard } from './roles.guard';
import { ApprovalService } from './approval.service';
import { RecoveryService } from './recovery.service';

@Module({
  controllers: [AuthController],
  providers: [ApprovalService, SupervisorGuard, RecoveryService, AuthService, SessionService, SessionGuard, OwnerGuard, InventoryGuard, SellerGuard],
  exports: [ApprovalService, SupervisorGuard, RecoveryService, AuthService, SessionService, SessionGuard, OwnerGuard, InventoryGuard, SellerGuard],
})
export class AuthModule {}
