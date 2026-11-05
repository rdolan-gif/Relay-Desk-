import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import {
  ANONYMOUS_ADDRESS,
  anonymiseConfirmation,
  eraseConfirmation,
  redactChanges,
  REMOVED,
  REMOVED_HTML,
} from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/request-context';
import { ContactsService } from '../crm/contacts.service';
import { DB, type Db, type DbOrTx } from '../db/db';
import {
  activities,
  attachments,
  categories,
  contacts,
  crmRecords,
  customFields,
  emailMessages,
  historyEntries,
  inboundLog,
  notifications,
  tickets,
} from '../db/schema';
import { JobsService } from '../jobs/jobs.service';
import { StorageService } from '../storage/storage.service';
import { htmlToText } from '../tickets/sanitize';
import { TicketsService } from '../tickets/tickets.service';

/** Custom value types that describe the ticket, not a person, and survive anonymising. */
const METADATA_TYPES = new Set(['number', 'date', 'datetime', 'select', 'multiselect', 'radio', 'checkbox']);

/**
 * GDPR tools (spec 14): anonymise a ticket, erase a contact (right to erasure), subject
 * access export, and retention policies. Anonymising is irreversible: personal values are
 * overwritten in the ticket, its activities, emails (including the stored raw message),
 * attachments (files deleted), history and notifications; metadata stays for reports.
 */
@Injectable()
export class GdprService {
  private readonly log = new Logger('GDPR');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(ContactsService) private readonly contactsService: ContactsService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  // ------------------------------------------------------------------ anonymise a ticket

  async anonymiseTicket(auth: AuthContext, id: number, confirmation: string, ip: string | null) {
    await this.tickets.find(auth, id);
    if (confirmation.trim() !== anonymiseConfirmation(id))
      throw new BadRequestException({
        message: `Type "${anonymiseConfirmation(id)}" to confirm.`,
        reason: 'confirmation_required',
      });
    const files = await this.db.transaction(async (tx) => {
      const f = await this.scrubTicket(tx, id);
      await this.audit.record(
        { eventType: 'gdpr.anonymised', actorUserId: auth.user.id, ip, targetType: 'ticket', targetId: String(id) },
        tx,
      );
      return f;
    });
    await this.deleteFiles(files);
    return { id, anonymised: true };
  }

