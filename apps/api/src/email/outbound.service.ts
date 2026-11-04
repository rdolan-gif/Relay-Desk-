import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import MailComposer from 'nodemailer/lib/mail-composer';
import { randomUUID } from 'node:crypto';
import {
  applyRoutingRules,
  canSeeCategory,
  canUseMailbox,
  domainOf,
  normaliseEmailAddress,
  replySubject,
  userTypeCanSendExternalCommunication,
  type RoutingRule,
} from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { DB, type Db, type DbOrTx } from '../db/db';
import { activities, attachments, contacts, emailMessages, tickets } from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { htmlToText } from '../tickets/sanitize';
import { TicketsService } from '../tickets/tickets.service';
import { sanitizeEmailHtml } from './email-html';
import { MailboxesService, type MailboxRow } from './mailboxes.service';
import { MAIL_PROVIDERS, type MailProviders } from './providers';
import { RoutingRulesService } from './routing-rules.service';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface SendInput {
  queueId: string;
  /** Existing ticket; omit to start a new conversation (a new ticket is created, spec 6.3). */
  ticketId?: number | null;
  kind: 'reply' | 'reply_all' | 'forward' | 'new';
  replyToActivityId?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  /** Files uploaded by this user beforehand, or attachments of the forwarded email. */
  attachmentIds?: string[];
}

