import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import MailComposer from 'nodemailer/lib/mail-composer';
import {
  canSeeCategory,
  planNotifications,
  slaNotice,
  type EmailKind,
  type InAppKind,
  type NotifyEvent,
  type TicketRights,
} from '@relay-desk/domain';
import { PermissionsService } from '../auth/permissions.service';
import type { AuthContext } from '../common/request-context';
import { CONFIG, type AppConfig } from '../config/config';
import { DB, type Db } from '../db/db';
import {
  categories,
  mailboxQueues,
  notificationRules,
  notifications,
  ticketFollowers,
  tickets,
  users,
} from '../db/schema';
import { MailboxesService } from '../email/mailboxes.service';
import { MAIL_PROVIDERS, type MailProviders } from '../email/providers';
import { SlaService } from '../sla/sla.service';
import { RealtimeService } from './realtime.service';

type Kind = InAppKind | 'sla_warning' | 'sla_breached' | 'email_failed';

const EMAIL_REASON: Record<EmailKind, string> = {
  owner: 'you own this ticket',
  followed: 'you follow this ticket',
  new: 'you asked to hear about new tickets in this category',
  activity: 'you asked to hear about activity in this category',
  mention: 'you were mentioned',
};

/**
 * Notifications (spec 13): in-app entries pushed live to the browser, and email by the
 * per-category rules. Never throws into the caller: a failed notification must not undo or
 * block the change that caused it.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(MailboxesService) private readonly mailboxes: MailboxesService,
    @Inject(MAIL_PROVIDERS) private readonly providers: MailProviders,
    @Inject(SlaService) private readonly sla: SlaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------ events

  /** A ticket event after its transaction committed. */
  async ticketEvent(
    ticketId: number,
    event: Omit<NotifyEvent, 'ownerId'> & { mentionedIds?: string[] },
    summary?: string,
  ) {
    try {
      const [t] = await this.db.select().from(tickets).where(eq(tickets.id, ticketId));
      if (!t || t.deletedAt) return;
      const ev = { ...event, ownerId: t.userId } as NotifyEvent;
      const followerIds = (
        await this.db
          .select({ id: ticketFollowers.userId })
          .from(ticketFollowers)
          .where(eq(ticketFollowers.ticketId, ticketId))
      ).map((f) => f.id);
      const rules = (
        await this.db.select().from(notificationRules).where(eq(notificationRules.categoryId, t.categoryId))
      ).map((r) => ({ userId: r.userId, owner: r.owner, followed: r.followed, new: r.isNew, activity: r.activity }));
      const ids = new Set<string>([
        ...(ev.ownerId ? [ev.ownerId] : []),
        ...followerIds,
        ...(ev.type === 'activity' ? (ev.mentionedIds ?? []) : []),
        ...rules.map((r) => r.userId),
      ]);
      const people = await this.recipients([...ids]);
      const plan = planNotifications(ev, {
        followerIds,
        rules,
        canSee: (id) => {
          const p = people.get(id);
          return !!p && canSeeCategory(p.rights, t.categoryId);
        },
      });
      const actor = ev.actorId
        ? (await this.db.select({ name: users.name }).from(users).where(eq(users.id, ev.actorId)))[0]?.name
        : null;
      const who = actor ?? 'Relay Desk';
      for (const n of plan.inApp) {
        const title =
          n.kind === 'assigned'
            ? `#${t.id} was assigned to you`
            : n.kind === 'mention'
              ? `${who} mentioned you on #${t.id}`
              : `New activity on #${t.id}`;
        await this.add(n.userId, n.kind, {
          ticketId: t.id,
          actorId: ev.actorId,
          title,
          body: summary ? `${t.title} — ${summary}` : t.title,
        });
      }
      for (const e of plan.email) {
        const p = people.get(e.userId)!;
        await this.email(p.address, `[#${t.id}] ${t.title}`, [
          summary ??
            (ev.type === 'activity'
              ? `New activity from ${who}.`
              : ev.type === 'assigned'
                ? 'This ticket was assigned to you.'
                : 'A new ticket arrived.'),
          `You are getting this because ${EMAIL_REASON[e.kind]}.`,
          this.link(t.id),
        ]);
      }
    } catch (err) {
      this.log.error(`ticket event ${event.type} on #${ticketId}: ${(err as Error).message}`);
    }
  }

  /** Mentions added while editing a comment notify only those people (spec 6.2). */
  async mentioned(ticketId: number, actorId: string, userIds: string[]) {
    if (!userIds.length) return;
    try {
      const [t] = await this.db.select().from(tickets).where(eq(tickets.id, ticketId));
      if (!t) return;
      const people = await this.recipients(userIds);
      const [actor] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, actorId));
      for (const id of userIds) {
        const p = people.get(id);
        if (!p || id === actorId || !canSeeCategory(p.rights, t.categoryId)) continue;
        await this.add(id, 'mention', {
          ticketId,
          actorId,
          title: `${actor?.name ?? 'Someone'} mentioned you on #${ticketId}`,
          body: t.title,
        });
      }
    } catch (err) {
      this.log.error(`mention on #${ticketId}: ${(err as Error).message}`);
    }
  }

  /** A send failed: tell the person who sent it (spec 13). */
  async emailFailed(userId: string | null, ticketId: number, reason: string) {
    if (!userId) return;
    await this.add(userId, 'email_failed', {
      ticketId,
      title: `An email on #${ticketId} was not delivered`,
      body: reason,
    }).catch((err) => this.log.error((err as Error).message));
  }

  /**
   * The minute job: "SLA about to breach" (SLA_WARNING_MINUTES working minutes before,
   * default 30) and "breached", once per deadline, to the owner and followers.
   */
  async slaSweep(now = new Date()) {
    const soon = new Date(now.getTime() + 3 * 86_400_000);
    const recent = new Date(now.getTime() - 86_400_000);
    const rows = await this.db
      .select()
      .from(tickets)
      .where(
        and(
          isNull(tickets.deletedAt),
          isNull(tickets.mergedIntoId),
          inArray(tickets.state, ['open', 'waiting']),
          or(
            and(
              isNotNull(tickets.firstAnswerDeadline),
              isNull(tickets.firstAnswerAt),
              eq(tickets.noReplyNeeded, false),
              sql`${tickets.firstAnswerDeadline} between ${recent} and ${soon}`,
            ),
            and(isNotNull(tickets.deadline), sql`${tickets.deadline} between ${recent} and ${soon}`),
          ),
        ),
      )
      .limit(1000);
    let sent = 0;
    const described = await this.sla.describe(rows, now);
    for (const t of rows) {
      const ind = described.get(t.id)?.indicator ?? null;
      const notice = slaNotice(ind, this.config.SLA_WARNING_MINUTES);
      if (!notice) continue;
      const followers = (
        await this.db
          .select({ id: ticketFollowers.userId })
          .from(ticketFollowers)
          .where(eq(ticketFollowers.ticketId, t.id))
      ).map((f) => f.id);
      const people = await this.recipients([...new Set([...(t.userId ? [t.userId] : []), ...followers])]);
      const what = ind!.kind === 'response' ? 'first reply' : 'deadline';
      for (const [id, p] of people) {
        if (!canSeeCategory(p.rights, t.categoryId)) continue;
        const ok = await this.add(id, notice.kind, {
          ticketId: t.id,
          title:
            notice.kind === 'sla_warning'
              ? `#${t.id}: ${what} due in ${ind!.minutesLeft} working minutes`
              : `#${t.id}: ${what} missed`,
          body: t.title,
          dedupeKey: `${notice.kind}:${t.id}:${notice.key}`,
        });
        if (ok) sent++;
      }
    }
    return sent;
  }

  // ------------------------------------------------------------------ centre

  async list(auth: AuthContext, opts: { unreadOnly?: boolean; limit?: number } = {}) {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, auth.user.id), opts.unreadOnly ? isNull(notifications.readAt) : undefined))
      .orderBy(desc(notifications.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200));
    return { items: rows.map(publicNotification), unread: await this.unread(auth.user.id) };
  }

  async unread(userId: string) {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return r?.n ?? 0;
  }

  async markRead(auth: AuthContext, id: string | 'all') {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, auth.user.id),
          isNull(notifications.readAt),
          id === 'all' ? undefined : eq(notifications.id, id),
        ),
      );
    const unread = await this.unread(auth.user.id);
    this.realtime.push(auth.user.id, { type: 'unread', data: { unread } });
    return { unread };
  }

  // ------------------------------------------------------------------ email rules

  /** The caller's rules for every category they can see, plus their notification address. */
  async rules(auth: AuthContext) {
    const cats = (
      await this.db
        .select({ id: categories.id, title: categories.title })
        .from(categories)
        .where(isNull(categories.deletedAt))
    ).filter((c) => canSeeCategory(auth.ticketRights, c.id));
    const mine = await this.db.select().from(notificationRules).where(eq(notificationRules.userId, auth.user.id));
    const [u] = await this.db
      .select({ notificationEmail: users.notificationEmail, email: users.email })
      .from(users)
      .where(eq(users.id, auth.user.id));
    const [sender] = await this.db
      .select({ id: mailboxQueues.id })
      .from(mailboxQueues)
      .where(and(eq(mailboxQueues.sendsNotifications, true), isNull(mailboxQueues.deletedAt)))
      .limit(1);
    return {
      notificationEmail: u?.notificationEmail ?? null,
      defaultEmail: u?.email ?? '',
      emailAvailable: !!sender,
      categories: cats
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((c) => {
          const r = mine.find((m) => m.categoryId === c.id);
          return {
            categoryId: c.id,
            title: c.title,
            owner: !!r?.owner,
            followed: !!r?.followed,
            new: !!r?.isNew,
            activity: !!r?.activity,
          };
        }),
    };
  }

  async setRules(
    auth: AuthContext,
    input: {
      notificationEmail: string | null;
      rules: { categoryId: string; owner: boolean; followed: boolean; new: boolean; activity: boolean }[];
    },
  ) {
    const allowed = input.rules.filter((r) => canSeeCategory(auth.ticketRights, r.categoryId));
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ notificationEmail: input.notificationEmail }).where(eq(users.id, auth.user.id));
      await tx.delete(notificationRules).where(eq(notificationRules.userId, auth.user.id));
      const on = allowed.filter((r) => r.owner || r.followed || r.new || r.activity);
      if (on.length)
        await tx
          .insert(notificationRules)
          .values(
            on.map((r) => ({
              userId: auth.user.id,
              categoryId: r.categoryId,
              owner: r.owner,
              followed: r.followed,
              isNew: r.new,
              activity: r.activity,
            })),
          );
    });
    return this.rules(auth);
  }

  // ------------------------------------------------------------------ internals

  private async recipients(ids: string[]) {
    const out = new Map<string, { rights: TicketRights; address: string }>();
    if (!ids.length) return out;
    const rows = await this.db
      .select()
      .from(users)
      .where(and(inArray(users.id, ids), isNull(users.deletedAt), eq(users.isActive, true)));
    const cache = new Map<string, TicketRights>();
    for (const u of rows) {
      if (u.type === 'external' || !u.rightsProfileId) continue;
      let r = cache.get(u.rightsProfileId);
      if (!r) {
        r = await this.permissions.loadTicketRights(u.rightsProfileId);
        cache.set(u.rightsProfileId, r);
      }
      out.set(u.id, { rights: r, address: u.notificationEmail ?? u.email });
    }
    return out;
  }

  /** Stores and pushes one entry; false when the dedupe key says it was already sent. */
  private async add(
    userId: string,
    kind: Kind,
    v: { ticketId?: number; actorId?: string | null; title: string; body?: string; dedupeKey?: string },
  ): Promise<boolean> {
    const [row] = await this.db
      .insert(notifications)
      .values({
        userId,
        kind,
        ticketId: v.ticketId ?? null,
        actorId: v.actorId ?? null,
        title: v.title,
        body: v.body ?? '',
        dedupeKey: v.dedupeKey ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return false;
    this.realtime.push(userId, {
      type: 'notification',
      data: { ...publicNotification(row), unread: await this.unread(userId) },
    });
    return true;
  }

  private link(ticketId: number) {
    return `${this.config.PUBLIC_URL.replace(/\/$/, '')}/tickets/${ticketId}`;
  }

  /** Sends from the mailbox marked "Send staff notifications"; silently skipped if none. */
  private async email(to: string, subject: string, lines: string[]) {
    const [box] = await this.db
      .select()
      .from(mailboxQueues)
      .where(and(eq(mailboxQueues.sendsNotifications, true), isNull(mailboxQueues.deletedAt)))
      .limit(1);
    if (!box) return;
    const raw = await new MailComposer({
      from: { name: 'Relay Desk', address: box.address },
      to,
      subject,
      text: lines.join('\n\n'),
      // Marked automatic so no mailbox ever turns it into a ticket or answers it.
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
        'X-Relay-Desk': 'notification',
      },
    })
      .compile()
      .build();
    try {
      await this.providers[box.provider].send(this.mailboxes.ref(box), raw, {});
    } catch (err) {
      this.log.warn(`notification email to ${to} failed: ${(err as Error).message}`);
    }
  }
}

export function publicNotification(n: typeof notifications.$inferSelect) {
  return {
    id: n.id,
    kind: n.kind,
    ticketId: n.ticketId,
    title: n.title,
    body: n.body,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
