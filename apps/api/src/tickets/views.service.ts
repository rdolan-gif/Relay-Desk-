import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { canSeeTeamView, type FilterCondition } from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { sidebarItems, ticketViews } from '../db/schema';
import { TicketSettingsService, type ViewInput } from './ticket-settings.service';

export interface SidebarItemInput {
  viewId: string;
  position: number;
  folder?: string | null;
  parentViewId?: string | null;
}

/**
 * Ticket sidebar (spec 6.1): Team views (admin-made, from rights) and My views (the
 * user's own views plus pinned team views, ordered, optionally nested or in folders).
 * Removing a view from the sidebar does not delete it.
 */
@Injectable()
export class ViewsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TicketSettingsService) private readonly settings: TicketSettingsService,
  ) {}

  async sidebar(auth: AuthContext) {
    const team = await this.settings.listTeamViews(auth, { visibleOnly: true });
    const mine = await this.db
      .select()
      .from(ticketViews)
      .where(and(eq(ticketViews.ownerUserId, auth.user.id), isNull(ticketViews.deletedAt)))
      .orderBy(asc(ticketViews.name));
    const items = await this.db
      .select()
      .from(sidebarItems)
      .where(eq(sidebarItems.userId, auth.user.id))
      .orderBy(asc(sidebarItems.position));
    const allowed = new Set([...team.map((v) => v.id), ...mine.map((v) => v.id)]);
    return { teamViews: team, myViews: mine, items: items.filter((i) => allowed.has(i.viewId)) };
  }

  async createMine(auth: AuthContext, input: ViewInput) {
    const conditions = await this.settings.validViewConditions(input.conditions);
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(ticketViews)
        .values({ ownerUserId: auth.user.id, name: input.name, conditions, columns: input.columns })
        .returning();
      // New personal views go to the end of My views.
      const existing = await tx.select().from(sidebarItems).where(eq(sidebarItems.userId, auth.user.id));
      await tx.insert(sidebarItems).values({ userId: auth.user.id, viewId: row!.id, position: existing.length });
      return row!;
    });
  }

  async updateMine(auth: AuthContext, id: string, input: ViewInput) {
    const conditions = await this.settings.validViewConditions(input.conditions);
    const [row] = await this.db
      .update(ticketViews)
      .set({ name: input.name, conditions, columns: input.columns, updatedAt: new Date() })
      .where(and(eq(ticketViews.id, id), eq(ticketViews.ownerUserId, auth.user.id), isNull(ticketViews.deletedAt)))
      .returning();
    if (!row) throw new NotFoundException();
    return row;
  }

  async deleteMine(auth: AuthContext, id: string) {
    const rows = await this.db
      .update(ticketViews)
      .set({ deletedAt: new Date() })
      .where(and(eq(ticketViews.id, id), eq(ticketViews.ownerUserId, auth.user.id)))
      .returning();
    if (!rows.length) throw new NotFoundException();
    await this.db.delete(sidebarItems).where(eq(sidebarItems.viewId, id));
  }

  /** Replaces My views ordering: pin/unpin team views, reorder, nest, folder. */
  async setSidebar(auth: AuthContext, items: SidebarItemInput[]) {
    const { teamViews, myViews } = await this.sidebar(auth);
    const allowed = new Set([...teamViews.map((v) => v.id), ...myViews.map((v) => v.id)]);
    const ids = items.map((i) => i.viewId);
    if (ids.some((id) => !allowed.has(id)) || new Set(ids).size !== ids.length) {
      throw new BadRequestException({
        message: 'Unknown or duplicate view in the sidebar.',
        reason: 'invalid_sidebar',
      });
    }
    if (items.some((i) => i.parentViewId && (!ids.includes(i.parentViewId) || i.parentViewId === i.viewId))) {
      throw new BadRequestException({
        message: 'A view can only be nested under another view in your sidebar.',
        reason: 'invalid_sidebar',
      });
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(sidebarItems).where(eq(sidebarItems.userId, auth.user.id));
      if (items.length) {
        await tx.insert(sidebarItems).values(
          items.map((i) => ({
            userId: auth.user.id,
            viewId: i.viewId,
            position: i.position,
            folder: i.folder ?? null,
            parentViewId: i.parentViewId ?? null,
          })),
        );
      }
    });
    return this.sidebar(auth);
  }

  /** Conditions of a view the caller may use (own, or a team view in their rights). */
  async conditionsOf(auth: AuthContext, viewId: string): Promise<FilterCondition[]> {
    const [v] = await this.db
      .select()
      .from(ticketViews)
      .where(and(eq(ticketViews.id, viewId), isNull(ticketViews.deletedAt)));
    if (!v) throw new NotFoundException({ message: 'Unknown view.', reason: 'unknown_view' });
    const ok = v.ownerUserId ? v.ownerUserId === auth.user.id : canSeeTeamView(auth.ticketRights, v.id);
    if (!ok) throw new NotFoundException({ message: 'Unknown view.', reason: 'unknown_view' });
    return v.conditions;
  }
}
