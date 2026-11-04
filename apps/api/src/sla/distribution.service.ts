import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { canUseMailbox, planDistribution, type DistributionCandidate, type TicketRights } from '@relay-desk/domain';
import { PermissionsService } from '../auth/permissions.service';
import type { AuthContext } from '../common/request-context';
import { DB, type Db, type DbOrTx } from '../db/db';
import { mailboxQueues, queueLogins, tickets, users } from '../db/schema';
import { HistoryService } from '../history/history.service';

/**
 * Automatic distribution (spec 9). Runs after a mailbox ticket is created, whenever an
 * agent's Open count can drop (Waiting, Closed, Archived, reassigned) or an agent logs in
 * to a queue, and every minute as a safety net. A per-category advisory lock means two
 * runs can never assign past an agent's limit.
 */
@Injectable()
export class DistributionService {
  private readonly log = new Logger('Distribution');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(HistoryService) private readonly history: HistoryService,
  ) {}

  /** Categories with backlog tickets. */
  private async backlogCategories(): Promise<string[]> {
    const rows = await this.db.selectDistinct({ id: tickets.categoryId }).from(tickets).where(this.backlogWhere());
    return rows.map((r) => r.id);
  }

  private backlogWhere(categoryId?: string) {
    return and(
      categoryId ? eq(tickets.categoryId, categoryId) : undefined,
      eq(tickets.distributable, true),
      isNull(tickets.userId),
      eq(tickets.state, 'open'),
      isNull(tickets.deletedAt),
      isNull(tickets.mergedIntoId),
    );
  }

  /** Distributes backlog tickets; with no ids, every category that has a backlog. */
  async run(categoryIds?: (string | null | undefined)[], now = new Date()) {
    const ids = categoryIds
      ? [...new Set(categoryIds.filter((c): c is string => !!c))]
      : await this.backlogCategories();
    const assigned: { ticketId: number; userId: string }[] = [];
    for (const categoryId of ids) {
      try {
        assigned.push(...(await this.runCategory(categoryId, now)));
      } catch (err) {
        this.log.error(`Distribution failed for category ${categoryId}: ${(err as Error).message}`);
      }
    }
    return assigned;
  }

  private async runCategory(categoryId: string, now: Date) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'distribution:' + categoryId}))`);
      const backlog = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(this.backlogWhere(categoryId))
        .orderBy(asc(tickets.createdAt), asc(tickets.id))
        .limit(200);
      if (!backlog.length) return [];
      const candidates = await this.candidates(tx, categoryId);
      const plan = planDistribution(
        backlog.map((b) => b.id),
        candidates,
        now,
      );
      for (const p of plan) {
        const [row] = await tx
          .update(tickets)
          .set({ userId: p.userId, version: sql`${tickets.version} + 1`, updatedAt: now })
          .where(and(eq(tickets.id, p.ticketId), isNull(tickets.userId)))
          .returning({ id: tickets.id });
        if (!row) continue;
        await tx.update(users).set({ lastDistributedAt: now }).where(eq(users.id, p.userId));
        await this.history.record(tx, null, 'ticket', p.ticketId, 'update', [
          { field: 'userId', old: null, new: p.userId },
        ]);
      }
      return plan;
    });
  }

  private async candidates(tx: DbOrTx, categoryId: string): Promise<DistributionCandidate[]> {
    const queues = (
      await tx
        .select({ id: mailboxQueues.id })
        .from(mailboxQueues)
        .where(and(eq(mailboxQueues.defaultCategoryId, categoryId), isNull(mailboxQueues.deletedAt)))
    ).map((q) => q.id);
    if (!queues.length) return [];
    const logins = await tx.select().from(queueLogins).where(inArray(queueLogins.queueId, queues));
    if (!logins.length) return [];
    const userIds = [...new Set(logins.map((l) => l.userId))];
    const people = await tx
      .select()
      .from(users)
      .where(and(inArray(users.id, userIds), isNull(users.deletedAt), ne(users.type, 'external')));
    const counts = await tx
      .select({ userId: tickets.userId, n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(
        and(
          eq(tickets.categoryId, categoryId),
          eq(tickets.state, 'open'),
          inArray(tickets.userId, userIds),
          isNull(tickets.deletedAt),
          isNull(tickets.mergedIntoId),
        ),
      )
      .groupBy(tickets.userId);
    const rightsCache = new Map<string, TicketRights>();
    const out: DistributionCandidate[] = [];
    for (const u of people) {
      if (!u.rightsProfileId) continue;
      let rights = rightsCache.get(u.rightsProfileId);
      if (!rights) {
        rights = await this.permissions.loadTicketRights(u.rightsProfileId, tx);
        rightsCache.set(u.rightsProfileId, rights);
      }
      const link = rights.categories === 'all' ? null : rights.categories.find((c) => c.categoryId === categoryId);
      const inRights = queues.filter((q) => canUseMailbox(rights!, q));
      out.push({
        userId: u.id,
        active: u.isActive,
        categoryAccess: rights.categories === 'all' || !!link?.access,
        // "All categories" means no distribution limit (Q-P2-5), so no auto-distribution.
        distribute: !!link?.distribute,
        limit: link?.distributionLimit ?? null,
        queueInRights: inRights.length > 0,
        loggedIn: logins.some((l) => l.userId === u.id && inRights.includes(l.queueId)),
        openCount: counts.find((c) => c.userId === u.id)?.n ?? 0,
        lastAssignedAt: u.lastDistributedAt,
      });
    }
    return out;
  }

  // ----- "Ready for email"

  async myQueues(auth: AuthContext) {
    const boxes = await this.db
      .select({
        id: mailboxQueues.id,
        title: mailboxQueues.title,
        address: mailboxQueues.address,
        defaultCategoryId: mailboxQueues.defaultCategoryId,
      })
      .from(mailboxQueues)
      .where(isNull(mailboxQueues.deletedAt))
      .orderBy(asc(mailboxQueues.title));
    const mine = await this.db.select().from(queueLogins).where(eq(queueLogins.userId, auth.user.id));
    return boxes
      .filter((b) => canUseMailbox(auth.ticketRights, b.id))
      .map((b) => ({ ...b, ready: mine.some((m) => m.queueId === b.id) }));
  }

  /** Logs the user in to exactly these queues (those in their rights), then distributes. */
  async setReady(auth: AuthContext, queueIds: string[]) {
    const boxes = await this.myQueues(auth);
    const allowed = boxes.filter((b) => queueIds.includes(b.id));
    await this.db.transaction(async (tx) => {
      await tx.delete(queueLogins).where(eq(queueLogins.userId, auth.user.id));
      if (allowed.length)
        await tx.insert(queueLogins).values(allowed.map((b) => ({ userId: auth.user.id, queueId: b.id })));
    });
    await this.run(allowed.map((b) => b.defaultCategoryId));
    return this.myQueues(auth);
  }

  async logoutAll(userId: string) {
    await this.db.delete(queueLogins).where(eq(queueLogins.userId, userId));
  }
}
