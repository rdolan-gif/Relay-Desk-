import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { canUseMacro, diffFields, validateMacro, type MacroAction, type MacroPosition } from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/request-context';
import { formError } from '../crm/form-errors';
import { DB, type Db } from '../db/db';
import { categories, macroCategories, macros } from '../db/schema';
import { SlaService } from '../sla/sla.service';
import { TicketsService } from '../tickets/tickets.service';

export interface MacroInput {
  title: string;
  description: string;
  colour: string;
  position: MacroPosition;
  actions: MacroAction[];
  categoryIds: string[];
}

/** Macros (spec 10): built by admins, shown per category and rights. */
@Injectable()
export class MacrosService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(SlaService) private readonly sla: SlaService,
  ) {}

  async list() {
    const rows = await this.db.select().from(macros).where(isNull(macros.deletedAt)).orderBy(asc(macros.title));
    const links = rows.length
      ? await this.db
          .select()
          .from(macroCategories)
          .where(
            inArray(
              macroCategories.macroId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    return rows.map((r) =>
      publicMacro(
        r,
        links.filter((l) => l.macroId === r.id).map((l) => l.categoryId),
      ),
    );
  }

  private async find(id: string) {
    const [r] = await this.db
      .select()
      .from(macros)
      .where(and(eq(macros.id, id), isNull(macros.deletedAt)));
    if (!r) throw new NotFoundException();
    const links = await this.db.select().from(macroCategories).where(eq(macroCategories.macroId, id));
    return publicMacro(
      r,
      links.map((l) => l.categoryId),
    );
  }

  private async check(input: MacroInput) {
    const errors = validateMacro(input);
    if (input.categoryIds.length) {
      const found = await this.db
        .select({ id: categories.id })
        .from(categories)
        .where(and(inArray(categories.id, input.categoryIds), isNull(categories.deletedAt)));
      if (found.length !== new Set(input.categoryIds).size) errors.push('Unknown category.');
    }
    if (errors.length) throw formError(errors, 'invalid_macro');
  }

  async create(auth: AuthContext, input: MacroInput, ip: string | null) {
    await this.check(input);
    const { categoryIds, ...values } = input;
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(macros).values(values).returning();
      if (categoryIds.length)
        await tx
          .insert(macroCategories)
          .values([...new Set(categoryIds)].map((categoryId) => ({ macroId: row!.id, categoryId })));
      await this.audit.record(
        {
          eventType: 'settings.created',
          actorUserId: auth.user.id,
          ip,
          targetType: 'macro',
          targetId: row!.id,
          changes: diffFields({}, input as never),
        },
        tx,
      );
      return publicMacro(row!, categoryIds);
    });
  }

  async update(auth: AuthContext, id: string, input: MacroInput, ip: string | null) {
    const before = await this.find(id);
    await this.check(input);
    const { categoryIds, ...values } = input;
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(macros)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(macros.id, id))
        .returning();
      await tx.delete(macroCategories).where(eq(macroCategories.macroId, id));
      if (categoryIds.length)
        await tx
          .insert(macroCategories)
          .values([...new Set(categoryIds)].map((categoryId) => ({ macroId: id, categoryId })));
      const { id: _i, ...b } = before;
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'macro',
          targetId: id,
          changes: diffFields(b as never, input as never),
        },
        tx,
      );
      return publicMacro(row!, categoryIds);
    });
  }

  async clone(auth: AuthContext, id: string, ip: string | null) {
    const m = await this.find(id);
    return this.create(
      auth,
      {
        title: `${m.title} (copy)`,
        description: m.description,
        colour: m.colour,
        position: m.position,
        actions: m.actions,
        categoryIds: m.categoryIds,
      },
      ip,
    );
  }

  async remove(auth: AuthContext, id: string, ip: string | null) {
    await this.find(id);
    await this.db.transaction(async (tx) => {
      await tx.update(macros).set({ deletedAt: new Date() }).where(eq(macros.id, id));
      await this.audit.record(
        { eventType: 'settings.deleted', actorUserId: auth.user.id, ip, targetType: 'macro', targetId: id },
        tx,
      );
    });
  }

  /**
   * Macros for a ticket: enabled for its category and in the user's rights (spec 10).
   * Includes the category's working hours for "+N working days".
   */
  async forTicket(auth: AuthContext, ticketId: number) {
    const t = await this.tickets.find(auth, ticketId);
    return this.forCategory(auth, t.categoryId);
  }

  async forCategory(auth: AuthContext, categoryId: string) {
    const rows = await this.db
      .select({ macro: macros })
      .from(macros)
      .innerJoin(macroCategories, eq(macroCategories.macroId, macros.id))
      .where(and(eq(macroCategories.categoryId, categoryId), isNull(macros.deletedAt)))
      .orderBy(asc(macros.title));
    const [cat] = await this.db
      .select({ timeGroupId: categories.timeGroupId })
      .from(categories)
      .where(eq(categories.id, categoryId));
    return {
      macros: rows
        .filter((r) => canUseMacro(auth.ticketRights, r.macro.id))
        .map((r) => publicMacro(r.macro, [categoryId])),
      timeGroup: await this.sla.loadTimeGroup(this.db, cat?.timeGroupId ?? null),
    };
  }

  /** A save from a macro: allowed only if the macro is available on this ticket. */
  async assertUsable(auth: AuthContext, ticketId: number, macroId: string) {
    const { macros: available } = await this.forTicket(auth, ticketId);
    if (!available.some((m) => m.id === macroId))
      throw new NotFoundException({ message: 'That macro is not available here.', reason: 'unknown_macro' });
  }
}

export function publicMacro(r: typeof macros.$inferSelect, categoryIds: string[]) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    colour: r.colour,
    position: r.position,
    actions: r.actions,
    categoryIds,
  };
}
