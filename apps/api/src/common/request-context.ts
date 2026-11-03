import type { Request } from 'express';
import type { Principal, RightsProfile } from '@relay-desk/domain';

/** Authenticated caller, attached to the request by the AuthGuard. */
export interface AuthContext {
  principal: Principal;
  rights: RightsProfile;
  user: { id: string; email: string; name: string; type: Principal['type'] };
  accessProfileId: string | null;
  rightsProfileId: string | null;
  /** 'session' for the web app (cookie), 'api_token' for integrations. */
  via: 'session' | 'api_token';
  sessionId: string | null;
  csrfToken: string | null;
}

export type AppRequest = Request & { auth?: AuthContext };

export function clientIp(req: Request): string | null {
  const ip = req.ip ?? req.socket.remoteAddress ?? null;
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
