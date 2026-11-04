import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  applySaveRules,
  archivedEditViolations,
  automaticState,
  canCreateInCategory,
  canDeleteTicket,
  canSeeCategory,
  canSeeCrmDatabase,
  canSeeUser,
  diffFields,
  flattenForHistory,
  isResolved,
  layoutPlacements,
  validateFieldValue,
  resolveState,
  visibleCategoryIds,
  wouldCreateCycle,
  type CustomValues,
  type FilterCondition,
  type Priority,
  type SaveSource,
  type TicketFields,
  type TicketState,
} from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { applyCustomInput, filterSql, likeTerm, pageOf, scopeSql, type ListQuery } from '../crm/crm-common';
import { CustomFieldsService } from '../crm/custom-fields.service';
import { formError } from '../crm/form-errors';
import { DB, type Db, type DbOrTx } from '../db/db';
import {
  activities,
  categories,
  contacts,
  crmRecords,
  ticketFavourites,
  ticketFollowers,
  ticketMerges,
  tickets,
  users,
} from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { DistributionService } from '../sla/distribution.service';
import { SlaService } from '../sla/sla.service';
import { HistoryService } from '../history/history.service';
import { AccountsService } from '../crm/accounts.service';
import { sanitizeRich } from './sanitize';
import { TICKET_COLUMNS, ticketFilterFields } from './ticket-filters';
import { TicketSettingsService } from './ticket-settings.service';

export interface TicketInput {
  title?: string;
  description?: string;
  categoryId?: string;
  state?: TicketState;
  priority?: Priority;
  userId?: string | null;
  contactId?: string | null;
  statusIds?: string[];
  parentId?: number | null;
  deadline?: string | null;
  reopenAt?: string | null;
  followerIds?: string[];
  customFields?: Record<string, unknown>;
  /** Optimistic locking: the version the client edited (spec 13). */
  version?: number;
}

type Row = typeof tickets.$inferSelect;

