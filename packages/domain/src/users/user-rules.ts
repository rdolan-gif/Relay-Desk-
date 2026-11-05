import type { UserType } from './user-type.js';

export type UserChangeDecision =
  { allowed: true } | { allowed: false; code: 'type_change_while_logged_in' | 'self_lockout'; message: string };

export interface UserChangeContext {
  actorId: string;
  targetId: string;
  currentType: UserType;
  newType?: UserType;
  newIsActive?: boolean;
  /** Whether the target user has at least one live session right now. */
  targetHasActiveSession: boolean;
}

/**
 * When an admin changes a user's type while that user is logged in, the system
 * refuses (spec 4, "Rules"). Changing profiles is always allowed and takes effect
 * on the user's next request.
 *
 * Also: an admin cannot deactivate themselves or change their own type, so the
 * last administrator cannot lock everyone out (docs/open-questions.md, Q-P0-3).
 */
export function checkUserChange(ctx: UserChangeContext): UserChangeDecision {
  const typeChanging = ctx.newType !== undefined && ctx.newType !== ctx.currentType;
  const isSelf = ctx.actorId === ctx.targetId;
  if (isSelf && (typeChanging || ctx.newIsActive === false)) {
    return {
      allowed: false,
      code: 'self_lockout',
      message: 'You cannot change your own user type or deactivate yourself.',
    };
  }
  if (typeChanging && ctx.targetHasActiveSession) {
    return {
      allowed: false,
      code: 'type_change_while_logged_in',
      message: 'The user type cannot be changed while the user is logged in.',
    };
  }
  return { allowed: true };
}

/**
 * When a user is deactivated, the system logs them out and removes them as a follower
 * (spec 4). Ticket ownership is cleared lazily on each ticket's next save (Phase 2).
 */
export interface DeactivationEffects {
  revokeSessions: true;
  revokeApiToken: true;
  removeAsFollower: true;
}

export function deactivationEffects(): DeactivationEffects {
  return { revokeSessions: true, revokeApiToken: true, removeAsFollower: true };
}

/** Emails are compared and stored lower-cased and trimmed. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Default email sign-off (owner answer Q13); each person can change theirs in My account. */
export function defaultSignature(name: string): string {
  return `Kind regards,\n${name.trim()}`;
}

/** The signature used for a person: their own, or the default when they haven't set one. */
export function effectiveSignature(stored: string | null, name: string): string {
  return stored && stored.trim() ? stored : defaultSignature(name);
}
