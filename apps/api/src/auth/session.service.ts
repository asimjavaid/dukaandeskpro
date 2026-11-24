import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SessionPayload, SESSION_COOKIE } from './session.types';
import { DbService } from '../db/db.service';

/**
 * Signed local session token (HMAC-SHA256).
 * Preferred delivery: httpOnly cookie `dd_session`.
 * Fallback for smoke / non-cookie clients: return token in JSON (`sessionToken`)
 * and accept `Authorization: Bearer <token>` or `x-dd-session` header.
 */
@Injectable()
export class SessionService {
  readonly cookieName = SESSION_COOKIE;

  constructor(private readonly db: DbService) {}

  private secret(): string {
    return (
      process.env.SESSION_SECRET ??
      'dukaandesk-local-dev-secret-change-me'
    );
  }

  private ttlSeconds(): number {
    const days = Number(process.env.SESSION_TTL_DAYS ?? 7);
    return Math.max(1, days) * 24 * 60 * 60;
  }

  sign(payload: Omit<SessionPayload, 'exp' | 'iat'>): string {
    const full: SessionPayload = {
      ...payload,
      iat: Date.now(),
      exp: Math.floor(Date.now() / 1000) + this.ttlSeconds(),
    };
    const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.secret())
      .update(body)
      .digest('base64url');
    return `${body}.${sig}`;
  }

  verify(token: string | undefined | null): SessionPayload | null {
    if (!token || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = createHmac('sha256', this.secret())
      .update(body)
      .digest('base64url');
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    } catch {
      return null;
    }
    try {
      const payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as SessionPayload;
      if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }
      if (!payload.userId || !payload.storeId || !payload.role) return null;
      // Ended by a PIN change or disable (users.sessions_valid_after, set by trigger).
      const u = this.db.raw
        .prepare(`SELECT disabled_at, sessions_valid_after, active_till_id, active_till_at FROM users WHERE id = ?`)
        .get(payload.userId) as
        | { disabled_at: string | null; sessions_valid_after: number | null; active_till_id: string | null; active_till_at: number | null }
        | undefined;
      if (!u || u.disabled_at) return null;
      const iat = payload.iat ?? (payload.exp - this.ttlSeconds()) * 1000;
      if (u.sessions_valid_after != null && iat < Number(u.sessions_valid_after)) return null;
      // Signed in on another till since this session started.
      if (
        payload.tillId &&
        u.active_till_id &&
        u.active_till_id !== payload.tillId &&
        u.active_till_at != null &&
        iat < Number(u.active_till_at)
      ) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  cookieOptions(): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax' | 'none' | 'strict';
    path: string;
    maxAge: number;
  } {
    const isProd = process.env.NODE_ENV === 'production';
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: this.ttlSeconds() * 1000,
    };
  }
}
