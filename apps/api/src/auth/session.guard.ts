import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SessionService } from './session.service';
import { SessionPayload } from './session.types';

export type AuthedRequest = Request & { session?: SessionPayload };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const raw = this.extractToken(req);
    const session = this.sessions.verify(raw);
    if (!session) {
      throw new UnauthorizedException('Session required');
    }
    req.session = session;
    return true;
  }

  private extractToken(req: AuthedRequest): string | undefined {
    const cookie = req.cookies?.[this.sessions.cookieName] as
      | string
      | undefined;
    if (cookie) return cookie;
    const header = req.headers['x-dd-session'];
    if (typeof header === 'string' && header) return header;
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    return undefined;
  }
}
