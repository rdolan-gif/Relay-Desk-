import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { automaticState, followersToAdd, newMentions } from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { activities, attachments, emailMessages, tickets, users } from '../db/schema';
import { HistoryService } from '../history/history.service';
import { htmlToText, sanitizeRich } from './sanitize';
import { TicketSettingsService } from './ticket-settings.service';
import { TicketsService } from './tickets.service';

export interface CommentInput {
  bodyHtml: string;
  isExternal?: boolean;
  mentionUserIds?: string[];
}

type ActivityRow = typeof activities.$inferSelect;

/** Ticket activities. Phase 2: internal comments, edits and moves (spec 6.2, 6.4). */
@Injectable()
export class ActivitiesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TicketsService) private readonly ticketsService: TicketsService,
    @Inject(TicketSettingsService) private readonly settings: TicketSettingsService,
    @Inject(HistoryService) private readonly history: HistoryService,
  ) {}

  async list(auth: AuthContext, ticketId: number) {
    await this.ticketsService.find(auth, ticketId);
    const rows = await this.db
      .select({ activity: activities, userName: users.name, email: emailMessages })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.userId))
      .leftJoin(emailMessages, eq(emailMessages.activityId, activities.id))
      .where(and(eq(activities.ticketId, ticketId), isNull(activities.deletedAt)))
      .orderBy(asc(activities.createdAt), asc(activities.id));
    const ids = rows.map((r) => r.activity.id);
    const files = ids.length
      ? await this.db
          .select()
          .from(attachments)
          .where(and(eq(attachments.ownerType, 'activity'), inArray(attachments.ownerId, ids)))
      : [];
    return rows.map((r) => ({
      ...publicActivity(r.activity),
      userName: r.userName,
      email: r.email
        ? {
            queueId: r.email.queueId,
            from: r.email.from,
            to: r.email.to,
            cc: r.email.cc,
            bcc: r.email.bcc,
            replyTo: r.email.replyTo,
            subject: r.email.subject,
            classification: r.email.classification,
          }
        : null,
      attachments: files
        .filter((f) => f.ownerId === r.activity.id)
        .map((f) => ({ id: f.id, filename: f.filename, mime: f.mime, size: f.size, inline: f.inline })),
    }));
  }

  /**
   * Adds an internal comment (optionally flagged external). Applies the automatic
   * reopen rule, adds the author and @mentioned users as followers (spec 6.3, 13).
   */
  async addComment(auth: AuthContext, ticketId: number, input: CommentInput) {
    const t = await this.ticketsService.find(auth, ticketId);
    this.ticketsService.assertNotArchived(t);
    const body = sanitizeRich(input.bodyHtml);
    if (!htmlToText(body)) throw new BadRequestException({ message: 'The comment is empty.', reason: 'empty_comment' });
    if (input.isExternal) {
      const category = await this.settings.findCategory(t.categoryId);
      if (!category.allowExternalComments) {
        throw new BadRequestException({
          message: 'This category does not allow external comments.',
          reason: 'external_not_allowed',
        });
      }
    }
    const mentions = await this.validMentions(auth, input.mentionUserIds ?? []);
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(activities)
        .values({
          ticketId,
          type: 'comment',
          channel: 'internal',
          direction: 'internal',
          userId: auth.user.id,
          isExternal: !!input.isExternal,
          bodyHtml: body,
          mentionUserIds: mentions,
        })
        .returning();
      await this.ticketsService.applyAutomaticState(
        tx,
        auth,
        t,
        automaticState({ state: t.state, userId: t.userId }, { type: 'internal_comment', authorId: auth.user.id }),
      );
      const existing = await this.ticketsService.followerIds(ticketId, tx);
      await this.ticketsService.addFollowers(
        tx,
        ticketId,
        followersToAdd({ existing, authorId: auth.user.id, mentionedIds: mentions, isInternalUser: () => true }),
      );
      await tx.update(tickets).set({ lastActivityAt: new Date() }).where(eq(tickets.id, ticketId));
      return row!.id;
    });
    return this.getOne(id);
  }

  /** Authors edit their own comments; each edit is logged in History (spec 6.2). */
  async editComment(auth: AuthContext, ticketId: number, activityId: string, input: CommentInput) {
    this.ticketsService.assertNotArchived(await this.ticketsService.find(auth, ticketId));
    const a = await this.findActivity(ticketId, activityId);
    if (a.type !== 'comment')
      throw new BadRequestException({ message: 'Only comments can be edited.', reason: 'not_a_comment' });
    if (a.userId !== auth.user.id)
      throw new ForbiddenException({ message: 'Only the author can edit a comment.', reason: 'not_author' });
    const body = sanitizeRich(input.bodyHtml);
    if (!htmlToText(body)) throw new BadRequestException({ message: 'The comment is empty.', reason: 'empty_comment' });
    const mentions = await this.validMentions(auth, input.mentionUserIds ?? a.mentionUserIds);
    const added = newMentions(a.mentionUserIds, mentions);
    await this.db.transaction(async (tx) => {
      await tx
        .update(activities)
        .set({ bodyHtml: body, mentionUserIds: mentions, editedAt: new Date() })
        .where(eq(activities.id, activityId));
      await this.history.record(tx, auth, 'ticket', ticketId, 'update', [
        { field: `comment:${activityId}`, old: a.bodyHtml, new: body },
      ]);
      const existing = await this.ticketsService.followerIds(ticketId, tx);
      await this.ticketsService.addFollowers(
        tx,
        ticketId,
        followersToAdd({ existing, authorId: auth.user.id, mentionedIds: added, isInternalUser: () => true }),
      );
    });
    return { ...(await this.getOne(activityId)), newMentionUserIds: added };
  }

  /** Moves one activity to another ticket; neither ticket changes state or user (spec 6.4). */
  async move(auth: AuthContext, ticketId: number, activityId: string, targetTicketId: number) {
    this.ticketsService.assertMoveAllowed(auth);
    if (ticketId === targetTicketId)
      throw new BadRequestException({ message: 'Choose a different ticket.', reason: 'same_ticket' });
    this.ticketsService.assertNotArchived(await this.ticketsService.find(auth, ticketId));
    const target = await this.ticketsService.find(auth, targetTicketId).catch(() => {
      throw new NotFoundException({ message: 'Unknown target ticket.', reason: 'unknown_ticket' });
    });
    this.ticketsService.assertNotArchived(target);
    await this.findActivity(ticketId, activityId);
    await this.db.transaction(async (tx) => {
      await tx.update(activities).set({ ticketId: targetTicketId }).where(eq(activities.id, activityId));
      await this.history.record(tx, auth, 'ticket', ticketId, 'move', [
        { field: 'activityMovedTo', old: activityId, new: targetTicketId },
      ]);
      await this.history.record(tx, auth, 'ticket', targetTicketId, 'move', [
        { field: 'activityMovedFrom', old: ticketId, new: activityId },
      ]);
    });
    return this.getOne(activityId);
  }

  private async findActivity(ticketId: number, activityId: string): Promise<ActivityRow> {
    const [a] = await this.db
      .select()
      .from(activities)
      .where(and(eq(activities.id, activityId), eq(activities.ticketId, ticketId), isNull(activities.deletedAt)));
    if (!a) throw new NotFoundException({ message: 'Unknown activity.', reason: 'unknown_activity' });
    return a;
  }

  private async getOne(id: string) {
    const [r] = await this.db
      .select({ activity: activities, userName: users.name })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.userId))
      .where(eq(activities.id, id));
    return { ...publicActivity(r!.activity), userName: r!.userName };
  }

  /** @mentions must be active internal users the author can see (spec 13). */
  private async validMentions(auth: AuthContext, ids: string[]) {
    return this.ticketsService.validFollowers(auth, ids).catch(() => {
      throw new BadRequestException({ message: 'You can only mention users you can see.', reason: 'invalid_mention' });
    });
  }
}

export function publicActivity(a: ActivityRow) {
  return {
    id: a.id,
    ticketId: a.ticketId,
    type: a.type,
    channel: a.channel,
    direction: a.direction,
    status: a.status,
    userId: a.userId,
    isExternal: a.isExternal,
    bodyHtml: a.bodyHtml,
    mentionUserIds: a.mentionUserIds,
    suggestedTicketIds: a.suggestedTicketIds,
    isAutomatic: a.isAutomatic,
    error: a.error,
    createdAt: a.createdAt,
    editedAt: a.editedAt,
  };
}
