import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { CONFIG, type AppConfig } from '../config/config';
import { effectiveSignature } from '@relay-desk/domain';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AppRequest, type AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { users } from '../db/schema';
import { AuthService } from './auth.service';
import { GOOGLE_SIGNIN_COOKIE, GoogleSignInRefused, GoogleSignInService } from './google-signin.service';
import { Auth, AuthenticatedOnly, Public } from './decorators';
import { SESSION_COOKIE } from './session.service';

const loginSchema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(256),
  totpCode: z.string().max(10).optional(),
});
const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1).max(256) });
const codeSchema = z.object({ code: z.string().min(1).max(10) });
const profileSchema = z.object({ signature: z.string().max(2000).nullable().optional() });
const disableTotpSchema = z.object({ password: z.string().min(1), code: z.string().min(1).max(10) });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
    @Inject(GoogleSignInService) private readonly google: GoogleSignInService,
  ) {}

  private setSessionCookie(res: Response, session: { token: string; expiresAt: Date }) {
    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });
  }

  /** What the sign-in page offers: Google (and for which domain) and who may use a password. */
  @Public()
  @Get('options')
  options() {
    return {
      google: this.google.enabled,
      googleDomain: this.google.enabled ? this.google.domain : null,
      password: this.config.PASSWORD_SIGNIN,
    };
  }

  /** Starts "Sign in with Google": sends the browser to Google, limited to the Workspace domain. */
  @Public()
  @Get('google/start')
  googleStart(@Res() res: Response) {
    try {
      const { url, nonce, maxAgeMs } = this.google.start();
      res.cookie(GOOGLE_SIGNIN_COOKIE, nonce, {
        httpOnly: true,
        secure: this.config.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/api/auth/google',
        maxAge: maxAgeMs,
      });
      res.redirect(url);
    } catch (err) {
      res.redirect(this.signInPage({ signin_error: err instanceof GoogleSignInRefused ? err.code : 'google_refused' }));
    }
  }

  /** Google sends the browser back here; on success it lands signed in on the home page. */
  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query() q: { code?: string; state?: string; error?: string },
    @Req() req: AppRequest,
    @Res() res: Response,
  ) {
    const ip = clientIp(req);
    const cookieNonce = (req.cookies as Record<string, string> | undefined)?.[GOOGLE_SIGNIN_COOKIE];
    res.clearCookie(GOOGLE_SIGNIN_COOKIE, { path: '/api/auth/google' });
    if (q.error || !q.code || !q.state) {
      await this.auth.googleRefused(null, ip, q.error ? 'cancelled' : 'invalid_state');
      return res.redirect(this.signInPage({ signin_error: q.error ? 'cancelled' : 'invalid_state' }));
    }
    let email: string;
    try {
      email = await this.google.finish(q.code, q.state, cookieNonce);
    } catch (err) {
      const code = err instanceof GoogleSignInRefused ? err.code : 'google_refused';
      await this.auth.googleRefused(null, ip, code);
      return res.redirect(this.signInPage({ signin_error: code }));
    }
    try {
      const signedIn = await this.auth.loginWithGoogle(email, ip, req.header('user-agent') ?? null);
      if (!signedIn) return res.redirect(this.signInPage({ signin_error: 'no_account' }));
      this.setSessionCookie(res, signedIn.session);
      return res.redirect(this.signInPage({}));
    } catch (err) {
      const code = err instanceof HttpException && err.getStatus() === 429 ? 'rate_limited' : 'google_refused';
      return res.redirect(this.signInPage({ signin_error: code }));
    }
  }

  private signInPage(params: Record<string, string>): string {
    const q = new URLSearchParams(params).toString();
    return `${this.config.PUBLIC_URL.replace(/\/$/, '')}/${q ? `?${q}` : ''}`;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, session } = await this.auth.login(body, clientIp(req), req.header('user-agent') ?? null);
    this.setSessionCookie(res, session);
    return {
      user: { id: user.id, email: user.email, name: user.name, type: user.type },
      csrfToken: session.csrfToken,
    };
  }

  @AuthenticatedOnly()
  @Post('logout')
  @HttpCode(204)
  async logout(@Auth() auth: AuthContext, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    if (auth.sessionId) await this.auth.logout(auth.sessionId, auth.user.id, clientIp(req));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @AuthenticatedOnly()
  @Get('me')
  async me(@Auth() auth: AuthContext) {
    const [row] = await this.db
      .select({
        signature: users.signature,
        totpEnabled: users.totpEnabled,
        timezone: users.timezone,
        apiTokenCreatedAt: users.apiTokenCreatedAt,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.id, auth.user.id));
    const { passwordHash, ...profile } = row ?? { passwordHash: null };
    return {
      user: {
        ...auth.user,
        ...profile,
        // Staff on Google sign-in have no password to change.
        hasPassword: !!passwordHash,
        signature: effectiveSignature(row?.signature ?? null, auth.user.name),
        hasCustomSignature: !!row?.signature?.trim(),
      },
      access: auth.principal.access,
      rights: auth.rights,
      csrfToken: auth.csrfToken,
    };
  }

  /** The caller's own preferences (currently the email signature). */
  @AuthenticatedOnly()
  @Patch('me')
  async updateProfile(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(profileSchema)) body: z.infer<typeof profileSchema>,
  ) {
    if (body.signature !== undefined) {
      await this.db
        .update(users)
        .set({ signature: body.signature?.trim() ? body.signature : null, updatedAt: new Date() })
        .where(eq(users.id, auth.user.id));
    }
    return this.me(auth);
  }

  @AuthenticatedOnly()
  @Post('password')
  @HttpCode(204)
  async changePassword(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(passwordSchema)) body: z.infer<typeof passwordSchema>,
  ) {
    await this.auth.changePassword(auth.user.id, body.currentPassword, body.newPassword, auth.sessionId, clientIp(req));
  }

  @AuthenticatedOnly()
  @Post('totp/setup')
  @HttpCode(200)
  beginTotp(@Auth() auth: AuthContext) {
    return this.auth.beginTotpSetup(auth.user.id);
  }

  @AuthenticatedOnly()
  @Post('totp/confirm')
  @HttpCode(204)
  async confirmTotp(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(codeSchema)) body: { code: string },
  ) {
    await this.auth.confirmTotpSetup(auth.user.id, body.code, clientIp(req));
  }

  @AuthenticatedOnly()
  @Post('totp/disable')
  @HttpCode(204)
  async disableTotp(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(disableTotpSchema)) body: z.infer<typeof disableTotpSchema>,
  ) {
    await this.auth.disableTotp(auth.user.id, body.password, body.code, clientIp(req));
  }

  @AuthenticatedOnly()
  @Post('api-token')
  @HttpCode(201)
  async createApiToken(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    return { token: await this.auth.createApiToken(auth.user.id, clientIp(req)) };
  }

  @AuthenticatedOnly()
  @Delete('api-token')
  @HttpCode(204)
  async revokeApiToken(@Auth() auth: AuthContext, @Req() req: AppRequest) {
    await this.auth.revokeApiToken(auth.user.id, clientIp(req));
  }
}
