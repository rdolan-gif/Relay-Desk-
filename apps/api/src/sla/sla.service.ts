import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import {
  chooseSla,
  computeSla,
  slaIndicator,
  slaTargets,
  type SlaDefinition,
  type SlaIndicator,
  type TimeGroup,
} from '@relay-desk/domain';
import { DB, type Db, type DbOrTx } from '../db/db';
import { accounts, categories, contacts, slaDefinitions, tickets, timeGroups } from '../db/schema';

type Ticket = typeof tickets.$inferSelect;

/** Public SLA facts for a ticket (list rows and the ticket header). */
export interface TicketSla {
  firstAnswerDeadline: string | null;
  firstAnswerAt: string | null;
  firstAnswerMet: boolean | null;
  solutionMet: boolean | null;
  deadlineManual: boolean;
  indicator: (Omit<SlaIndicator, 'due'> & { due: string }) | null;
}

/**
 * Keeps each ticket's SLA columns in step with the domain rules (spec 8). `refresh` is
 * idempotent and runs in the same transaction as any change that can move a deadline:
 * priority, category, contact/account, state, the enquiry type, or the first reply.
 */
@Injectable()
export class SlaService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async loadSla(tx: DbOrTx, id: string | null): Promise<SlaDefinition | null> {
    if (!id) return null;
    const [r] = await tx
      .select()
      .from(slaDefinitions)
      .where(and(eq(slaDefinitions.id, id), isNull(slaDefinitions.deletedAt)));
    return r ? { unit: r.unit, basisFieldId: r.basisFieldId, targets: r.targets } : null;
  }

  async loadTimeGroup(tx: DbOrTx, id: string | null): Promise<TimeGroup | null> {
    if (!id) return null;
    const [r] = await tx
      .select()
      .from(timeGroups)
      .where(and(eq(timeGroups.id, id), isNull(timeGroups.deletedAt)));
    return r ? { timezone: r.timezone, week: r.week, exceptions: r.exceptions } : null;
  }

  /** The account SLA (a branch without one uses its company's), else null. */
  private async accountSlaId(tx: DbOrTx, contactId: string | null): Promise<string | null> {
    if (!contactId) return null;
    const [c] = await tx.select({ accountId: contacts.accountId }).from(contacts).where(eq(contacts.id, contactId));
    if (!c?.accountId) return null;
    const [a] = await tx
      .select({ slaId: accounts.slaId, parentId: accounts.parentId })
      .from(accounts)
      .where(and(eq(accounts.id, c.accountId), isNull(accounts.deletedAt)));
    if (!a) return null;
    if (a.slaId || !a.parentId) return a.slaId;
    const [p] = await tx
      .select({ slaId: accounts.slaId })
      .from(accounts)
      .where(and(eq(accounts.id, a.parentId), isNull(accounts.deletedAt)));
    return p?.slaId ?? null;
  }

  async refresh(tx: DbOrTx, ids: number[], now = new Date()): Promise<void> {
    for (const id of [...new Set(ids)]) {
      const [t] = await tx.select().from(tickets).where(eq(tickets.id, id));
      if (!t || t.deletedAt) continue;
      const [cat] = await tx
        .select({ slaId: categories.slaId, timeGroupId: categories.timeGroupId })
        .from(categories)
        .where(eq(categories.id, t.categoryId));
      const sla = chooseSla(
        await this.loadSla(tx, await this.accountSlaId(tx, t.contactId)),
        await this.loadSla(tx, cat?.slaId ?? null),
      );
      const tg = await this.loadTimeGroup(tx, cat?.timeGroupId ?? null);
      const r = computeSla(
        {
          createdAt: t.createdAt,
          state: t.state,
          firstAnswerAt: t.firstAnswerAt,
          closedAt: t.closedAt,
          waitingSince: t.waitingSince,
          pausedSeconds: t.slaPausedSeconds,
          deadlineManual: t.deadlineManual,
          deadline: t.deadline,
          noReplyNeeded: t.noReplyNeeded,
          firstAnswerMet: t.firstAnswerMet,
          solutionMet: t.solutionMet,
        },
        sla ? slaTargets(sla, { priority: t.priority, customFields: t.customFields }) : null,
        tg,
        now,
      );
      const next = {
        firstAnswerDeadline: r.firstAnswerDeadline,
        deadline: r.deadline,
        waitingSince: r.waitingSince,
        slaPausedSeconds: r.pausedSeconds,
        firstAnswerMet: r.firstAnswerMet,
        solutionMet: r.solutionMet,
      };
      const same = (Object.keys(next) as (keyof typeof next)[]).every((k) => {
        const a = next[k];
        const b = t[k];
        return a instanceof Date || b instanceof Date ? a?.valueOf() === b?.valueOf() : a === b;
      });
      if (!same) await tx.update(tickets).set(next).where(eq(tickets.id, id));
    }
  }

  /** Every non-merged ticket in these categories (after their SLA or working hours change). */
  async refreshCategory(categoryId: string) {
    const rows = await this.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.categoryId, categoryId), isNull(tickets.deletedAt), isNull(tickets.mergedIntoId)));
    await this.db.transaction((tx) =>
      this.refresh(
        tx,
        rows.map((r) => r.id),
      ),
    );
  }

  /** Tickets of contacts in this account or its branches (after the account SLA changes). */
  async refreshAccount(accountId: string) {
    const rows = await this.db
      .select({ id: tickets.id })
      .from(tickets)
      .innerJoin(contacts, eq(contacts.id, tickets.contactId))
      .leftJoin(accounts, eq(accounts.id, contacts.accountId))
      .where(and(isNull(tickets.deletedAt), or(eq(contacts.accountId, accountId), eq(accounts.parentId, accountId))));
    await this.db.transaction((tx) =>
      this.refresh(
        tx,
        rows.map((r) => r.id),
      ),
    );
  }

  /** Tickets of one contact (after the contact moves to another account). */
  async refreshContact(contactId: string) {
    const rows = await this.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.contactId, contactId), isNull(tickets.deletedAt)));
    await this.db.transaction((tx) =>
      this.refresh(
        tx,
        rows.map((r) => r.id),
      ),
    );
  }

  /** Refreshes tickets after a category's time group or SLA definition changes. */
  async refreshUsing(by: { slaId?: string; timeGroupId?: string }) {
    const cats = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(by.slaId ? eq(categories.slaId, by.slaId) : eq(categories.timeGroupId, by.timeGroupId!));
    for (const c of cats) await this.refreshCategory(c.id);
    if (by.slaId) {
      const accs = await this.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.slaId, by.slaId));
      for (const a of accs) await this.refreshAccount(a.id);
    }
  }

  /**
   * The minute job: decide outcomes whose deadline has passed (first answer missed, an Open
   * ticket past its deadline) and catch any state change that skipped `refresh`.
   */
  async decideDue(now = new Date()): Promise<number> {
    const rows = await this.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          isNull(tickets.deletedAt),
          or(
            and(
              isNull(tickets.firstAnswerMet),
              isNull(tickets.firstAnswerAt),
              eq(tickets.noReplyNeeded, false),
              sql`${tickets.firstAnswerDeadline} < ${now}`,
              inArray(tickets.state, ['open', 'waiting']),
            ),
            and(isNull(tickets.solutionMet), eq(tickets.state, 'open'), sql`${tickets.deadline} < ${now}`),
            and(eq(tickets.state, 'waiting'), isNull(tickets.waitingSince)),
            and(
              isNull(tickets.solutionMet),
              inArray(tickets.state, ['closed', 'archived']),
              isNotNull(tickets.deadline),
            ),
            and(
              isNull(tickets.firstAnswerMet),
              isNotNull(tickets.firstAnswerAt),
              isNotNull(tickets.firstAnswerDeadline),
            ),
            and(ne(tickets.state, 'waiting'), isNotNull(tickets.waitingSince)),
          ),
        ),
      )
      .limit(500);
    if (rows.length)
      await this.db.transaction((tx) =>
        this.refresh(
          tx,
          rows.map((r) => r.id),
          now,
        ),
      );
    return rows.length;
  }

  /** SLA facts and icon for tickets (time groups cached per call). */
  async describe(rows: Ticket[], now = new Date()): Promise<Map<number, TicketSla>> {
    const out = new Map<number, TicketSla>();
    if (!rows.length) return out;
    const catIds = [...new Set(rows.map((r) => r.categoryId))];
    const cats = await this.db
      .select({ id: categories.id, timeGroupId: categories.timeGroupId })
      .from(categories)
      .where(inArray(categories.id, catIds));
    const groups = new Map<string, TimeGroup | null>();
    for (const c of cats) groups.set(c.id, await this.loadTimeGroup(this.db, c.timeGroupId));
    for (const t of rows) {
      const ind = slaIndicator(t, groups.get(t.categoryId) ?? null, now);
      out.set(t.id, {
        firstAnswerDeadline: t.firstAnswerDeadline?.toISOString() ?? null,
        firstAnswerAt: t.firstAnswerAt?.toISOString() ?? null,
        firstAnswerMet: t.firstAnswerMet,
        solutionMet: t.solutionMet,
        deadlineManual: t.deadlineManual,
        indicator: ind ? { ...ind, due: ind.due.toISOString() } : null,
      });
    }
    return out;
  }
}
