/**
 * Who is told about a ticket event (spec 13). In-app: assignment to me, new activity on
 * tickets I own or follow, and @mentions. Email: the per-category, per-user rules Owner,
 * Followed, New and Edit/new activity. Nobody is ever told about their own action, and
 * nobody hears about a ticket they cannot see.
 */
export type NotifyEvent =
  | { type: 'created'; actorId: string | null; ownerId: string | null }
  | { type: 'assigned'; actorId: string | null; ownerId: string | null }
  | { type: 'moved'; actorId: string | null; ownerId: string | null }
  | { type: 'activity'; actorId: string | null; ownerId: string | null; mentionedIds?: string[] };

export type InAppKind = 'assigned' | 'mention' | 'activity';
export type EmailKind = 'owner' | 'followed' | 'new' | 'activity' | 'mention';

/** A user's email rule for one category (spec 13 table). */
export interface EmailRule {
  userId: string;
  owner: boolean;
  followed: boolean;
  new: boolean;
  activity: boolean;
}

export interface NotificationPlan {
  inApp: { userId: string; kind: InAppKind }[];
  email: { userId: string; kind: EmailKind }[];
}

export function planNotifications(
  ev: NotifyEvent,
  ctx: { followerIds: readonly string[]; rules: readonly EmailRule[]; canSee: (userId: string) => boolean },
): NotificationPlan {
  const inApp = new Map<string, InAppKind>();
  const email = new Map<string, EmailKind>();
  const ok = (id: string | null | undefined): id is string => !!id && id !== ev.actorId && ctx.canSee(id);
  const addInApp = (id: string | null | undefined, kind: InAppKind) => {
    // One entry per person; a mention or an assignment says more than "new activity".
    if (ok(id) && (!inApp.has(id) || inApp.get(id) === 'activity')) inApp.set(id, kind);
  };
  const addEmail = (id: string, kind: EmailKind) => {
    if (ok(id) && !email.has(id)) email.set(id, kind);
  };
  const rule = (id: string) => ctx.rules.find((r) => r.userId === id);

  if (ev.type === 'created' || ev.type === 'assigned') {
    addInApp(ev.ownerId, 'assigned');
    if (ev.ownerId && rule(ev.ownerId)?.owner) addEmail(ev.ownerId, 'owner');
  }
  if (ev.type === 'created' || ev.type === 'moved') {
    for (const r of ctx.rules) if (r.new) addEmail(r.userId, 'new');
  }
  if (ev.type === 'activity') {
    for (const id of ev.mentionedIds ?? []) addInApp(id, 'mention');
    addInApp(ev.ownerId, 'activity');
    for (const id of ctx.followerIds) addInApp(id, 'activity');
    if (ev.ownerId && rule(ev.ownerId)?.owner) addEmail(ev.ownerId, 'owner');
    for (const id of ctx.followerIds) if (rule(id)?.followed) addEmail(id, 'followed');
    for (const r of ctx.rules) if (r.activity) addEmail(r.userId, 'activity');
  }
  return {
    inApp: [...inApp].map(([userId, kind]) => ({ userId, kind })),
    email: [...email].map(([userId, kind]) => ({ userId, kind })),
  };
}

/** SLA warning (default 30 working minutes before) and breach notices for an icon state. */
export function slaNotice(
  ind: { kind: 'response' | 'solution'; status: string; minutesLeft: number | null; due: string } | null,
  warnMinutes: number,
): { kind: 'sla_warning' | 'sla_breached'; key: string } | null {
  if (!ind || ind.minutesLeft === null) return null;
  if (ind.status === 'counting' && ind.minutesLeft <= warnMinutes)
    return { kind: 'sla_warning', key: `${ind.kind}:${ind.due}` };
  if (ind.status === 'breached') return { kind: 'sla_breached', key: `${ind.kind}:${ind.due}` };
  return null;
}
