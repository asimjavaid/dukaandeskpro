import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthService } from './auth.service';
import { isSupervisor } from './session.types';

export const APPROVAL_ACTIONS = ['refund', 'price_override', 'discount', 'credit_limit'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

const TTL_MS = 5 * 60_000;

type Payload = { a: ApprovalAction; u: string; n: string; exp: number };

/**
 * Manager approval at a cashier's till: the manager (or owner) types their PIN, the till gets a
 * one-time token (5 minutes) for one action, and the server records who approved.
 */
@Injectable()
export class ApprovalService {
  private used = new Map<string, number>();

  constructor(private readonly auth: AuthService) {}

  private secret(): string {
    return `${process.env.SESSION_SECRET ?? 'dukaandesk-local-dev-secret-change-me'}:approval`;
  }

  issue(input: { userId?: unknown; pin?: unknown; action?: unknown }):
    | { ok: true; approval: string; approver: { id: string; displayName: string; role: string }; expiresAt: string }
    | { ok: false; error: string; retry_after_s?: number } {
    const action = String(input.action ?? '') as ApprovalAction;
    if (!(APPROVAL_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: 'invalid_action' };
    const userId = String(input.userId ?? '').trim();
    if (!userId) return { ok: false, error: 'user_required' };
    const r = this.auth.pinLogin(userId, String(input.pin ?? ''));
    if (!r.ok) return r;
    if (!isSupervisor(r.user.role)) return { ok: false, error: 'not_a_manager' };
    const exp = Date.now() + TTL_MS;
    const p: Payload = { a: action, u: r.user.id, n: randomBytes(9).toString('base64url'), exp };
    const body = Buffer.from(JSON.stringify(p)).toString('base64url');
    const sig = createHmac('sha256', this.secret()).update(body).digest('base64url');
    return {
      ok: true,
      approval: `${body}.${sig}`,
      approver: { id: r.user.id, displayName: r.user.displayName, role: r.user.role },
      expiresAt: new Date(exp).toISOString(),
    };
  }

  /** Check without using it up. Returns the approver's user id. */
  peek(token: unknown, action: ApprovalAction): string | null {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const want = createHmac('sha256', this.secret()).update(body).digest('base64url');
    const a = Buffer.from(sig ?? '');
    const b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let p: Payload;
    try {
      p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    } catch {
      return null;
    }
    if (p.a !== action || !p.u || p.exp < Date.now() || this.used.has(p.n)) return null;
    return p.u;
  }

  /** Use the token once. */
  consume(token: unknown, action: ApprovalAction): string | null {
    const u = this.peek(token, action);
    if (!u) return null;
    const p = JSON.parse(Buffer.from(String(token).split('.')[0], 'base64url').toString('utf8')) as Payload;
    const now = Date.now();
    for (const [k, exp] of this.used) if (exp < now) this.used.delete(k);
    this.used.set(p.n, p.exp);
    return u;
  }
}
