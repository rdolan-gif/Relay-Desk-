import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq, and, isNull } from 'drizzle-orm';
import {
  checkAccessFlag,
  checkModuleAccess,
  userTypeCanUseInternalApp,
  type AccessFlag,
  type ModuleKey,
  type Verb,
} from '@relay-desk/domain';
import { sha256 } from '../common/crypto';
import type { AppRequest, AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { users } from '../db/schema';
import { ACCESS_KEY, AUTHENTICATED_KEY, FLAG_KEY, PUBLIC_KEY } from './decorators';
import { PermissionsService } from './permissions.service';
import { SESSION_COOKIE, SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Global guard. Every route is denied unless it is marked @Public, @AuthenticatedOnly,
 * @RequireAccess or @RequireFlag. Authorisation always runs server-side through the
 * domain layer (spec 18, "Security").
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const auth = await this.authenticate(req);
    if (!auth) throw new UnauthorizedException({ message: 'Not logged in', reason: 'unauthenticated' });

    if (!userTypeCanUseInternalApp(auth.principal.type)) {
      throw new ForbiddenException({ message: 'External users can only use the portal.', reason: 'external_user' });
    }

    if (auth.via === 'session' && !SAFE_METHODS.has(req.method)) {
      const header = req.header(CSRF_HEADER);
      if (!header || header !== auth.csrfToken) {
        throw new ForbiddenException({ message: 'Missing or invalid CSRF token', reason: 'csrf' });
      }
    }
    req.auth = auth;

    const access = this.reflector.getAllAndOverride<{ module: ModuleKey; verb: Verb } | undefined>(ACCESS_KEY, targets);
    const flag = this.reflector.getAllAndOverride<AccessFlag | undefined>(FLAG_KEY, targets);
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets);

    if (!access && !flag && !authenticatedOnly) {
      throw new ForbiddenException({ message: 'Route has no access rule', reason: 'route_not_classified' });
    }
    if (access) {
      const decision = checkModuleAccess(auth.principal, access.module, access.verb);
      if (!decision.allowed) {
        throw new ForbiddenException({
          message: `You do not have ${access.verb} access to ${access.module}.`,
          reason: decision.reason,
        });
      }
    }
    if (flag) {
      const decision = checkAccessFlag(auth.principal, flag);
      if (!decision.allowed) {
        throw new ForbiddenException({ message: `Missing permission: ${flag}.`, reason: decision.reason });
      }
    }
    return true;
  }

  private async authenticate(req: AppRequest): Promise<AuthContext | null> {
    const header = req.header('authorization');
    if (header?.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      if (!token) return null;
      const [row] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.apiTokenHash, sha256(token)), isNull(users.deletedAt)));
      if (!row) return null;
      return this.buildContext(row.id, 'api_token', null, null);
    }
    const cookie = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!cookie) return null;
    const session = await this.sessions.resolve(cookie);
    if (!session) return null;
    return this.buildContext(session.userId, 'session', session.id, session.csrfToken);
  }

  private async buildContext(
    userId: string,
    via: AuthContext['via'],
    sessionId: string | null,
    csrfToken: string | null,
  ): Promise<AuthContext | null> {
    const loaded = await this.permissions.load(userId);
    if (!loaded || !loaded.user.isActive) return null;
    const { user, principal, rights, ticketRights } = loaded;
    return {
      principal,
      rights,
      ticketRights,
      user: { id: user.id, email: user.email, name: user.name, type: user.type },
      accessProfileId: user.accessProfileId,
      rightsProfileId: user.rightsProfileId,
      via,
      sessionId,
      csrfToken,
    };
  }
}
