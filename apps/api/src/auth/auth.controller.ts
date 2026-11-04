import { Body, Controller, Delete, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
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
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, session } = await this.auth.login(body, clientIp(req), req.header('user-agent') ?? null);
    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });
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
      })
      .from(users)
      .where(eq(users.id, auth.user.id));
    return {
      user: {
        ...auth.user,
        ...row,
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