/** Sending email from tickets (spec 11.4) and the outbound-creates-ticket rule (spec 6.3). */
@Injectable()
export class OutboundService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MailboxesService) private readonly mailboxes: MailboxesService,
    @Inject(MAIL_PROVIDERS) private readonly providers: MailProviders,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(RoutingRulesService) private readonly rules: RoutingRulesService,
  ) {}

  async send(auth: AuthContext, input: SendInput) {
    if (!userTypeCanSendExternalCommunication(auth.principal.type)) {
      throw new ForbiddenException({
        message: 'Your user type cannot send email to customers.',
        reason: 'cannot_send_external',
      });
    }
    const queue = await this.mailboxes.find(input.queueId);
    if (!canUseMailbox(auth.ticketRights, queue.id)) {
      throw new ForbiddenException({ message: 'You cannot send from this mailbox.', reason: 'mailbox_not_allowed' });
    }
    const to = this.addresses(input.to);
    const cc = this.addresses(input.cc ?? []);
    const bcc = this.addresses(input.bcc ?? []);
    if (!to.length) throw new BadRequestException({ message: 'Add at least one recipient.', reason: 'no_recipients' });

    let ticketId: number;
    if (input.ticketId) {
      ticketId = input.ticketId;
      this.tickets.assertNotArchived(await this.tickets.find(auth, ticketId));
    } else {
      if (!canSeeCategory(auth.ticketRights, queue.defaultCategoryId)) {
        // Spec 4: "You do not have rights for this category."
        throw new ForbiddenException({
          message: 'You do not have rights for this category.',
          reason: 'category_not_allowed',
        });
      }
      ticketId = await this.createTicketForNewEmail(auth, queue, input.subject, to, cc, input.bodyHtml);
    }
    const files = await this.attachmentsFor(auth, input.attachmentIds ?? [], ticketId);
    return this.deliver({
      queue,
      ticketId,
      authorId: auth.user.id,
      kind: input.kind,
      replyToActivityId: input.replyToActivityId ?? null,
      to,
      cc,
      bcc,
      subject: input.subject,
      bodyHtml: sanitizeEmailHtml(input.bodyHtml),
      files,
      isAutomatic: false,
    });
  }

  /** System send for auto-responses: marked automatic so it never counts as a reply (spec 8). */
  async sendAutomatic(args: {
    queue: MailboxRow;
    ticketId: number;
    replyToActivityId: string;
    to: string;
    subject: string;
    bodyHtml: string;
  }) {
    return this.deliver({
      queue: args.queue,
      ticketId: args.ticketId,
      authorId: null,
      kind: 'reply',
      replyToActivityId: args.replyToActivityId,
      to: [args.to],
      cc: [],
      bcc: [],
      subject: args.subject,
      bodyHtml: sanitizeEmailHtml(args.bodyHtml),
      files: [],
      isAutomatic: true,
    });
  }

  private async deliver(a: {
    queue: MailboxRow;
    ticketId: number;
    authorId: string | null;
    kind: SendInput['kind'];
    replyToActivityId: string | null;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    bodyHtml: string;
    files: (typeof attachments.$inferSelect)[];
    isAutomatic: boolean;
  }) {
    const original = a.replyToActivityId ? await this.originalEmail(a.replyToActivityId, a.ticketId) : null;
    const subject = a.subject.includes(`[#${a.ticketId}]`)
      ? a.subject
      : replySubject(a.kind === 'forward' ? 'forward' : a.kind === 'new' ? 'new' : 'reply', a.subject, a.ticketId);
    const messageId = `${randomUUID()}@${domainOf(a.queue.address) || 'relaydesk.local'}`;
    const references = original ? [...original.references, ...(original.messageId ? [original.messageId] : [])] : [];
    const total = a.files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_ATTACHMENT_BYTES)
      throw new BadRequestException({
        message: 'Attachments are limited to 25 MB per email.',
        reason: 'attachments_too_large',
      });

    const mail = new MailComposer({
      from: { name: a.queue.senderName || a.queue.title, address: a.queue.address },
      to: a.to,
      cc: a.cc.length ? a.cc : undefined,
      bcc: a.bcc.length ? a.bcc : undefined,
      subject,
      html: a.bodyHtml,
      text: htmlToText(a.bodyHtml),
      messageId: `<${messageId}>`,
      ...(original?.messageId
        ? { inReplyTo: `<${original.messageId}>`, references: references.map((r) => `<${r}>`).join(' ') }
        : {}),
      headers: a.isAutomatic ? { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' } : {},
      attachments: await Promise.all(
        a.files.map(async (f) => ({
          filename: f.filename,
          contentType: f.mime,
          content: await this.storage.get(f.storageKey),
        })),
      ),
    });
    const raw = await mail.compile().build();
    const stored = await this.storage.put(`mail/${a.queue.id}/out`, raw, 'eml');

    const activityId = await this.db.transaction(async (tx) => {
      const [act] = await tx
        .insert(activities)
        .values({
          ticketId: a.ticketId,
          type: 'email',
          channel: 'email',
          direction: 'out',
          status: 'sending',
          userId: a.authorId,
          bodyHtml: a.bodyHtml,
          repliedToActivityId: a.replyToActivityId,
          isAutomatic: a.isAutomatic,
        })
        .returning();
      await tx.insert(emailMessages).values({
        activityId: act!.id,
        queueId: a.queue.id,
        messageId,
        inReplyTo: original?.messageId ?? null,
        references,
        from: { name: a.queue.senderName || a.queue.title, address: a.queue.address },
        to: a.to.map((address) => ({ address })),
        cc: a.cc.map((address) => ({ address })),
        bcc: a.bcc.map((address) => ({ address })),
        subject,
        bodyText: htmlToText(a.bodyHtml),
        rawStorageKey: stored.key,
      });
      for (const f of a.files) {
        await tx.insert(attachments).values({
          ownerType: 'activity',
          ownerId: act!.id,
          filename: f.filename,
          mime: f.mime,
          size: f.size,
          storageKey: f.storageKey,
          checksum: f.checksum,
          createdById: a.authorId,
        });
      }
      // Uploads are now part of the sent email; their temporary rows go.
      const uploadIds = a.files.filter((f) => f.ownerType === 'upload').map((f) => f.id);
      if (uploadIds.length)
        await tx
          .delete(attachments)
          .where(and(eq(attachments.ownerType, 'upload'), inArray(attachments.id, uploadIds)));
      return act!.id;
    });

    try {
      const res = await this.providers[a.queue.provider].send(this.mailboxes.ref(a.queue), raw, {
        threadId: original?.providerThreadId ?? undefined,
      });
      const sentAt = new Date();
      await this.db.transaction(async (tx) => {
        await tx.update(activities).set({ status: 'sent' }).where(eq(activities.id, activityId));
        await tx
          .update(emailMessages)
          .set({
            providerMessageId: res.providerId,
            providerThreadId: res.threadId ?? original?.providerThreadId ?? null,
            ...(res.messageId ? { messageId: res.messageId.replace(/^<|>$/g, '') } : {}),
          })
          .where(eq(emailMessages.activityId, activityId));
        const [t] = await tx.select().from(tickets).where(eq(tickets.id, a.ticketId));
        await tx
          .update(tickets)
          .set({
            lastActivityAt: sentAt,
            // An agent's email is a qualifying reply; auto-responses are not (spec 8).
            ...(t && !t.firstAnswerAt && !a.isAutomatic ? { firstAnswerAt: sentAt } : {}),
          })
          .where(eq(tickets.id, a.ticketId));
        await this.tickets.refreshSla(tx, [a.ticketId]);
      });
    } catch (err) {
      // Delivery failure: the activity is marked Failed and keeps the reason (spec 11.4).
      await this.db
        .update(activities)
        .set({ status: 'failed', error: err instanceof Error ? err.message.slice(0, 500) : String(err) })
        .where(eq(activities.id, activityId));
    }
    const [act] = await this.db.select().from(activities).where(eq(activities.id, activityId));
    return { id: act!.id, ticketId: a.ticketId, status: act!.status, error: act!.error, subject, messageId };
  }

  /**
   * A new email not linked to a ticket creates one (spec 6.3): title = subject, category =
   * the mailbox's, state Open (owner O-15: the system never closes a ticket), priority Low, user = sender, contact = matched recipient;
   * outgoing routing rules then apply.
   */
  private async createTicketForNewEmail(
    auth: AuthContext,
    queue: MailboxRow,
    subject: string,
    to: string[],
    cc: string[],
    bodyHtml: string,
  ) {
    const dbIds = await this.mailboxes.crmDatabasesOf(queue.id);
    const matched = await this.contactByEmail(to[0]!, dbIds);
    const routing = applyRoutingRules((await this.rules.list()) as RoutingRule[], {
      direction: 'outgoing',
      from: queue.address,
      to,
      cc,
      subject,
      body: htmlToText(bodyHtml),
      queueId: queue.id,
      hasAttachment: false,
      contactFields: matched?.customFields ?? {},
      accountFields: {},
    });
    const created = await this.tickets.createSystemTicket(this.db, auth, {
      title: subject,
      categoryId: routing.actions.categoryId ?? queue.defaultCategoryId,
      state: routing.actions.state ?? 'open',
      priority: routing.actions.priority ?? 'low',
      userId: routing.actions.userId !== undefined ? routing.actions.userId : auth.user.id,
      contactId: matched?.id ?? null,
      statusIds: routing.actions.statusIds ?? [],
      customFields: routing.actions.customFields ?? {},
    });
    return created;
  }

  private async contactByEmail(email: string, dbIds: string[]) {
    if (!dbIds.length) return null;
    const [row] = await this.db
      .select()
      .from(contacts)
      .where(
        and(
          isNull(contacts.deletedAt),
          inArray(contacts.databaseId, dbIds),
          sql`${contacts.emails} @> array[${email}]::text[]`,
        ),
      )
      .orderBy(desc(contacts.updatedAt))
      .limit(1);
    return row ?? null;
  }

  private async originalEmail(activityId: string, ticketId: number) {
    const [row] = await this.db
      .select({ e: emailMessages })
      .from(emailMessages)
      .innerJoin(activities, eq(activities.id, emailMessages.activityId))
      .where(and(eq(emailMessages.activityId, activityId), eq(activities.ticketId, ticketId)));
    if (!row) throw new NotFoundException({ message: 'Unknown email to reply to.', reason: 'unknown_activity' });
    return row.e;
  }

  /** The caller's own uploads, or attachments of an email on the same ticket (forwarding). */
  private async attachmentsFor(auth: AuthContext, ids: string[], ticketId: number) {
    if (!ids.length) return [];
    const rows = await this.db.select().from(attachments).where(inArray(attachments.id, ids));
    const ticketActivityIds = new Set(
      (await this.db.select({ id: activities.id }).from(activities).where(eq(activities.ticketId, ticketId))).map(
        (r) => r.id,
      ),
    );
    const ok = rows.filter(
      (r) =>
        (r.ownerType === 'upload' && r.createdById === auth.user.id) ||
        (r.ownerType === 'activity' && ticketActivityIds.has(r.ownerId)),
    );
    if (ok.length !== new Set(ids).size)
      throw new BadRequestException({ message: 'An attachment is not available.', reason: 'unknown_attachment' });
    return ok;
  }

  private addresses(list: string[]): string[] {
    const out: string[] = [];
    for (const raw of list) {
      const r = normaliseEmailAddress(raw);
      if (!r.ok) throw new BadRequestException({ message: r.error, reason: 'invalid_recipient' });
      if (!out.includes(r.value)) out.push(r.value);
    }
    return out;
  }

  /** Exposed for the inbound pipeline: the Message-IDs we sent, for bounce matching. */
  async markBounced(tx: DbOrTx, messageIds: string[], reason: string): Promise<boolean> {
    if (!messageIds.length) return false;
    const rows = await tx
      .select({ id: emailMessages.activityId })
      .from(emailMessages)
      .where(inArray(emailMessages.messageId, messageIds));
    if (!rows.length) return false;
    await tx
      .update(activities)
      .set({ status: 'failed', error: reason })
      .where(
        inArray(
          activities.id,
          rows.map((r) => r.id),
        ),
      );
    return true;
  }
}
