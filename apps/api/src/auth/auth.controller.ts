import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { AuthedRequest, SessionGuard } from './session.guard';
import { OwnerGuard } from './owner.guard';
import { RecoveryService } from './recovery.service';
import { ApprovalService } from './approval.service';
import { currentTill } from '../tills/till-context';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly recovery: RecoveryService,
    private readonly approvals: ApprovalService,
  ) {}

  /** First-run / login gate. */
  @Get('status')
  status() {
    const needsSetup = this.auth.needsSetup();
    return {
      needsSetup,
      users: needsSetup ? [] : this.auth.listUsers(),
      store: needsSetup ? null : this.auth.getStore(),
    };
  }

  @Get('users')
  users() {
    return { users: this.auth.listUsers() };
  }

  /**
   * First-run setup: Owner display name + PIN (4–6) + single local store.
   * Sets httpOnly session cookie; also returns sessionToken for non-cookie clients.
   */
  @Post('setup')
  setup(
    @Body()
    body: {
      displayName?: string;
      pin?: string;
      storeName?: string;
      locale?: string;
      locale_default?: string;
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = this.auth.setup({
      displayName: body.displayName ?? '',
      pin: body.pin ?? '',
      storeName: body.storeName,
      localeDefault: body.locale_default ?? body.locale,
    });
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    const token = this.sessions.sign({
      userId: result.user.id,
      storeId: result.store.id,
      role: result.user.role,
      displayName: result.user.displayName,
    });
    res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions());
    return {
      ok: true as const,
      session: {
        userId: result.user.id,
        displayName: result.user.displayName,
        role: result.user.role,
        storeId: result.store.id,
      },
      store: result.store,
      sessionToken: token,
      note: 'Session set via httpOnly cookie dd_session (Bearer / x-dd-session also accepted)',
    };
  }

  /** PIN login → session cookie (+ sessionToken fallback). */
  @Post('login')
  login(
    @Body() body: { userId?: string; pin?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = this.auth.pinLogin(body.userId, body.pin ?? '');
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    const till = currentTill();
    // Cashier / manager: one till at a time — signing in here ends the session on another till.
    if (till && (result.user.role === 'cashier' || result.user.role === 'manager')) {
      this.auth.markActiveTill(result.user.id, till.id);
    }
    const token = this.sessions.sign({
      userId: result.user.id,
      storeId: result.store.id,
      role: result.user.role,
      displayName: result.user.displayName,
      tillId: till?.id ?? null,
    });
    res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions());
    return {
      ok: true as const,
      session: {
        userId: result.user.id,
        displayName: result.user.displayName,
        role: result.user.role,
        storeId: result.store.id,
        till: till ? { id: till.id, code: till.code, name: till.name } : null,
      },
      sessionToken: token,
    };
  }

  /** Manager / owner PIN at a till → one-time approval for one action (refund, price override …). */
  @Post('approve')
  @UseGuards(SessionGuard)
  approve(@Body() body: { userId?: string; pin?: string; action?: string }) {
    return this.approvals.issue(body ?? {});
  }

  /** Compat alias for Slice 0 clients. */
  @Post('pin-login')
  pinLogin(
    @Body() body: { userId?: string; pin?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.login(body, res);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() req: AuthedRequest) {
    return {
      session: {
        userId: req.session!.userId,
        displayName: req.session!.displayName,
        role: req.session!.role,
        storeId: req.session!.storeId,
        till: (() => {
          const t = currentTill();
          return t ? { id: t.id, code: t.code, name: t.name } : null;
        })(),
      },
    };
  }

  /** Owner: does a recovery code exist and has it been saved? */
  @Get('recovery')
  @UseGuards(SessionGuard, OwnerGuard)
  recoveryStatus(@Req() req: AuthedRequest) {
    return this.recovery.status(req.session!.userId);
  }

  /** Owner: issue (or replace) the recovery code. Plain code is returned once. */
  @Post('recovery/generate')
  @UseGuards(SessionGuard, OwnerGuard)
  recoveryGenerate(@Req() req: AuthedRequest) {
    return { ok: true as const, code: this.recovery.issue(req.session!.userId) };
  }

  @Post('recovery/ack')
  @UseGuards(SessionGuard, OwnerGuard)
  recoveryAck(@Req() req: AuthedRequest) {
    return this.recovery.acknowledge(req.session!.userId);
  }

  /** Forgot PIN: recovery code + new PIN → new owner PIN, fresh code, session. */
  @Post('recover')
  recover(
    @Body() body: { code?: string; newPin?: string; new_pin?: string; confirmPin?: string; confirm_pin?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = this.recovery.recover({
      code: body.code,
      newPin: body.newPin ?? body.new_pin,
      confirmPin: body.confirmPin ?? body.confirm_pin,
    });
    if (!r.ok) return r;
    const token = this.sessions.sign({
      userId: r.user.id,
      storeId: r.store.id,
      role: r.user.role,
      displayName: r.user.displayName,
    });
    res.cookie(this.sessions.cookieName, token, this.sessions.cookieOptions());
    return {
      ok: true as const,
      session: { userId: r.user.id, displayName: r.user.displayName, role: r.user.role, storeId: r.store.id },
      sessionToken: token,
      code: r.code,
    };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(this.sessions.cookieName, { path: '/' });
    return { ok: true as const };
  }
}
