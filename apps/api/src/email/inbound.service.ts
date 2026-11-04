import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import {
  applyRoutingRules,
  automaticState,
  baseSubject,
  classifyInbound,
  cleanMessageId,
  decideThread,
  parseReferences,
  pickContact,
  renderTemplate,
  shouldAutoRespond,
  ticketIdFromSubject,
  type RoutingRule,
  type ThreadCandidate,
} from '@relay-desk/domain';
import { DB, type Db, type DbOrTx } from '../db/db';
import {
  accounts,
  activities,
  attachments,
  contacts,
  emailMessages,
  inboundLog,
  mailboxQueues,
  tickets,
} from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { TicketsService } from '../tickets/tickets.service';
import { sanitizeEmailHtml } from './email-html';
import { MailboxesService, type MailboxRow } from './mailboxes.service';
import { OutboundService } from './outbound.service';
import { MAIL_PROVIDERS, type FetchedMessage, type MailProviders } from './providers';
import { RoutingRulesService } from './routing-rules.service';
import { TemplatesService } from './templates.service';

export type InboundOutcome =
  | { outcome: 'duplicate' }
  | { outcome: 'dropped_loop' }
  | { outcome: 'bounce'; matched: boolean }
  | { outcome: 'appended' | 'created'; ticketId: number; activityId: string; autoResponded: boolean };

const flatten = (a: AddressObject | AddressObject[] | undefined) =>
  (Array.isArray(a) ? a : a ? [a] : [])
    .flatMap((x) => x.value)
    .filter((v) => v.address)
    .map((v) => ({ ...(v.name ? { name: v.name } : {}), address: v.address!.toLowerCase() }));

/**
 * The inbound pipeline (spec 11.2): fetch → store raw → loop/bounce check → thread →
 * match contact → append or create (routing rules on new tickets) → automatic state →
 * auto-response. Each provider message is processed once (inbound_log).
 */
