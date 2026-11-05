import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import {
  backlogByDay,
  countByDay,
  dayKeys,
  dayOf,
  firstResolvedAt,
  heatmap,
  median,
  percentMet,
  wasReopened,
  workingMinutesBetween,
  type StateEvent,
  type TicketState,
  type TimeGroup,
} from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { activities, categories, emailMessages, historyEntries, mailboxQueues, tickets, users } from '../db/schema';
import { SlaService } from '../sla/sla.service';
import { TicketsService } from '../tickets/tickets.service';

export interface ReportFilter {
  from: Date;
  to: Date;
  categoryId?: string;
  userId?: string;
  queueId?: string;
  priority?: 'low' | 'normal' | 'high';
}

type Row = typeof tickets.$inferSelect;
const STATES = new Set(['open', 'waiting', 'closed', 'archived']);

/**
 * Ticket reporting (spec 17). Every figure is computed from tickets the user can see (their
 * categories), using the domain maths in `reports/metrics.ts` and working time from each
 * category's working hours.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TicketsService) private readonly ticketsService: TicketsService,
    @Inject(SlaService) private readonly sla: SlaService,
  ) {}

  private async tz(auth: AuthContext) {
    const [u] = await this.db.select({ tz: users.timezone }).from(users).where(eq(users.id, auth.user.id));
    return u?.tz ?? 'Europe/London';
  }

  /** Visible, live tickets matching the filters (not by date). */
  private scope(auth: AuthContext, f: ReportFilter): SQL[] {
    const w: (SQL | undefined)[] = [isNull(tickets.deletedAt), this.ticketsService.categoryScope(auth)];
    if (f.categoryId) w.push(eq(tickets.categoryId, f.categoryId));
    if (f.userId) w.push(eq(tickets.userId, f.userId));
    if (f.priority) w.push(eq(tickets.priority, f.priority));
    if (f.queueId)
      w.push(
        sql`exists (select 1 from activities a join email_messages m on m.activity_id = a.id where a.ticket_id = ${tickets.id} and m.queue_id = ${f.queueId})`,
      );
    return w.filter((x): x is SQL => !!x);
  }

  /** State changes per ticket from history (the create entry gives the starting state). */
  private async events(ids: number[]): Promise<Map<number, StateEvent[]>> {
    const out = new Map<number, StateEvent[]>();
    for (let i = 0; i < ids.length; i += 5000) {
      const chunk = ids.slice(i, i + 5000).map(String);
      const rows = await this.db
        .select({ id: historyEntries.entityId, at: historyEntries.createdAt, changes: historyEntries.changes })
        .from(historyEntries)
        .where(
          and(
            eq(historyEntries.entityType, 'ticket'),
            inArray(historyEntries.entityId, chunk),
            sql`${historyEntries.changes} @> '[{"field":"state"}]'::jsonb`,
          ),
        )
        .orderBy(asc(historyEntries.createdAt));
      for (const r of rows) {
        const c = r.changes.find((x) => x.field === 'state');
        if (!c || typeof c.new !== 'string' || !STATES.has(c.new)) continue;
        const list = out.get(Number(r.id)) ?? [];
        list.push({ at: r.at, state: c.new as TicketState });
        out.set(Number(r.id), list);
      }
    }
    return out;
  }

  private async timeGroups(): Promise<Map<string, TimeGroup | null>> {
    const cats = await this.db.select({ id: categories.id, tg: categories.timeGroupId }).from(categories);
    const out = new Map<string, TimeGroup | null>();
    for (const c of cats) out.set(c.id, await this.sla.loadTimeGroup(this.db, c.tg));
    return out;
  }

  async summary(auth: AuthContext, f: ReportFilter) {
    const tz = await this.tz(auth);
    const days = dayKeys(f.from, f.to, tz);
    const scope = this.scope(auth, f);
    // Every ticket that existed during the period (for backlog), plus the ones created in it.
    const rows = await this.db
      .select()
      .from(tickets)
      .where(and(...scope, lte(tickets.createdAt, f.to)))
      .orderBy(asc(tickets.id));
    const events = await this.events(rows.map((r) => r.id));
    const ev = (t: Row) => events.get(t.id) ?? [];
    const inPeriod = (d: Date | null) => !!d && d >= f.from && d <= f.to;
    const groups = await this.timeGroups();

    const created = rows.filter((t) => inPeriod(t.createdAt));
    const closeEvents = rows.flatMap((t) =>
      ev(t)
        .filter((e) => (e.state === 'closed' || e.state === 'archived') && inPeriod(e.at))
        .map((e) => ({ t, at: e.at })),
    );
    const closedTickets = [...new Map(closeEvents.map((c) => [c.t.id, c.t])).values()];
    const firstClose = new Map(rows.map((t) => [t.id, firstResolvedAt(ev(t))]));

    const response = created
      .filter((t) => t.firstAnswerAt)
      .map((t) => workingMinutesBetween(t.createdAt, t.firstAnswerAt!, groups.get(t.categoryId) ?? null));
    const resolution = rows
      .filter((t) => inPeriod(firstClose.get(t.id) ?? null))
      .map((t) =>
        Math.max(
          0,
          workingMinutesBetween(t.createdAt, firstClose.get(t.id)!, groups.get(t.categoryId) ?? null) -
            t.slaPausedSeconds / 60,
        ),
      );
    const reopened = closedTickets.filter((t) => wasReopened(ev(t)));

    const names = new Map(
      (await this.db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]),
    );
    const workload = new Map<string, { userId: string; name: string; open: number; closed: number }>();
    const slot = (id: string) => {
      if (!workload.has(id)) workload.set(id, { userId: id, name: names.get(id) ?? '?', open: 0, closed: 0 });
      return workload.get(id)!;
    };
    for (const t of rows) if (t.userId && t.state === 'open') slot(t.userId).open++;
    for (const t of closedTickets) if (t.userId) slot(t.userId).closed++;

    const inbound = await this.db
      .select({ at: activities.createdAt })
      .from(activities)
      .innerJoin(tickets, eq(tickets.id, activities.ticketId))
      .where(
        and(
          ...scope,
          eq(activities.type, 'email'),
          eq(activities.direction, 'in'),
          gte(activities.createdAt, f.from),
          lte(activities.createdAt, f.to),
        ),
      );

    return {
      timezone: tz,
      days,
      created: countByDay(
        created.map((t) => t.createdAt),
        days,
        tz,
      ),
      closed: countByDay(
        closeEvents.map((c) => c.at),
        days,
        tz,
      ),
      totals: { created: created.length, closed: closedTickets.length },
      backlog: backlogByDay(
        rows.map((t) => ({ createdAt: t.createdAt, events: ev(t) })),
        days,
        tz,
      ),
      firstAnswer: percentMet(created.map((t) => t.firstAnswerMet)),
      solution: percentMet(created.map((t) => t.solutionMet)),
      medianFirstResponseMinutes: round(median(response)),
      medianResolutionMinutes: round(median(resolution)),
      reopenRate: {
        reopened: reopened.length,
        closed: closedTickets.length,
        percent: closedTickets.length ? Math.round((reopened.length / closedTickets.length) * 1000) / 10 : null,
      },
      workload: [...workload.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
      heatmap: heatmap(
        inbound.map((i) => i.at),
        tz,
      ),
      inboundEmails: inbound.length,
    };
  }

  /** The tickets behind a figure (drill-down, spec 17). */
  async drill(auth: AuthContext, f: ReportFilter, metric: string, opts: { userId?: string; day?: string }) {
    const tz = await this.tz(auth);
    const rows = await this.db
      .select()
      .from(tickets)
      .where(and(...this.scope(auth, f), lte(tickets.createdAt, f.to)))
      .orderBy(desc(tickets.id));
    const events = await this.events(rows.map((r) => r.id));
    const ev = (t: Row) => events.get(t.id) ?? [];
    const inPeriod = (d: Date | null) => !!d && d >= f.from && d <= f.to;
    const closedIn = (t: Row) => ev(t).some((e) => (e.state === 'closed' || e.state === 'archived') && inPeriod(e.at));
    const onDay = (d: Date) => !opts.day || dayOf(d, tz) === opts.day;
    let pick: Row[];
    switch (metric) {
      case 'created':
        pick = rows.filter((t) => inPeriod(t.createdAt) && onDay(t.createdAt));
        break;
      case 'closed':
        pick = rows.filter((t) =>
          ev(t).some((e) => (e.state === 'closed' || e.state === 'archived') && inPeriod(e.at) && onDay(e.at)),
        );
        break;
      case 'reopened':
        pick = rows.filter((t) => closedIn(t) && wasReopened(ev(t)));
        break;
      case 'first_answer_missed':
        pick = rows.filter((t) => inPeriod(t.createdAt) && t.firstAnswerMet === false);
        break;
      case 'solution_missed':
        pick = rows.filter((t) => inPeriod(t.createdAt) && t.solutionMet === false);
        break;
      case 'open_by_user':
        pick = rows.filter((t) => t.state === 'open' && t.userId === opts.userId);
        break;
      case 'closed_by_user':
        pick = rows.filter((t) => closedIn(t) && t.userId === opts.userId);
        break;
      default:
        pick = [];
    }
    return pick.slice(0, 500).map((t) => ({
      id: t.id,
      title: t.title,
      state: t.state,
      priority: t.priority,
      categoryId: t.categoryId,
      userId: t.userId,
      createdAt: t.createdAt,
    }));
  }

  /** Activities listing (spec 17 [SHOULD]): email across tickets, to spot failures and stray mail. */
  async emails(auth: AuthContext, f: ReportFilter & { direction?: 'in' | 'out'; status?: string }) {
    const w: SQL[] = [
      ...this.scope(auth, f),
      eq(activities.type, 'email'),
      gte(activities.createdAt, f.from),
      lte(activities.createdAt, f.to),
    ];
    if (f.direction) w.push(eq(activities.direction, f.direction));
    if (f.status) w.push(eq(activities.status, f.status));
    return this.db
      .select({
        id: activities.id,
        ticketId: activities.ticketId,
        ticketTitle: tickets.title,
        direction: activities.direction,
        status: activities.status,
        error: activities.error,
        createdAt: activities.createdAt,
        subject: emailMessages.subject,
        from: emailMessages.from,
        to: emailMessages.to,
        queue: mailboxQueues.title,
        userName: users.name,
      })
      .from(activities)
      .innerJoin(tickets, eq(tickets.id, activities.ticketId))
      .leftJoin(emailMessages, eq(emailMessages.activityId, activities.id))
      .leftJoin(mailboxQueues, eq(mailboxQueues.id, emailMessages.queueId))
      .leftJoin(users, eq(users.id, activities.userId))
      .where(and(...w))
      .orderBy(desc(activities.createdAt))
      .limit(500);
  }
}

const round = (n: number | null) => (n === null ? null : Math.round(n));