  /** Scrubs one ticket in a transaction; returns storage keys to delete after commit. */
  private async scrubTicket(tx: DbOrTx, id: number): Promise<string[]> {
    const [t] = await tx.select().from(tickets).where(eq(tickets.id, id));
    if (!t) return [];
    const defs = await tx.select({ id: customFields.id, type: customFields.type }).from(customFields);
    const keep: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t.customFields)) {
      if (METADATA_TYPES.has(defs.find((d) => d.id === k)?.type ?? '')) keep[k] = v;
    }
    await tx
      .update(tickets)
      .set({ title: `Anonymised ticket #${id}`, description: '', customFields: keep, isAnonymised: true })
      .where(eq(tickets.id, id));
    const acts = await tx.select({ id: activities.id }).from(activities).where(eq(activities.ticketId, id));
    const files = await this.scrubActivities(
      tx,
      acts.map((a) => a.id),
    );
    const hist = await tx
      .select()
      .from(historyEntries)
      .where(and(eq(historyEntries.entityType, 'ticket'), eq(historyEntries.entityId, String(id))));
    for (const h of hist)
      await tx
        .update(historyEntries)
        .set({ changes: redactChanges(h.changes) })
        .where(eq(historyEntries.id, h.id));
    await tx
      .update(notifications)
      .set({ body: '', title: sql`regexp_replace(${notifications.title}, ':.*$', '')` })
      .where(eq(notifications.ticketId, id));
    return files;
  }

  /** Bodies, email addresses and subjects replaced; raw messages and attachments removed. */
  private async scrubActivities(tx: DbOrTx, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const files: string[] = [];
    await tx.update(activities).set({ bodyHtml: REMOVED_HTML }).where(inArray(activities.id, ids));
    const mails = await tx.select().from(emailMessages).where(inArray(emailMessages.activityId, ids));
    for (const m of mails) {
      if (m.rawStorageKey) files.push(m.rawStorageKey);
      await tx
        .update(emailMessages)
        .set({
          from: { address: ANONYMOUS_ADDRESS },
          to: m.to.map(() => ({ address: ANONYMOUS_ADDRESS })),
          cc: m.cc.map(() => ({ address: ANONYMOUS_ADDRESS })),
          bcc: m.bcc.map(() => ({ address: ANONYMOUS_ADDRESS })),
          replyTo: [],
          subject: REMOVED,
          bodyText: '',
          rawStorageKey: null,
        })
        .where(eq(emailMessages.activityId, m.activityId));
    }
    const files2 = await tx
      .select()
      .from(attachments)
      .where(and(eq(attachments.ownerType, 'activity'), inArray(attachments.ownerId, ids)));
    files.push(...files2.map((a) => a.storageKey));
    if (files2.length)
      await tx.delete(attachments).where(
        inArray(
          attachments.id,
          files2.map((a) => a.id),
        ),
      );
    await tx.update(inboundLog).set({ detail: null }).where(inArray(inboundLog.activityId, ids));
    return files;
  }

  private async deleteFiles(keys: string[]) {
    for (const k of keys)
      await this.storage.delete(k).catch((err) => this.log.warn(`could not delete ${k}: ${(err as Error).message}`));
  }

  // ------------------------------------------------------------------ erase a contact

  /** Right to erasure: the contact, its tickets and its activities, in one job (spec 14). */
  async eraseContact(auth: AuthContext, contactId: string, confirmation: string, ip: string | null) {
    await this.contactsService.find(auth, contactId);
    if (confirmation.trim() !== eraseConfirmation())
      throw new BadRequestException({
        message: `Type "${eraseConfirmation()}" to confirm.`,
        reason: 'confirmation_required',
      });
    // The job title carries no personal data: it outlives the erasure.
    return this.jobs.start(auth, 'erase_contact', 'Erase a contact', { contactId }, async (ctx) => {
      const own = await this.db.select({ id: tickets.id }).from(tickets).where(eq(tickets.contactId, contactId));
      const elsewhere = await this.db
        .select({ id: activities.id })
        .from(activities)
        .where(
          and(
            eq(activities.contactId, contactId),
            own.length
              ? sql`${activities.ticketId} not in (${sql.join(
                  own.map((t) => sql`${t.id}`),
                  sql`, `,
                )})`
              : undefined,
          ),
        );
      await ctx.progress(0, own.length + 1);
      let n = 0;
      const files: string[] = [];
      for (const t of own) {
        files.push(...(await this.db.transaction((tx) => this.scrubTicket(tx, t.id))));
        await ctx.progress(++n);
      }
      await this.db.transaction(async (tx) => {
        files.push(
          ...(await this.scrubActivities(
            tx,
            elsewhere.map((a) => a.id),
          )),
        );
        await tx
          .update(contacts)
          .set({
            name: 'Erased contact',
            emails: [],
            phones: [],
            customFields: {},
            anonymisedAt: new Date(),
            deletedAt: sql`coalesce(${contacts.deletedAt}, now())`,
          })
          .where(eq(contacts.id, contactId));
        const hist = await tx
          .select()
          .from(historyEntries)
          .where(and(eq(historyEntries.entityType, 'contact'), eq(historyEntries.entityId, contactId)));
        for (const h of hist)
          await tx
            .update(historyEntries)
            .set({ changes: redactChanges(h.changes) })
            .where(eq(historyEntries.id, h.id));
        await this.audit.record(
          {
            eventType: 'gdpr.erased',
            actorUserId: auth.user.id,
            ip,
            targetType: 'contact',
            targetId: contactId,
            details: { tickets: own.length, otherActivities: elsewhere.length },
          },
          tx,
        );
      });
      await this.deleteFiles(files);
      await ctx.progress(own.length + 1, own.length + 1);
      return { tickets: own.length, activities: elsewhere.length };
    });
  }

  // ------------------------------------------------------------------ subject access export

  /** One ZIP of everything held on a contact (spec 14). */
  async subjectAccessExport(auth: AuthContext, contactId: string, ip: string | null) {
    const c = await this.contactsService.find(auth, contactId);
    await this.audit.record({
      eventType: 'gdpr.subject_access_export',
      actorUserId: auth.user.id,
      ip,
      targetType: 'contact',
      targetId: contactId,
    });
    return this.jobs.start(auth, 'subject_access_export', `Data held on ${c.name}`, { contactId }, async (ctx) => {
      const files: Record<string, Uint8Array> = {};
      const json = (name: string, v: unknown) => (files[name] = strToU8(JSON.stringify(v, null, 2)));
      json('contact.json', {
        name: c.name,
        emails: c.emails,
        phones: c.phones,
        accountId: c.accountId,
        customFields: c.customFields,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      });
      json(
        'records.json',
        await this.db
          .select()
          .from(crmRecords)
          .where(and(eq(crmRecords.contactId, contactId), isNull(crmRecords.deletedAt))),
      );
      const ts = await this.db
        .select()
        .from(tickets)
        .where(and(eq(tickets.contactId, contactId), isNull(tickets.deletedAt)));
      const actIds = new Set<string>();
      for (const t of ts) {
        const acts = await this.db
          .select()
          .from(activities)
          .where(and(eq(activities.ticketId, t.id), isNull(activities.deletedAt)));
        acts.forEach((a) => actIds.add(a.id));
        json(`tickets/${t.id}.json`, {
          id: t.id,
          title: t.title,
          description: htmlToText(t.description),
          state: t.state,
          priority: t.priority,
          createdAt: t.createdAt,
          closedAt: t.closedAt,
          customFields: t.customFields,
          activities: acts.map((a) => ({
            id: a.id,
            type: a.type,
            direction: a.direction,
            createdAt: a.createdAt,
            text: htmlToText(a.bodyHtml),
          })),
        });
      }
      const others = await this.db
        .select({ id: activities.id })
        .from(activities)
        .where(eq(activities.contactId, contactId));
      others.forEach((a) => actIds.add(a.id));
      const ids = [...actIds];
      if (ids.length) {
        for (const m of await this.db
          .select()
          .from(emailMessages)
          .where(and(inArray(emailMessages.activityId, ids), isNotNull(emailMessages.rawStorageKey)))) {
          files[`emails/${m.activityId}.eml`] = new Uint8Array(
            await this.storage.get(m.rawStorageKey!).catch(() => Buffer.from('')),
          );
        }
        for (const a of await this.db
          .select()
          .from(attachments)
          .where(and(eq(attachments.ownerType, 'activity'), inArray(attachments.ownerId, ids)))) {
          const safe = a.filename.replace(/[^\w.\- ]/g, '_');
          files[`attachments/${a.ownerId}/${safe}`] = new Uint8Array(
            await this.storage.get(a.storageKey).catch(() => Buffer.from('')),
          );
        }
      }
      await ctx.attach(Buffer.from(zipSync(files)), `subject-access-${contactId.slice(0, 8)}.zip`, 'application/zip');
      return { tickets: ts.length, files: Object.keys(files).length };
    });
  }

  // ------------------------------------------------------------------ retention

  /** Retention policies (spec 14 [SHOULD]): run by the minute job; cheap when nothing is due. */
  async applyRetention(now = new Date()) {
    const cats = await this.db
      .select()
      .from(categories)
      .where(
        and(ne(categories.retentionAction, 'none'), isNotNull(categories.retentionDays), isNull(categories.deletedAt)),
      );
    let done = 0;
    for (const c of cats) {
      const cutoff = new Date(now.getTime() - c.retentionDays! * 86_400_000);
      const due = await this.db
        .select({ id: tickets.id })
        .from(tickets)
        .where(
          and(
            eq(tickets.categoryId, c.id),
            eq(tickets.state, 'archived'),
            lt(tickets.archivedAt, cutoff),
            c.retentionAction === 'anonymise' ? eq(tickets.isAnonymised, false) : isNull(tickets.deletedAt),
          ),
        )
        .limit(200);
      for (const t of due) {
        const files = await this.db.transaction(async (tx) => {
          const f = await this.scrubTicket(tx, t.id);
          if (c.retentionAction === 'delete')
            await tx.update(tickets).set({ deletedAt: now }).where(eq(tickets.id, t.id));
          await this.audit.record(
            {
              eventType: 'gdpr.anonymised',
              actorLabel: 'retention policy',
              targetType: 'ticket',
              targetId: String(t.id),
              details: { action: c.retentionAction },
            },
            tx,
          );
          return f;
        });
        await this.deleteFiles(files);
        done++;
      }
    }
    return done;
  }
}
