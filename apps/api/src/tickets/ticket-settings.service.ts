import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  canSeeCategory,
  canSeeTeamView,
  diffFields,
  validateConditions,
  validateLayout,
  type FilterCondition,
  type FormLayout,
  type StatusRequired,
} from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/request-context';
import { CustomFieldsService } from '../crm/custom-fields.service';
import { formError } from '../crm/form-errors';
import { DB, type Db } from '../db/db';
import { categories, categoryStatuses, crmDatabases, ticketStatuses, ticketViews, tickets } from '../db/schema';
import { ticketFilterFields } from './ticket-filters';

export interface StatusInput {
  title: string;
  color: string;
  description?: string;
}

export interface CategoryInput {
  title: string;
  groupName: string;
  statusRequired: StatusRequired;
  multipleStatuses: boolean;
  checkChildOnClose: boolean;
  autoArchiveDays: number | null;
  allowExternalComments: boolean;
  waitingRequiresReopen: boolean;
  defaultCrmDatabaseId: string | null;
  formLayout: FormLayout;
  autofocusTab: string;
  statusIds: string[];
}

export interface ViewInput {
  name: string;
  conditions: FilterCondition[];
  columns: string[] | null;
}

type CategoryRow = typeof categories.$inferSelect;

/** Statuses (spec 7.2), categories (spec 7.1) and team views (spec 6.1). */
@Injectable()
export class TicketSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
  ) {}

  // ----- statuses

  listStatuses() {
    return this.db
      .select()
      .from(ticketStatuses)
      .where(isNull(ticketStatuses.deletedAt))
      .orderBy(asc(ticketStatuses.title));
  }

  async createStatus(auth: AuthContext, input: StatusInput, ip: string | null) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(ticketStatuses)
        .values({ ...input, description: input.description ?? '' })
        .returning();
      await this.audit.record(
        {
          eventType: 'settings.created',
          actorUserId: auth.user.id,
          ip,
          targetType: 'ticket_status',
          targetId: row!.id,
          changes: diffFields({}, input as never),
        },
        tx,
      );
      return row!;
    });
  }

  async updateStatus(auth: AuthContext, id: string, input: StatusInput, ip: string | null) {
    const [before] = await this.db
      .select()
      .from(ticketStatuses)
      .where(and(eq(ticketStatuses.id, id), isNull(ticketStatuses.deletedAt)));
    if (!before) throw new NotFoundException();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(ticketStatuses)
        .set({ ...input, description: input.description ?? '', updatedAt: new Date() })
        .where(eq(ticketStatuses.id, id))
        .returning();
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'ticket_status',
          targetId: id,
          changes: diffFields(
            { title: before.title, color: before.color, description: before.description },
            { title: row!.title, color: row!.color, description: row!.description },
          ),
        },
        tx,
      );
      return row!;
    });
  }

  /** Soft delete: existing tickets keep the status (spec 7.2), pickers stop offering it. */
  async deleteStatus(auth: AuthContext, id: string, ip: string | null) {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(ticketStatuses)
        .set({ deletedAt: new Date() })
        .where(and(eq(ticketStatuses.id, id), isNull(ticketStatuses.deletedAt)))
        .returning();
      if (!rows.length) throw new NotFoundException();
      await tx.delete(categoryStatuses).where(eq(categoryStatuses.statusId, id));
      await this.audit.record(
        { eventType: 'settings.deleted', actorUserId: auth.user.id, ip, targetType: 'ticket_status', targetId: id },
        tx,
      );
    });
  }

  // ----- categories

  /** Categories the caller can create tickets in (all for admins with "all"). */
  async listCategories(auth: AuthContext, opts: { visibleOnly?: boolean } = {}) {
    const rows = await this.db
      .select()
      .from(categories)
      .where(isNull(categories.deletedAt))
      .orderBy(asc(categories.groupName), asc(categories.title));
    const links = await this.db.select().from(categoryStatuses);
    const r = auth.ticketRights;
    return rows
      .filter((c) =>
        opts.visibleOnly
          ? canSeeCategory(r, c.id)
          : r.categories === 'all' || r.categories.some((x) => x.categoryId === c.id),
      )
      .map((c) => ({ ...c, statusIds: links.filter((l) => l.categoryId === c.id).map((l) => l.statusId) }));
  }

  async getCategory(auth: AuthContext, id: string) {
    const row = await this.findCategory(id);
    const statusIds = (await this.db.select().from(categoryStatuses).where(eq(categoryStatuses.categoryId, id))).map(
      (l) => l.statusId,
    );
    return { ...row, statusIds };
  }

  async findCategory(id: string): Promise<CategoryRow> {
    const [row] = await this.db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)));
    if (!row) throw new NotFoundException({ message: 'Unknown category.', reason: 'unknown_category' });
    return row;
  }

  async allowedStatusIds(categoryId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: categoryStatuses.statusId })
      .from(categoryStatuses)
      .innerJoin(ticketStatuses, eq(ticketStatuses.id, categoryStatuses.statusId))
      .where(and(eq(categoryStatuses.categoryId, categoryId), isNull(ticketStatuses.deletedAt)));
    return rows.map((r) => r.id);
  }

  async createCategory(auth: AuthContext, input: CategoryInput, ip: string | null) {
    if (auth.ticketRights.categories !== 'all') {
      throw new ForbiddenException({
        message: 'Only users with all categories may create one.',
        reason: 'scope_required',
      });
    }
    await this.checkCategory(input);
    const { statusIds, ...values } = input;
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(categories).values(values).returning();
      if (statusIds.length)
        await tx
          .insert(categoryStatuses)
          .values([...new Set(statusIds)].map((statusId) => ({ categoryId: row!.id, statusId })));
      const out = { ...row!, statusIds };
      await this.audit.record(
        {
          eventType: 'settings.created',
          actorUserId: auth.user.id,
          ip,
          targetType: 'category',
          targetId: row!.id,
          changes: diffFields({}, input as never),
        },
        tx,
      );
      return out;
    });
  }

  async updateCategory(auth: AuthContext, id: string, input: CategoryInput, ip: string | null) {
    const before = await this.getCategory(auth, id);
    await this.checkCategory(input);
    const { statusIds, ...values } = input;
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(categories)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(categories.id, id))
        .returning();
      await tx.delete(categoryStatuses).where(eq(categoryStatuses.categoryId, id));
      if (statusIds.length)
        await tx
          .insert(categoryStatuses)
          .values([...new Set(statusIds)].map((statusId) => ({ categoryId: id, statusId })));
      const { createdAt: _c, updatedAt: _u, deletedAt: _d, id: _i, ...beforeFields } = before;
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'category',
          targetId: id,
          changes: diffFields(beforeFields as never, input as never),
        },
        tx,
      );
      return { ...row!, statusIds };
    });
  }

  async deleteCategory(auth: AuthContext, id: string, ip: string | null) {
    await this.findCategory(id);
    const used = await this.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.categoryId, id), isNull(tickets.deletedAt)))
      .limit(1);
    if (used.length)
      throw new ConflictException({ message: 'Tickets still use this category.', reason: 'category_in_use' });
    await this.db.transaction(async (tx) => {
      await tx.update(categories).set({ deletedAt: new Date() }).where(eq(categories.id, id));
      await this.audit.record(
        { eventType: 'settings.deleted', actorUserId: auth.user.id, ip, targetType: 'category', targetId: id },
        tx,
      );
    });
  }

  private async checkCategory(input: CategoryInput) {
    const errors = validateLayout(input.formLayout, await this.fields.map());
    if (input.autoArchiveDays !== null && (input.autoArchiveDays < 1 || input.autoArchiveDays > 3650))
      errors.push('Auto-archive must be 1–3650 days.');
    if (input.statusIds.length) {
      const found = await this.db
        .select({ id: ticketStatuses.id })
        .from(ticketStatuses)
        .where(and(inArray(ticketStatuses.id, input.statusIds), isNull(ticketStatuses.deletedAt)));
      if (found.length !== new Set(input.statusIds).size) errors.push('Unknown status.');
    }
    if (input.defaultCrmDatabaseId) {
      const [db] = await this.db
        .select()
        .from(crmDatabases)
        .where(and(eq(crmDatabases.id, input.defaultCrmDatabaseId), isNull(crmDatabases.deletedAt)));
      if (!db) errors.push('Unknown CRM database.');
    }
    if (errors.length) throw formError(errors, 'invalid_category');
  }

  // ----- team views

  async listTeamViews(auth: AuthContext, opts: { visibleOnly?: boolean } = {}) {
    const rows = await this.db
      .select()
      .from(ticketViews)
      .where(and(isNull(ticketViews.ownerUserId), isNull(ticketViews.deletedAt)))
      .orderBy(asc(ticketViews.name));
    return opts.visibleOnly ? rows.filter((v) => canSeeTeamView(auth.ticketRights, v.id)) : rows;
  }

  async saveTeamView(auth: AuthContext, id: string | null, input: ViewInput, ip: string | null) {
    const conditions = await this.validViewConditions(input.conditions);
    return this.db.transaction(async (tx) => {
      if (id) {
        const [row] = await tx
          .update(ticketViews)
          .set({ name: input.name, conditions, columns: input.columns, updatedAt: new Date() })
          .where(and(eq(ticketViews.id, id), isNull(ticketViews.ownerUserId), isNull(ticketViews.deletedAt)))
          .returning();
        if (!row) throw new NotFoundException();
        await this.audit.record(
          {
            eventType: 'settings.updated',
            actorUserId: auth.user.id,
            ip,
            targetType: 'ticket_view',
            targetId: id,
            details: { name: input.name },
          },
          tx,
        );
        return row;
      }
      const [row] = await tx
        .insert(ticketViews)
        .values({ ownerUserId: null, name: input.name, conditions, columns: input.columns })
        .returning();
      await this.audit.record(
        {
          eventType: 'settings.created',
          actorUserId: auth.user.id,
          ip,
          targetType: 'ticket_view',
          targetId: row!.id,
          details: { name: input.name },
        },
        tx,
      );
      return row!;
    });
  }

  async deleteTeamView(auth: AuthContext, id: string, ip: string | null) {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(ticketViews)
        .set({ deletedAt: new Date() })
        .where(and(eq(ticketViews.id, id), isNull(ticketViews.ownerUserId)))
        .returning();
      if (!rows.length) throw new NotFoundException();
      await this.audit.record(
        { eventType: 'settings.deleted', actorUserId: auth.user.id, ip, targetType: 'ticket_view', targetId: id },
        tx,
      );
    });
  }

  /** View conditions use the ticket filter fields; `@me` is allowed for user fields. */
  async validViewConditions(conditions: FilterCondition[]): Promise<FilterCondition[]> {
    const fields = ticketFilterFields((await this.fields.map()).values());
    const placeholder = '00000000-0000-4000-8000-000000000000';
    const swapped = conditions.map((c) => (c.value === '@me' ? { ...c, value: placeholder } : c));
    const r = validateConditions(fields, swapped);
    if (!r.ok) throw formError(r.errors, 'invalid_filter');
    return r.conditions.map((c, i) => (conditions[i]!.value === '@me' ? { ...c, value: '@me' } : c));
  }

  async countTicketsWithStatus(id: string) {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(sql`${id} = any(${tickets.statusIds})`);
    return r?.n ?? 0;
  }
}