@Injectable()
export class InboundService {
  private readonly log = new Logger('Inbound');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MailboxesService) private readonly mailboxes: MailboxesService,
    @Inject(MAIL_PROVIDERS) private readonly providers: MailProviders,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(RoutingRulesService) private readonly rules: RoutingRulesService,
    @Inject(TemplatesService) private readonly templates: TemplatesService,
    @Inject(OutboundService) private readonly outbound: OutboundService,
  ) {}

  /** Checks every active, connected mailbox once. */
  async syncAll(): Promise<void> {
    const boxes = await this.db
      .select()
      .from(mailboxQueues)
      .where(and(isNull(mailboxQueues.deletedAt), eq(mailboxQueues.active, true)));
    for (const box of boxes) {
      if (box.provider === 'gmail' && !box.credentialsEnc) continue;
      await this.syncMailbox(box.id).catch((err: unknown) => this.log.error(`${box.address}: ${String(err)}`));
    }
  }

  async syncMailbox(queueId: string): Promise<InboundOutcome[]> {
    const box = await this.mailboxes.find(queueId);
    try {
      const res = await this.providers[box.provider].fetchNew(this.mailboxes.ref(box));
      const outcomes: InboundOutcome[] = [];
      for (const m of res.messages) outcomes.push(await this.processMessage(box, m));
      await this.db
        .update(mailboxQueues)
        .set({ syncCursor: res.cursor, lastSyncAt: new Date(), lastError: null })
        .where(eq(mailboxQueues.id, box.id));
      return outcomes;
    } catch (err) {
      await this.db
        .update(mailboxQueues)
        .set({ lastError: err instanceof Error ? err.message.slice(0, 500) : String(err), lastSyncAt: new Date() })
        .where(eq(mailboxQueues.id, box.id));
      throw err;
    }
  }

  async processMessage(box: MailboxRow, m: FetchedMessage): Promise<InboundOutcome> {
    const [seen] = await this.db
      .select()
      .from(inboundLog)
      .where(and(eq(inboundLog.queueId, box.id), eq(inboundLog.providerMessageId, m.providerId)));
    if (seen) return { outcome: 'duplicate' };

    const parsed = await simpleParser(m.raw);
    const stored = await this.storage.put(`mail/${box.id}/in`, m.raw, 'eml');
    const from = flatten(parsed.from)[0] ?? { address: 'unknown@unknown' };
    const headers = Object.fromEntries([...parsed.headers.keys()].map((k) => [k.toLowerCase(), headerText(parsed, k)]));
    const cls = classifyInbound({ from: from.address, headers }, await this.mailboxes.allAddresses());

    if (cls.kind === 'loop') {
      await this.logOutcome(this.db, box.id, m.providerId, 'dropped_loop', null, null, `from ${from.address}`);
      return { outcome: 'dropped_loop' };
    }
    const messageId = parsed.messageId ? cleanMessageId(parsed.messageId) : null;
    const inReplyTo = parsed.inReplyTo ? cleanMessageId(parsed.inReplyTo) : null;
    const references = [
      ...new Set([
        ...(Array.isArray(parsed.references)
          ? parsed.references.map(cleanMessageId)
          : parseReferences(parsed.references)),
        ...(inReplyTo ? [inReplyTo] : []),
      ]),
    ];

    if (cls.kind === 'bounce') {
      // A bounce marks our original email Failed (spec 11.4) instead of opening a ticket.
      const matched = await this.outbound.markBounced(
        this.db,
        references,
        'The email bounced: ' + (parsed.subject ?? '').slice(0, 200),
      );
      await this.logOutcome(this.db, box.id, m.providerId, 'bounce', null, null, matched ? 'matched' : 'unmatched');
      return { outcome: 'bounce', matched };
    }

    const decision = decideThread({
      headerThreading: box.headerThreading,
      headerMatches: await this.headerMatches(references),
      subjectMatch: await this.subjectMatch(parsed.subject),
    });

    const dbIds = await this.mailboxes.crmDatabasesOf(box.id);
    const matches = dbIds.length
      ? await this.db
          .select()
          .from(contacts)
          .where(
            and(
              isNull(contacts.deletedAt),
              inArray(contacts.databaseId, dbIds),
              sql`${contacts.emails} @> array[${from.address}]::text[]`,
            ),
          )
      : [];
    const { contact } = pickContact(matches);
    const html = parsed.html ? sanitizeEmailHtml(parsed.html) : textToHtml(parsed.text ?? '');
    const to = flatten(parsed.to);
    const cc = flatten(parsed.cc);

    const result = await this.db.transaction(async (tx) => {
      let ticketId: number;
      let created = false;
      if (decision.action === 'append') {
        ticketId = decision.ticketId;
      } else {
        const [account] = contact?.accountId
          ? await tx.select().from(accounts).where(eq(accounts.id, contact.accountId))
          : [];
        const routing = applyRoutingRules((await this.rules.list()) as RoutingRule[], {
          direction: 'incoming',
          from: from.address,
          to: to.map((a) => a.address),
          cc: cc.map((a) => a.address),
          subject: parsed.subject ?? '',
          body: parsed.text ?? '',
          queueId: box.id,
          hasAttachment: parsed.attachments.some((a) => a.contentDisposition !== 'inline'),
          contactFields: contact?.customFields ?? {},
          accountFields: account?.customFields ?? {},
        });
        ticketId = await this.tickets.createSystemTicket(tx, null, {
          title: baseSubject(parsed.subject),
          categoryId: routing.actions.categoryId ?? box.defaultCategoryId,
          state: routing.actions.state ?? 'open',
          priority: routing.actions.priority ?? 'normal',
          userId: routing.actions.userId ?? null,
          contactId: contact?.id ?? null,
          statusIds: routing.actions.statusIds ?? [],
          customFields: routing.actions.customFields ?? {},
          distributable: true,
        });
        created = true;
      }
      const [act] = await tx
        .insert(activities)
        .values({
          ticketId,
          type: 'email',
          channel: 'email',
          direction: 'in',
          status: 'received',
          contactId: contact?.id ?? null,
          bodyHtml: html,
          suggestedTicketIds: decision.suggested,
          // Ordered by when we received it; the sender's Date header can be wrong or early.
          createdAt: new Date(),
        })
        .returning();
      await tx.insert(emailMessages).values({
        activityId: act!.id,
        queueId: box.id,
        providerMessageId: m.providerId,
        providerThreadId: m.threadId ?? null,
        messageId,
        inReplyTo,
        references,
        from,
        to,
        cc,
        replyTo: flatten(parsed.replyTo),
        subject: parsed.subject ?? '',
        bodyText: (parsed.text ?? '').slice(0, 200_000),
        classification: cls.kind === 'automated' ? `automated: ${cls.reason}` : 'normal',
        rawStorageKey: stored.key,
      });
      for (const a of parsed.attachments) {
        const put = await this.storage.put(`mail/${box.id}/att`, a.content, 'bin');
        await tx.insert(attachments).values({
          ownerType: 'activity',
          ownerId: act!.id,
          filename: (a.filename ?? 'attachment').slice(0, 255),
          mime: a.contentType || 'application/octet-stream',
          size: put.size,
          storageKey: put.key,
          checksum: put.checksum,
          contentId: a.contentId ? cleanMessageId(a.contentId) : null,
          inline: a.contentDisposition === 'inline',
        });
      }
      const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticketId));
      await tx
        .update(tickets)
        .set({ lastActivityAt: new Date(), ...(t && !t.contactId && contact ? { contactId: contact.id } : {}) })
        .where(eq(tickets.id, ticketId));
      if (!created && t) {
        // A customer's email reopens Waiting and Closed tickets (spec 6.3).
        await this.tickets.applyAutomaticState(
          tx,
          null,
          t,
          automaticState({ state: t.state, userId: t.userId }, { type: 'inbound_customer_email' }),
        );
      }
      await this.logOutcome(tx, box.id, m.providerId, created ? 'created' : 'appended', ticketId, act!.id, null);
      return { ticketId, activityId: act!.id, created };
    });

    let autoResponded = false;
    if (
      shouldAutoRespond({
        enabled: box.autoResponseEnabled,
        onlyNewTickets: box.autoResponseNewOnly,
        createdNewTicket: result.created,
        inbound: cls,
      }) &&
      box.autoResponseTemplateId
    ) {
      const rendered = await this.templates
        .render(box.autoResponseTemplateId, result.ticketId, box.senderName || box.title)
        .catch(() => null);
      if (rendered) {
        const values = await this.templates.valuesFor(result.ticketId, box.senderName || box.title);
        const sent = await this.outbound.sendAutomatic({
          queue: box,
          ticketId: result.ticketId,
          replyToActivityId: result.activityId,
          to: from.address,
          subject: rendered.subject
            ? renderTemplate(rendered.subject, values, { html: false })
            : (parsed.subject ?? ''),
          bodyHtml: rendered.bodyHtml,
        });
        autoResponded = sent.status === 'sent';
      }
    }
    // Hand the new ticket to an agent, or leave it in the backlog (spec 9).
    if (result.created) await this.tickets.distributeTicket(result.ticketId);
    return {
      outcome: result.created ? 'created' : 'appended',
      ticketId: result.ticketId,
      activityId: result.activityId,
      autoResponded,
    };
  }

  /** Tickets holding an email whose Message-ID is in this mail's In-Reply-To/References (merged → survivor). */
  private async headerMatches(ids: string[]): Promise<ThreadCandidate[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ ticketId: activities.ticketId })
      .from(emailMessages)
      .innerJoin(activities, eq(activities.id, emailMessages.activityId))
      .where(inArray(emailMessages.messageId, ids));
    const out = new Map<number, ThreadCandidate>();
    for (const r of rows) {
      if (r.ticketId === null) continue;
      const t = await this.resolveTicket(r.ticketId);
      if (t) out.set(t.ticketId, t);
    }
    return [...out.values()];
  }

  private async subjectMatch(subject: string | undefined): Promise<ThreadCandidate | null> {
    const id = ticketIdFromSubject(subject);
    return id ? this.resolveTicket(id) : null;
  }

  private async resolveTicket(id: number): Promise<ThreadCandidate | null> {
    let cur: number | null = id;
    for (let i = 0; i < 10 && cur !== null; i++) {
      const [t] = await this.db.select().from(tickets).where(eq(tickets.id, cur));
      if (!t || t.deletedAt) return null;
      if (t.mergedIntoId === null) return { ticketId: t.id, state: t.state, lastActivityAt: t.lastActivityAt };
      cur = t.mergedIntoId;
    }
    return null;
  }

  private async logOutcome(
    tx: DbOrTx,
    queueId: string,
    providerMessageId: string,
    outcome: string,
    ticketId: number | null,
    activityId: string | null,
    detail: string | null,
  ) {
    await tx
      .insert(inboundLog)
      .values({ queueId, providerMessageId, outcome, ticketId, activityId, detail })
      .onConflictDoNothing();
  }

  /** Recent inbound log for a mailbox (the Settings page shows what happened to each email). */
  recentLog(queueId: string) {
    return this.db
      .select()
      .from(inboundLog)
      .where(eq(inboundLog.queueId, queueId))
      .orderBy(desc(inboundLog.id))
      .limit(50);
  }
}

function headerText(parsed: ParsedMail, key: string): string {
  const v = parsed.headers.get(key);
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && 'value' in v && typeof (v as { value: unknown }).value === 'string') {
    const o = v as { value: string; params?: Record<string, string> };
    return [o.value, ...Object.entries(o.params ?? {}).map(([k, p]) => `${k}=${p}`)].join('; ');
  }
  return String(v);
}

function textToHtml(text: string): string {
  const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}
