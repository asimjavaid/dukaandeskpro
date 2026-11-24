import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthedRequest } from './session.guard';
import type { StaffRole } from './session.types';

function check(context: ExecutionContext, allowed: readonly StaffRole[]): boolean {
  const req = context.switchToHttp().getRequest<AuthedRequest>();
  if (!req.session) throw new UnauthorizedException('Session required');
  if (!allowed.includes(req.session.role)) {
    throw new ForbiddenException('Role not allowed');
  }
  return true;
}

/** Owner or Data entry operator (catalog, purchases, suppliers, stock count). */
@Injectable()
export class InventoryGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return check(context, ['owner', 'data_entry']);
  }
}

/** Owner, Manager or Cashier (Sell, Today, returns, khata collections). */
@Injectable()
export class SellerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return check(context, ['owner', 'manager', 'cashier']);
  }
}

/** Owner or Manager (tills, other tills' shifts, approvals). */
@Injectable()
export class SupervisorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return check(context, ['owner', 'manager']);
  }
}

/** Only the owner sees purchase cost, margins and supplier money. */
export function canSeeCost(role: StaffRole | undefined): boolean {
  return role === 'owner';
}
