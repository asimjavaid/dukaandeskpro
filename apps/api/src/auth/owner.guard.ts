import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthedRequest } from './session.guard';

/** Requires an authenticated session with role=owner. */
@Injectable()
export class OwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.session) {
      throw new UnauthorizedException('Session required');
    }
    if (req.session.role !== 'owner') {
      throw new ForbiddenException('Owner role required');
    }
    return true;
  }
}
