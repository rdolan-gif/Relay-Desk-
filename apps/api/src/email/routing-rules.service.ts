import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  diffFields,
  validateRule,
  type RoutingActions,
  type RoutingCondition,
  type RoutingRule,
} from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/request-context';
import { formError } from '../crm/form-errors';
import { DB, type Db } from '../db/db';
import { routingRules } from '../db/schema';

export interface RoutingRuleInput {
  title: string;
  description?: string;
  direction: 'incoming' | 'outgoing' | 'both';
  active: boolean;
  all: RoutingCondition[];
  any: RoutingCondition[];
  actions: RoutingActions;
}

type Row = typeof routingRules.$inferSelect;
const toRule = (r: Row): RoutingRule & { description: string; position: number } => ({
  id: r.id,
  title: r.title,
  description: r.description,
  direction: r.direction,
  active: r.active,
  position: r.position,
  all: r.allConditions,
  any: r.anyConditions,
  actions: r.actions,
});

/** Ordered email routing rules (spec 11.3). */
@Injectable()
export class RoutingRulesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.db
      .select()
      .from(routingRules)
      .where(isNull(routingRules.deletedAt))
      .orderBy(asc(routingRules.position), asc(routingRules.createdAt));
    return rows.map(toRule);
  }

  async create(auth: AuthContext, input: RoutingRuleInput, ip: string | null) {
    this.check(input);
    const position = (await this.list()).length;
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(routingRules).values(this.values(input, position)).returning();
      await this.audit.record(
        {
          eventType: 'settings.created',
          actorUserId: auth.user.id,
          ip,
          targetType: 'routing_rule',
          targetId: row!.id,
          details: { title: input.title },
        },
        tx,
      );
      return toRule(row!);
    });
  }

  async update(auth: AuthContext, id: string, input: RoutingRuleInput, ip: string | null) {
    const before = await this.find(id);
    this.check(input);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(routingRules)
        .set({ ...this.values(input, before.position), updatedAt: new Date() })
        .where(eq(routingRules.id, id))
        .returning();
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'routing_rule',
          targetId: id,
          changes: diffFields(toRule(before) as never, toRule(row!) as never),
        },
        tx,
      );
      return toRule(row!);
    });
  }

  async remove(auth: AuthContext, id: string, ip: string | null) {
    await this.find(id);
    await this.db.transaction(async (tx) => {
      await tx.update(routingRules).set({ deletedAt: new Date() }).where(eq(routingRules.id, id));
      await this.audit.record(
        { eventType: 'settings.deleted', actorUserId: auth.user.id, ip, targetType: 'routing_rule', targetId: id },
        tx,
      );
    });
  }

  /** Sets the evaluation order (all matching rules apply in this order). */
  async reorder(auth: AuthContext, ids: string[], ip: string | null) {
    const current = await this.list();
    if (ids.length !== current.length || current.some((r) => !ids.includes(r.id))) {
      throw formError(['Send every rule exactly once.'], 'invalid_order');
    }
    await this.db.transaction(async (tx) => {
      for (const [position, id] of ids.entries())
        await tx.update(routingRules).set({ position }).where(eq(routingRules.id, id));
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'routing_rule',
          details: { order: ids },
        },
        tx,
      );
    });
    return this.list();
  }

  private check(input: RoutingRuleInput) {
    const errors = validateRule(input);
    if (errors.length) throw formError(errors, 'invalid_rule');
  }

  private values(input: RoutingRuleInput, position: number) {
    return {
      title: input.title.trim(),
      description: input.description ?? '',
      direction: input.direction,
      active: input.active,
      position,
      allConditions: input.all,
      anyConditions: input.any,
      actions: input.actions,
    };
  }

  private async find(id: string) {
    const [row] = await this.db
      .select()
      .from(routingRules)
      .where(and(eq(routingRules.id, id), isNull(routingRules.deletedAt)));
    if (!row) throw new NotFoundException();
    return row;
  }
}
