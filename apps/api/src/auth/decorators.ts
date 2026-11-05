import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccessFlag, ModuleKey, Verb } from '@relay-desk/domain';
import type { AppRequest, AuthContext } from '../common/request-context';

export const PUBLIC_KEY = 'rd:public';
export const AUTHENTICATED_KEY = 'rd:authenticated';
export const ACCESS_KEY = 'rd:access';
export const FLAG_KEY = 'rd:flag';

/** No authentication required (login, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Any logged-in internal user; no module check (e.g. own profile, logout). */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_KEY, true);

/** Requires module access with the given verb (spec 4). */
export const RequireAccess = (module: ModuleKey, verb: Verb) => SetMetadata(ACCESS_KEY, { module, verb });

/** Requires an extra access flag (spec 4). */
export const RequireFlag = (flag: AccessFlag) => SetMetadata(FLAG_KEY, flag);

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw new Error('Auth context missing: route is not protected by AuthGuard');
  return req.auth;
});
