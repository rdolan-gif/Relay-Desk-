import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db';
import { emailMessages, mailboxQueues } from '../db/schema';
import { GMAIL_MODIFY_SCOPE } from './google-oauth.service';
import { MailboxesService } from './mailboxes.service';
import { MAIL_PROVIDERS, type MailProviders } from './providers';

/** At most this many conversations per run; the rest follow on the next run. */
const BATCH = 200;

/**
 * Closing a ticket archives its conversation in Gmail, like the team's old habit of archiving
 * an email once it needs no more action (owner O-31). Runs after each mail check, so every way
 * of closing (form, Send and close, FYI, macro, bulk edit, delete) is covered and a failure is
 * retried. When the customer replies, Gmail puts the new email back in the inbox and Relay
 * Desk reopens the ticket.
 *
 * A conversation is left alone while any ticket using it is still Open or Waiting, and only for
 * inboxes with "Archive in Gmail" on that granted the modify permission.
 */
@Injectable()
export class InboxArchiveService {
  private readonly log = new Logger('InboxArchive');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MailboxesService) private readonly mailboxes: MailboxesService,
    @Inject(MAIL_PROVIDERS) private readonly providers: MailProviders,
  ) {}

  async archivePending(): Promise<{ archived: number; failed: number }> {
    const due = await this.db.execute<{ queue_id: string; thread_id: string }>(sql`
      select distinct m.queue_id, m.provider_thread_id as thread_id
      from email_messages m
      join activities a on a.id = m.activity_id
      join tickets t on t.id = a.ticket_id
      join mailbox_queues q on q.id = m.queue_id
      where m.inbox_archived_at is null
        and m.provider_thread_id is not null
        and (t.state in ('closed', 'archived') or t.deleted_at is not null)
        and q.archive_on_close and q.deleted_at is null
        and (q.credentials_enc is not null or q.provider = 'fake')
        and (' ' || coalesce(q.granted_scopes, '') || ' ') like ${`% ${GMAIL_MODIFY_SCOPE} %`}
        and not exists (
          select 1 from email_messages m2
          join activities a2 on a2.id = m2.activity_id
          join tickets t2 on t2.id = a2.ticket_id
          where m2.queue_id = m.queue_id and m2.provider_thread_id = m.provider_thread_id
            and t2.deleted_at is null and t2.merged_into_id is null and t2.state in ('open', 'waiting')
        )
      limit ${BATCH}
    `);
    const byQueue = new Map<string, string[]>();
    for (const r of due.rows) byQueue.set(r.queue_id, [...(byQueue.get(r.queue_id) ?? []), r.thread_id]);

    let archived = 0;
    let failed = 0;
    for (const [queueId, threadIds] of byQueue) {
      const [box] = await this.db.select().from(mailboxQueues).where(eq(mailboxQueues.id, queueId));
      if (!box) continue;
      try {
        await this.providers[box.provider].archiveThreads(this.mailboxes.ref(box), threadIds);
        await this.db
          .update(emailMessages)
          .set({ inboxArchivedAt: new Date() })
          .where(and(eq(emailMessages.queueId, queueId), inArray(emailMessages.providerThreadId, threadIds)));
        archived += threadIds.length;
      } catch (err) {
        failed += threadIds.length;
        this.log.warn(`${box.address}: could not archive ${threadIds.length} conversation(s): ${String(err)}`);
      }
    }
    return { archived, failed };
  }
}