const SORTS: Record<string, SQL> = {
  id: sql`${tickets.id}`,
  title: sql`lower(${tickets.title})`,
  createdAt: sql`${tickets.createdAt}`,
  lastActivityAt: sql`${tickets.lastActivityAt}`,
  deadline: sql`${tickets.deadline}`,
  priority: sql`array_position(array['low','normal','high'], ${tickets.priority})`,
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function ticketFlat(t: Row, followerIds: string[]) {
  return flattenForHistory(
    {
      title: t.title,
      description: t.description,
      categoryId: t.categoryId,
      state: t.state,
      priority: t.priority,
      userId: t.userId,
      contactId: t.contactId,
      statusIds: [...t.statusIds].sort(),
      parentId: t.parentId,
      deadline: iso(t.deadline),
      reopenAt: iso(t.reopenAt),
      followerIds: [...followerIds].sort(),
    },
    t.customFields,
  );
}

const fields = (t: Row): TicketFields => ({
  title: t.title,
  categoryId: t.categoryId,
  state: t.state,
  priority: t.priority,
  userId: t.userId,
  contactId: t.contactId,
  statusIds: t.statusIds,
  reopenAt: t.reopenAt,
  parentId: t.parentId === null ? null : String(t.parentId),
});

@Injectable()
export class TicketsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(CustomFieldsService) private readonly fieldsService: CustomFieldsService,
    @Inject(TicketSettingsService) private readonly settings: TicketSettingsService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(SlaService) private readonly sla: SlaService,
    @Inject(DistributionService) private readonly distribution: DistributionService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ reading

  /**
   * Only tickets in categories where the caller has Access = Yes (spec 4). Merged-away
   * tickets are part of their survivor (owner Q4) and never appear on their own.
   */
  categoryScope(auth: AuthContext): SQL | undefined {
    const ids = visibleCategoryIds(auth.ticketRights);
    return and(
      isNull(tickets.mergedIntoId),
      scopeSql(tickets.categoryId, ids === 'all' ? { all: true } : { all: false, ids }),
    );
  }

  async list(auth: AuthContext, q: ListQuery, extraConditions: FilterCondition[] = [], extraSql: SQL[] = []) {
    const fieldMap = await this.fieldsService.map();
    const defs = ticketFilterFields(fieldMap.values());
    const where: (SQL | undefined)[] = [isNull(tickets.deletedAt), this.categoryScope(auth), ...extraSql];
    if (q.q) where.push(this.searchSql(q.q));
    const own = q.filter ? (JSON.parse(q.filter) as FilterCondition[]) : [];
    const all = [...extraConditions, ...(Array.isArray(own) ? own : [])].map((c) =>
      c.value === '@me' ? { ...c, value: auth.user.id } : c,
    );
    where.push(
      ...filterSql(all.length ? JSON.stringify(all) : undefined, defs, TICKET_COLUMNS, sql`${tickets.customFields}`),
    );
    const cond = and(...where);
    const sortCol = SORTS[q.sort ?? 'id'] ?? SORTS.id!;
    const rows = await this.db
      .select({
        ticket: tickets,
        categoryTitle: categories.title,
        userName: users.name,
        contactName: contacts.name,
        contactDatabaseId: contacts.databaseId,
      })
      .from(tickets)
      .innerJoin(categories, eq(categories.id, tickets.categoryId))
      .leftJoin(users, eq(users.id, tickets.userId))
      .leftJoin(contacts, eq(contacts.id, tickets.contactId))
      .where(cond)
      .orderBy(q.dir === 'asc' ? asc(sortCol) : desc(sortCol), desc(tickets.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [{ total }] = (await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(tickets)
      .where(cond)) as [{ total: number }];
    const slas = await this.sla.describe(rows.map((r) => r.ticket));
    return pageOf(
      rows.map((r) => ({
        ...publicTicket(r.ticket),
        sla: slas.get(r.ticket.id) ?? null,
        categoryTitle: r.categoryTitle,
        userName: r.userName,
        contactName: r.contactDatabaseId && canSeeCrmDatabase(auth.rights, r.contactDatabaseId) ? r.contactName : null,
      })),
      total,
      q,
    );
  }

  /**
   * Creates a ticket for the email channel (inbound mail, or a new outbound email). Never
   * refuses because of form rules: invalid routing values are dropped instead, so no
   * email is lost (spec 2, goal 1). `auth` is null for mail arriving from a mailbox.
   */
  async createSystemTicket(
    tx: DbOrTx,
    auth: AuthContext | null,
    f: {
      title: string;
      categoryId: string;
      state: TicketState;
      priority: Priority;
      userId: string | null;
      contactId: string | null;
      statusIds: string[];
      customFields: Record<string, unknown>;
      /** Arrived through a mailbox queue: may be handed out by distribution (spec 9). */
      distributable?: boolean;
    },
  ): Promise<number> {
    const [cat] = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.id, f.categoryId), isNull(categories.deletedAt)));
    if (!cat) throw new NotFoundException({ message: 'Unknown category.', reason: 'unknown_category' });
    const allowed = await this.settings.allowedStatusIds(cat.id);
    const statusIds = f.statusIds.filter((s) => allowed.includes(s)).slice(0, cat.multipleStatuses ? 20 : 1);
    let userId = f.userId;
    if (userId) {
      const [u] = await tx.select().from(users).where(eq(users.id, userId));
      if (!u || !u.isActive || u.type === 'external') userId = null;
    }
    // Custom values: defaults for the category form, then routing values that are on it and valid.
    const fieldMap = await this.fieldsService.map();
    const custom: Record<string, unknown> = {};
    for (const p of layoutPlacements(cat.formLayout)) {
      const def = fieldMap.get(p.fieldId);
      if (!def) continue;
      const raw = f.customFields[p.fieldId] ?? f.customFields[def.key] ?? def.defaultValue;
      if (raw === undefined || raw === null) continue;
      const r = validateFieldValue(def, raw);
      if (r.ok && r.value !== null) custom[p.fieldId] = r.value;
    }
    const [row] = await tx
      .insert(tickets)
      .values({
        title: f.title.trim().slice(0, 500) || '(no subject)',
        categoryId: cat.id,
        state: f.state,
        priority: f.priority,
        userId,
        contactId: f.contactId,
        statusIds,
        closedAt: isResolved(f.state) ? new Date() : null,
        customFields: custom,
        createdById: auth?.user.id ?? null,
        distributable: !!f.distributable,
      })
      .returning();
    await this.history.record(tx, auth, 'ticket', row!.id, 'create', diffFields({}, ticketFlat(row!, [])));
    await this.sla.refresh(tx, [row!.id]);
    return row!.id;
  }

  /** Tickets whose contact belongs to one of these accounts (a branch, or a company and its branches). */
  listForAccounts(auth: AuthContext, accountIds: string[], q: ListQuery) {
    const contactIds = this.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(inArray(contacts.accountId, accountIds), isNull(contacts.deletedAt)));
    return this.list(auth, q, [], [inArray(tickets.contactId, contactIds)]);
  }

  /** Title, description, comment text, or the ticket number ("123" or "#123"). */
  searchSql(term: string): SQL {
    const like = likeTerm(term);
    const parts: SQL[] = [
      sql`${tickets.title} ilike ${like}`,
      sql`${tickets.description} ilike ${like}`,
      sql`exists (select 1 from activities a where a.ticket_id = ${tickets.id} and a.deleted_at is null and a.body_html ilike ${like})`,
    ];
    const num = term.replace(/^#/, '');
    if (/^\d{1,9}$/.test(num)) parts.push(sql`${tickets.id} = ${Number(num)}`);
    return or(...parts)!;
  }

  /** The ticket if visible to the caller, else 404. */
  async find(auth: AuthContext, id: number, tx: DbOrTx = this.db): Promise<Row> {
    const [row] = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)));
    if (!row || !canSeeCategory(auth.ticketRights, row.categoryId)) throw new NotFoundException();
    if (row.mergedIntoId !== null) {
      throw new NotFoundException({
        message: `This ticket was merged into #${row.mergedIntoId}.`,
        reason: 'merged',
        mergedIntoId: row.mergedIntoId,
      });
    }
    return row;
  }

  /** Archived tickets are read-only; only un-archiving is allowed (owner Q9). */
  assertNotArchived(t: Row) {
    if (t.state === 'archived') {
      throw new ConflictException({
        message: 'Archived tickets are read-only. Un-archive the ticket to change it.',
        reason: 'archived_read_only',
      });
    }
  }

  async get(auth: AuthContext, id: number) {
    const t = await this.find(auth, id);
    const category = await this.settings.getCategory(auth, t.categoryId);
    const followerRows = await this.db
      .select({ id: users.id, name: users.name })
      .from(ticketFollowers)
      .innerJoin(users, eq(users.id, ticketFollowers.userId))
      .where(eq(ticketFollowers.ticketId, id));
    const [fav] = await this.db
      .select()
      .from(ticketFavourites)
      .where(and(eq(ticketFavourites.ticketId, id), eq(ticketFavourites.userId, auth.user.id)));
    const [owner] = t.userId
      ? await this.db
          .select({ id: users.id, name: users.name, isActive: users.isActive })
          .from(users)
          .where(eq(users.id, t.userId))
      : [];
    const children = await this.db
      .select({ id: tickets.id, title: tickets.title, state: tickets.state, categoryId: tickets.categoryId })
      .from(tickets)
      .where(and(eq(tickets.parentId, id), isNull(tickets.deletedAt), isNull(tickets.mergedIntoId)))
      .orderBy(asc(tickets.id));
    const parent = t.parentId
      ? await this.db
          .select({ id: tickets.id, title: tickets.title, categoryId: tickets.categoryId })
          .from(tickets)
          .where(eq(tickets.id, t.parentId))
      : [];
    return {
      ...publicTicket(t),
      category: {
        id: category.id,
        title: category.title,
        allowExternalComments: category.allowExternalComments,
        autofocusTab: category.autofocusTab,
      },
      user: owner ?? null,
      followers: followerRows,
      isFavourite: !!fav,
      parent:
        parent[0] && canSeeCategory(auth.ticketRights, parent[0].categoryId)
          ? { id: parent[0].id, title: parent[0].title }
          : null,
      children: children
        .filter((c) => canSeeCategory(auth.ticketRights, c.categoryId))
        .map(({ categoryId: _c, ...c }) => c),
      contactCard: await this.contactCard(auth, t),
      merges: await this.activeMerges(id),
      sla: (await this.sla.describe([t])).get(t.id) ?? null,
    };
  }

  /** Compact contact card (spec 12.5): name, account, counts and other open tickets. */
  private async contactCard(auth: AuthContext, t: Row) {
    if (!t.contactId) return null;
    const [c] = await this.db.select().from(contacts).where(eq(contacts.id, t.contactId));
    if (!c || !canSeeCrmDatabase(auth.rights, c.databaseId)) return null;
    // Branch path, contact details and delivery addresses (owner Q2).
    const account = c.accountId ? await this.accounts.cardSummary(c.accountId) : null;
    const other = await this.db
      .select({ id: tickets.id, title: tickets.title, state: tickets.state })
      .from(tickets)
      .where(
        and(
          eq(tickets.contactId, c.id),
          ne(tickets.id, t.id),
          inArray(tickets.state, ['open', 'waiting']),
          isNull(tickets.deletedAt),
          this.categoryScope(auth),
        ),
      )
      .orderBy(desc(tickets.id))
      .limit(10);
    const [records] = (await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(crmRecords)
      .where(and(eq(crmRecords.contactId, c.id), eq(crmRecords.stage, 'open'), isNull(crmRecords.deletedAt)))) as [
      { n: number },
    ];
    return {
      id: c.id,
      name: c.name,
      emails: c.emails,
      phones: c.phones,
      account: account ?? null,
      otherOpenTickets: other,
      openRecordCount: records.n,
    };
  }

  async historyOf(auth: AuthContext, id: number) {
    await this.find(auth, id);
    return this.history.list('ticket', id);
  }

  async snapshot(auth: AuthContext, id: number, at: Date) {
    const t = await this.find(auth, id);
    const snap = await this.history.snapshot('ticket', String(id), ticketFlat(t, await this.followerIds(id)), at);
    if (!snap)
      throw new NotFoundException({ message: 'The ticket did not exist at that time.', reason: 'not_yet_created' });
    return { at: at.toISOString(), ...snap.core, customFields: snap.custom };
  }

  async followerIds(ticketId: number, tx: DbOrTx = this.db): Promise<string[]> {
    return (
      await tx
        .select({ id: ticketFollowers.userId })
        .from(ticketFollowers)
        .where(eq(ticketFollowers.ticketId, ticketId))
    ).map((r) => r.id);
  }

  // ------------------------------------------------------------------ writing

  /**
   * Creates a ticket. The caller needs the category in their rights; with Access = No
   * the ticket is created but `visible` is false and it cannot be opened (spec 4).
   */
  async create(
    auth: AuthContext,
    input: TicketInput & { title: string; categoryId: string },
    source: SaveSource = 'form',
  ) {
    if (!canCreateInCategory(auth.ticketRights, input.categoryId)) {
      throw new NotFoundException({ message: 'Unknown category.', reason: 'unknown_category' });
    }
    const category = await this.settings.findCategory(input.categoryId);
    const after: TicketFields = {
      title: input.title,
      categoryId: input.categoryId,
      state: input.state ?? 'open',
      priority: input.priority ?? 'normal',
      userId: input.userId ?? null,
      contactId: input.contactId ?? null,
      statusIds: input.statusIds ?? [],
      reopenAt: input.reopenAt ? new Date(input.reopenAt) : null,
      parentId: input.parentId ? String(input.parentId) : null,
    };
    const result = applySaveRules(
      null,
      after,
      { ...category, allowedStatusIds: await this.settings.allowedStatusIds(category.id) },
      {
        source,
        actorId: auth.user.id,
        ownerDeactivated: false,
        childStates: [],
        userSetExplicitly: input.userId !== undefined,
        now: new Date(),
      },
    );
    if (!result.ok)
      throw formError(result.errors.map((e) => ({ fieldId: e.field, code: e.code, message: e.message })) as never);
    const t = result.ticket;
    await this.checkRefs(auth, t, null);
    if (t.parentId) await this.find(auth, Number(t.parentId));
    const customFields = await applyCustomInput({
      db: this.db,
      auth,
      layout: category.formLayout,
      fields: await this.fieldsService.map(),
      current: {},
      input: input.customFields,
      isCreate: true,
    });
    const followers = await this.validFollowers(auth, input.followerIds ?? []);
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(tickets)
        .values({
          title: t.title.trim(),
          description: sanitizeRich(input.description ?? ''),
          categoryId: t.categoryId,
          state: t.state,
          priority: t.priority,
          userId: t.userId,
          contactId: t.contactId,
          statusIds: t.statusIds,
          parentId: t.parentId ? Number(t.parentId) : null,
          deadline: input.deadline ? new Date(input.deadline) : null,
          deadlineManual: !!input.deadline,
          reopenAt: t.reopenAt,
          closedAt: isResolved(t.state) ? new Date() : null,
          customFields,
          createdById: auth.user.id,
        })
        .returning();
      if (followers.length)
        await tx.insert(ticketFollowers).values(followers.map((userId) => ({ ticketId: row!.id, userId })));
      await this.history.record(tx, auth, 'ticket', row!.id, 'create', diffFields({}, ticketFlat(row!, followers)));
      await this.sla.refresh(tx, [row!.id]);
      return row!.id;
    });
    await this.notifications.ticketEvent(id, { type: 'created', actorId: auth.user.id });
    const visible = canSeeCategory(auth.ticketRights, t.categoryId);
    return visible ? { ...(await this.get(auth, id)), visible } : { id, visible };
  }

  /**
   * Saves changes through the domain save rules. `source` decides which automatic rules
   * apply (e.g. auto-fill User on close only from the form). A manual state wins over
   * automation; version mismatch → 409 (optimistic locking).
   */
  async update(auth: AuthContext, id: number, input: TicketInput, source: SaveSource = 'form') {
    const before = await this.find(auth, id);
    if (input.version !== undefined && input.version !== before.version) {
      throw new ConflictException({
        message: 'Someone else saved this ticket. Reload to see their changes.',
        reason: 'version_conflict',
        current: publicTicket(before),
      });
    }
    if (before.state === 'archived') {
      const current: Record<string, unknown> = {
        ...publicTicket(before),
        followerIds: (await this.followerIds(id)).sort(),
      };
      const changed = Object.entries(input)
        .filter(([k, v]) => k !== 'version' && v !== undefined)
        .filter(([k, v]) => {
          const cur = current[k];
          const norm = (x: unknown) => (x instanceof Date ? x.toISOString() : Array.isArray(x) ? [...x].sort() : x);
          return JSON.stringify(norm(v)) !== JSON.stringify(norm(cur));
        })
        .map(([k]) => k);
      const violations = archivedEditViolations(before.state, changed, input.state);
      if (violations.length) {
        throw new ConflictException({
          message: 'Archived tickets are read-only. Un-archive the ticket to change it.',
          reason: 'archived_read_only',
          fields: violations,
        });
      }
    }
    const categoryId = input.categoryId ?? before.categoryId;
    if (categoryId !== before.categoryId && !canCreateInCategory(auth.ticketRights, categoryId)) {
      throw new NotFoundException({ message: 'Unknown category.', reason: 'unknown_category' });
    }
    const category = await this.settings.findCategory(categoryId);
    const [owner] = before.userId
      ? await this.db.select({ isActive: users.isActive }).from(users).where(eq(users.id, before.userId))
      : [];
    const childStates = (
      await this.db
        .select({ state: tickets.state })
        .from(tickets)
        .where(and(eq(tickets.parentId, id), isNull(tickets.deletedAt)))
    ).map((r) => r.state);

    const after: TicketFields = {
      title: input.title ?? before.title,
      categoryId,
      state: input.state ?? before.state,
      priority: input.priority ?? before.priority,
      userId: input.userId !== undefined ? input.userId : before.userId,
      contactId: input.contactId !== undefined ? input.contactId : before.contactId,
      statusIds: input.statusIds ?? before.statusIds,
      reopenAt: input.reopenAt !== undefined ? (input.reopenAt ? new Date(input.reopenAt) : null) : before.reopenAt,
      parentId:
        input.parentId !== undefined
          ? input.parentId === null
            ? null
            : String(input.parentId)
          : before.parentId === null
            ? null
            : String(before.parentId),
    };
    const result = applySaveRules(
      fields(before),
      after,
      { ...category, allowedStatusIds: await this.settings.allowedStatusIds(category.id) },
      {
        source,
        actorId: auth.user.id,
        ownerDeactivated: owner ? !owner.isActive : false,
        childStates,
        userSetExplicitly: input.userId !== undefined && input.userId !== before.userId,
        now: new Date(),
      },
    );
    if (!result.ok)
      throw formError(result.errors.map((e) => ({ fieldId: e.field, code: e.code, message: e.message })) as never);
    const t = result.ticket;
    await this.checkRefs(auth, t, before);
    if (t.parentId !== (before.parentId === null ? null : String(before.parentId)))
      await this.checkParent(auth, id, t.parentId);
    const customFields = await applyCustomInput({
      db: this.db,
      auth,
      layout: category.formLayout,
      fields: await this.fieldsService.map(),
      current: before.customFields as CustomValues,
      input: input.customFields,
      isCreate: false,
    });
    const beforeFollowers = await this.followerIds(id);
    const followers = input.followerIds ? await this.validFollowers(auth, input.followerIds) : beforeFollowers;
    // Only a deadline the person actually changed becomes manual (spec 8); clearing it hands
    // the deadline back to the SLA.
    const newDeadline =
      input.deadline !== undefined ? (input.deadline ? new Date(input.deadline) : null) : before.deadline;
    const deadlineChanged = (newDeadline?.getTime() ?? null) !== (before.deadline?.getTime() ?? null);
    const deadlineManual = deadlineChanged ? newDeadline !== null : before.deadlineManual;

    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(tickets)
        .set({
          title: t.title.trim(),
          description: input.description !== undefined ? sanitizeRich(input.description) : before.description,
          categoryId: t.categoryId,
          state: t.state,
          priority: t.priority,
          userId: t.userId,
          contactId: t.contactId,
          statusIds: t.statusIds,
          parentId: t.parentId ? Number(t.parentId) : null,
          deadline: newDeadline,
          deadlineManual,
          reopenAt: t.reopenAt,
          closedAt: closedAtFor(before, t.state),
          customFields,
          version: before.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(tickets.id, id), eq(tickets.version, before.version)))
        .returning();
      if (!row)
        throw new ConflictException({
          message: 'Someone else saved this ticket. Reload to see their changes.',
          reason: 'version_conflict',
        });
      if (input.followerIds) await this.replaceFollowers(tx, id, followers);
      await this.history.record(
        tx,
        auth,
        'ticket',
        id,
        'update',
        diffFields(ticketFlat(before, beforeFollowers), ticketFlat(row, followers)),
      );
      await this.sla.refresh(tx, [id]);
    });
    // A slot may have freed up (spec 9: Waiting, Closed, Archived or reassigned).
    if (t.userId && t.userId !== before.userId)
      await this.notifications.ticketEvent(id, { type: 'assigned', actorId: auth.user.id });
    if (t.categoryId !== before.categoryId)
      await this.notifications.ticketEvent(id, { type: 'moved', actorId: auth.user.id });
    if (before.state !== t.state || before.userId !== t.userId || before.categoryId !== t.categoryId)
      await this.distribution.run([before.categoryId, t.categoryId]);
    return this.getOrHidden(auth, id);
  }

  /** After moving a ticket to a category without Access, the caller may no longer see it. */
  private async getOrHidden(auth: AuthContext, id: number) {
    const [row] = await this.db.select({ categoryId: tickets.categoryId }).from(tickets).where(eq(tickets.id, id));
    return row && canSeeCategory(auth.ticketRights, row.categoryId)
      ? { ...(await this.get(auth, id)), visible: true }
      : { id, visible: false };
  }

  /** Bulk edit (spec 14): per-ticket save with source 'bulk'; failures are reported, not fatal. */
  async bulkEdit(
    auth: AuthContext,
    ids: number[],
    changes: Omit<TicketInput, 'version' | 'customFields' | 'followerIds'>,
  ) {
    const updated: number[] = [];
    const failed: { id: number; message: string }[] = [];
    for (const id of ids) {
      try {
        await this.update(auth, id, changes, 'bulk');
        updated.push(id);
      } catch (err) {
        failed.push({
          id,
          message:
            err instanceof Error
              ? ((err as { response?: { message?: string } }).response?.message ?? err.message)
              : String(err),
        });
      }
    }
    return { updated, failed };
  }

  async remove(auth: AuthContext, id: number) {
    const t = await this.find(auth, id);
    const category = await this.settings.findCategory(t.categoryId);
    const childStates = (
      await this.db
        .select({ state: tickets.state })
        .from(tickets)
        .where(and(eq(tickets.parentId, id), isNull(tickets.deletedAt)))
    ).map((r) => r.state);
    if (!canDeleteTicket(category, childStates)) {
      throw new ConflictException({ message: 'Close or archive all child tickets first.', reason: 'open_children' });
    }
    await this.db.transaction(async (tx) => {
      await tx.update(tickets).set({ deletedAt: new Date() }).where(eq(tickets.id, id));
      await this.history.record(tx, auth, 'ticket', id, 'delete', []);
    });
  }

  async setFollowing(auth: AuthContext, id: number, follow: boolean) {
    await this.find(auth, id);
    await this.db.transaction(async (tx) => {
      const before = await this.followerIds(id, tx);
      if (follow) await tx.insert(ticketFollowers).values({ ticketId: id, userId: auth.user.id }).onConflictDoNothing();
      else
        await tx
          .delete(ticketFollowers)
          .where(and(eq(ticketFollowers.ticketId, id), eq(ticketFollowers.userId, auth.user.id)));
      const after = await this.followerIds(id, tx);
      await this.history.record(
        tx,
        auth,
        'ticket',
        id,
        'update',
        diffFields({ followerIds: before.sort() }, { followerIds: after.sort() }),
      );
    });
  }

  async setFavourite(auth: AuthContext, id: number, favourite: boolean) {
    await this.find(auth, id);
    if (favourite)
      await this.db.insert(ticketFavourites).values({ ticketId: id, userId: auth.user.id }).onConflictDoNothing();
    else
      await this.db
        .delete(ticketFavourites)
        .where(and(eq(ticketFavourites.ticketId, id), eq(ticketFavourites.userId, auth.user.id)));
  }

  /**
   * Merge (owner Q4): the tickets become one. Activities and followers move into the
   * survivor and the merged tickets disappear from lists and search; each merge is
   * recorded so it can be undone. Archived tickets are read-only and cannot be merged.
   */
  async merge(auth: AuthContext, ticketIds: number[], survivorId: number) {
    const ids = [...new Set(ticketIds)];
    if (ids.length < 2 || !ids.includes(survivorId)) {
      throw new BadRequestException({
        message: 'Choose at least two tickets and which one survives.',
        reason: 'invalid_merge',
      });
    }
    const rows = await Promise.all(ids.map((id) => this.find(auth, id)));
    rows.forEach((r) => this.assertNotArchived(r));
    const merged = rows.filter((r) => r.id !== survivorId);
    await this.db.transaction(async (tx) => {
      const survivorFollowers = await this.followerIds(survivorId, tx);
      for (const m of merged) {
        const acts = await tx
          .update(activities)
          .set({ ticketId: survivorId })
          .where(eq(activities.ticketId, m.id))
          .returning({ id: activities.id });
        const current = await this.followerIds(survivorId, tx);
        const added = (await this.followerIds(m.id, tx)).filter((u) => !current.includes(u));
        for (const userId of added) await tx.insert(ticketFollowers).values({ ticketId: survivorId, userId });
        await tx.insert(ticketMerges).values({
          survivorId,
          mergedId: m.id,
          activityIds: acts.map((a) => a.id),
          addedFollowerIds: added,
          createdById: auth.user.id,
        });
        await tx
          .update(tickets)
          .set({ mergedIntoId: survivorId, version: m.version + 1, updatedAt: new Date() })
          .where(eq(tickets.id, m.id));
        await this.history.record(tx, auth, 'ticket', m.id, 'merge', [
          { field: 'mergedIntoId', old: null, new: survivorId },
        ]);
      }
      const afterFollowers = await this.followerIds(survivorId, tx);
      await tx
        .update(tickets)
        .set({ lastActivityAt: new Date(), updatedAt: new Date() })
        .where(eq(tickets.id, survivorId));
      await this.history.record(tx, auth, 'ticket', survivorId, 'merge', [
        { field: 'mergedTicketIds', old: null, new: merged.map((m) => m.id) },
        ...diffFields({ followerIds: survivorFollowers.sort() }, { followerIds: afterFollowers.sort() }),
      ]);
      await this.sla.refresh(tx, [survivorId]);
    });
    return this.get(auth, survivorId);
  }

  /**
   * Undoes a merge made in error (owner Q4): the merged ticket comes back with the
   * activities and followers it brought, as they were.
   */
  async unmerge(auth: AuthContext, survivorId: number, mergeId: number) {
    const survivor = await this.find(auth, survivorId);
    this.assertNotArchived(survivor);
    const [m] = await this.db
      .select()
      .from(ticketMerges)
      .where(and(eq(ticketMerges.id, mergeId), eq(ticketMerges.survivorId, survivorId), isNull(ticketMerges.undoneAt)));
    if (!m) throw new NotFoundException({ message: 'Unknown merge.', reason: 'unknown_merge' });
    await this.db.transaction(async (tx) => {
      if (m.activityIds.length) {
        await tx
          .update(activities)
          .set({ ticketId: m.mergedId })
          .where(and(inArray(activities.id, m.activityIds), eq(activities.ticketId, survivorId)));
      }
      if (m.addedFollowerIds.length) {
        await tx
          .delete(ticketFollowers)
          .where(and(eq(ticketFollowers.ticketId, survivorId), inArray(ticketFollowers.userId, m.addedFollowerIds)));
      }
      const [restored] = await tx.select().from(tickets).where(eq(tickets.id, m.mergedId));
      await tx
        .update(tickets)
        .set({ mergedIntoId: null, version: restored!.version + 1, updatedAt: new Date() })
        .where(eq(tickets.id, m.mergedId));
      await tx
        .update(ticketMerges)
        .set({ undoneAt: new Date(), undoneById: auth.user.id })
        .where(eq(ticketMerges.id, m.id));
      await this.history.record(tx, auth, 'ticket', m.mergedId, 'merge', [
        { field: 'mergedIntoId', old: survivorId, new: null },
      ]);
      await this.history.record(tx, auth, 'ticket', survivorId, 'merge', [
        { field: 'unmergedTicketId', old: null, new: m.mergedId },
      ]);
      await this.sla.refresh(tx, [survivorId, m.mergedId]);
    });
    return this.get(auth, survivorId);
  }

  /**
   * "FYI – no reply needed" (owner O-12): closes the ticket and marks that no reply is
   * expected, so it never counts against the reply target. Adds an "FYI" status when the
   * category offers one.
   */
  async markFyi(auth: AuthContext, id: number) {
    const t = await this.find(auth, id);
    this.assertNotArchived(t);
    const allowed = await this.settings.allowedStatusIds(t.categoryId);
    const statuses = await this.settings.listStatuses();
    const fyi = statuses.find((s) => /^fyi\b/i.test(s.title) && allowed.includes(s.id));
    const category = await this.settings.findCategory(t.categoryId);
    const statusIds = fyi
      ? category.multipleStatuses
        ? [...new Set([...t.statusIds, fyi.id])]
        : [fyi.id]
      : t.statusIds;
    const result = await this.update(auth, id, { state: 'closed', statusIds }, 'form');
    await this.db.transaction(async (tx) => {
      await tx.update(tickets).set({ noReplyNeeded: true }).where(eq(tickets.id, id));
      await this.history.record(tx, auth, 'ticket', id, 'update', [{ field: 'noReplyNeeded', old: false, new: true }]);
      await this.sla.refresh(tx, [id]);
    });
    return 'sla' in result ? this.getOrHidden(auth, id) : result;
  }

  /** Recomputes SLA columns in the caller's transaction (e.g. after the first reply, spec 8). */
  refreshSla(tx: DbOrTx, ids: number[]) {
    return this.sla.refresh(tx, ids);
  }

  /** Runs distribution for a ticket's category (after it was created from a mailbox). */
  async distributeTicket(id: number) {
    const [t] = await this.db.select({ categoryId: tickets.categoryId }).from(tickets).where(eq(tickets.id, id));
    if (t) await this.distribution.run([t.categoryId]);
  }

  /** Merges into this ticket that can still be undone. */
  async activeMerges(id: number) {
    return this.db
      .select({
        id: ticketMerges.id,
        mergedId: ticketMerges.mergedId,
        title: tickets.title,
        createdAt: ticketMerges.createdAt,
      })
      .from(ticketMerges)
      .innerJoin(tickets, eq(tickets.id, ticketMerges.mergedId))
      .where(and(eq(ticketMerges.survivorId, id), isNull(ticketMerges.undoneAt)))
      .orderBy(asc(ticketMerges.id));
  }

  /** Child ticket from a ticket or one of its activities: copies the contact (spec 6.4). */
  async createChild(
    auth: AuthContext,
    parentId: number,
    input: { title: string; categoryId?: string; activityId?: string },
  ) {
    const parent = await this.find(auth, parentId);
    this.assertNotArchived(parent);
    let description = '';
    if (input.activityId) {
      const [act] = await this.db
        .select()
        .from(activities)
        .where(and(eq(activities.id, input.activityId), eq(activities.ticketId, parentId)));
      if (!act) throw new NotFoundException({ message: 'Unknown activity.', reason: 'unknown_activity' });
      description = act.bodyHtml;
    }
    const created = await this.create(auth, {
      title: input.title,
      categoryId: input.categoryId ?? parent.categoryId,
      contactId: parent.contactId,
      parentId,
      description,
    });
    if (input.activityId) {
      await this.db.update(tickets).set({ sourceActivityId: input.activityId }).where(eq(tickets.id, created.id));
    }
    return created;
  }

  /** Scheduled: Waiting/Closed tickets whose re-open time has passed become Open (spec 6.3). */
  async reopenDue(now = new Date()): Promise<number[]> {
    const due = await this.db
      .select()
      .from(tickets)
      .where(
        and(
          isNull(tickets.deletedAt),
          inArray(tickets.state, ['waiting', 'closed']),
          sql`${tickets.reopenAt} <= ${now}`,
        ),
      );
    const done: number[] = [];
    for (const t of due) {
      const next = automaticState({ state: t.state, userId: t.userId }, { type: 'reopen_time_reached' });
      if (!next) continue;
      await this.db.transaction(async (tx) => {
        await tx
          .update(tickets)
          .set({ state: next, reopenAt: null, closedAt: null, version: t.version + 1, updatedAt: now })
          .where(eq(tickets.id, t.id));
        await this.history.record(tx, null, 'ticket', t.id, 'update', [
          { field: 'state', old: t.state, new: next },
          { field: 'reopenAt', old: iso(t.reopenAt), new: null },
        ]);
        await this.sla.refresh(tx, [t.id], now);
      });
      done.push(t.id);
    }
    return done;
  }

  /** Scheduled: archive tickets Closed for the category's auto-archive days (spec 6.3). */
  async autoArchive(now = new Date()): Promise<number[]> {
    const due = await this.db
      .select({ id: tickets.id, version: tickets.version })
      .from(tickets)
      .innerJoin(categories, eq(categories.id, tickets.categoryId))
      .where(
        and(
          isNull(tickets.deletedAt),
          eq(tickets.state, 'closed'),
          sql`${categories.autoArchiveDays} is not null`,
          sql`${tickets.closedAt} <= ${now}::timestamptz - make_interval(days => ${categories.autoArchiveDays})`,
        ),
      );
    for (const t of due) {
      await this.db.transaction(async (tx) => {
        await tx
          .update(tickets)
          .set({ state: 'archived', version: t.version + 1, updatedAt: now })
          .where(eq(tickets.id, t.id));
        await this.history.record(tx, null, 'ticket', t.id, 'update', [
          { field: 'state', old: 'closed', new: 'archived' },
        ]);
        await this.sla.refresh(tx, [t.id], now);
      });
    }
    return due.map((t) => t.id);
  }

  /**
   * Applies an automatic state change from an event (comments now; emails etc. later)
   * inside the caller's transaction. A manual state in the same save wins (spec 6.3).
   */
  async applyAutomaticState(tx: DbOrTx, auth: AuthContext | null, t: Row, next: 'open' | null, manual?: TicketState) {
    const state = resolveState(t.state, manual, next);
    if (state === t.state) return t.state;
    await tx
      .update(tickets)
      .set({ state, closedAt: closedAtFor(t, state), version: t.version + 1, updatedAt: new Date() })
      .where(eq(tickets.id, t.id));
    await this.history.record(tx, auth, 'ticket', t.id, 'update', [{ field: 'state', old: t.state, new: state }]);
    await this.sla.refresh(tx, [t.id]);
    return state;
  }

  async addFollowers(tx: DbOrTx, ticketId: number, userIds: string[]) {
    for (const userId of userIds) await tx.insert(ticketFollowers).values({ ticketId, userId }).onConflictDoNothing();
  }

  // ------------------------------------------------------------------ helpers

  private async replaceFollowers(tx: DbOrTx, id: number, ids: string[]) {
    await tx.delete(ticketFollowers).where(eq(ticketFollowers.ticketId, id));
    if (ids.length) await tx.insert(ticketFollowers).values(ids.map((userId) => ({ ticketId: id, userId })));
  }

  /** Followers must be active internal users visible to the caller (never external users). */
  async validFollowers(auth: AuthContext, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const rows = await this.db
      .select()
      .from(users)
      .where(and(inArray(users.id, unique), isNull(users.deletedAt)));
    const ok = rows.filter((u) => u.isActive && u.type !== 'external' && canSeeUser(auth.rights, auth.user.id, u.id));
    if (ok.length !== unique.length) throw formError(['A follower is not a user you can see.']);
    return unique;
  }

  /** The User must be visible and active; the contact must be in a visible CRM database. */
  private async checkRefs(auth: AuthContext, t: TicketFields, before: Row | null) {
    if (t.userId && t.userId !== before?.userId) {
      const [u] = await this.db
        .select()
        .from(users)
        .where(and(eq(users.id, t.userId), isNull(users.deletedAt)));
      if (!u || !u.isActive || u.type === 'external' || !canSeeUser(auth.rights, auth.user.id, u.id)) {
        throw formError([{ fieldId: 'userId', code: 'invalid', message: 'Unknown user.' }] as never);
      }
    }
    if (t.contactId && t.contactId !== before?.contactId) {
      const [c] = await this.db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, t.contactId), isNull(contacts.deletedAt)));
      if (!c || !canSeeCrmDatabase(auth.rights, c.databaseId))
        throw formError([{ fieldId: 'contactId', code: 'invalid', message: 'Unknown contact.' }] as never);
    }
  }

  private async checkParent(auth: AuthContext, id: number, parentId: string | null) {
    if (!parentId) return;
    await this.find(auth, Number(parentId)).catch(() => {
      throw formError([{ fieldId: 'parentId', code: 'invalid', message: 'Unknown parent ticket.' }] as never);
    });
    const rows = await this.db.select({ id: tickets.id, parentId: tickets.parentId }).from(tickets);
    const parents = new Map(rows.map((r) => [String(r.id), r.parentId === null ? null : String(r.parentId)]));
    if (wouldCreateCycle(String(id), parentId, (x) => parents.get(x) ?? null)) {
      throw formError([
        { fieldId: 'parentId', code: 'cycle', message: 'A ticket cannot be its own parent or ancestor.' },
      ] as never);
    }
  }

  assertMoveAllowed(auth: AuthContext) {
    if (!auth.principal.access.flags.can_move_activities)
      throw new ForbiddenException({ message: 'Missing permission: can_move_activities.', reason: 'flag_not_granted' });
  }
}

/** closed_at is set when a ticket becomes Closed/Archived and cleared when it reopens. */
function closedAtFor(before: Row, state: TicketState): Date | null {
  if (isResolved(state)) return before.closedAt ?? new Date();
  return null;
}

export function publicTicket(t: Row) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    categoryId: t.categoryId,
    state: t.state,
    statusIds: t.statusIds,
    priority: t.priority,
    userId: t.userId,
    contactId: t.contactId,
    parentId: t.parentId,
    mergedIntoId: t.mergedIntoId,
    sourceActivityId: t.sourceActivityId,
    deadline: t.deadline,
    reopenAt: t.reopenAt,
    closedAt: t.closedAt,
    customFields: t.customFields,
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastActivityAt: t.lastActivityAt,
    firstAnswerAt: t.firstAnswerAt,
    noReplyNeeded: t.noReplyNeeded,
    firstAnswerDeadline: t.firstAnswerDeadline,
    deadlineManual: t.deadlineManual,
    firstAnswerMet: t.firstAnswerMet,
    solutionMet: t.solutionMet,
  };
}
