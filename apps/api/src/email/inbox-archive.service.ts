import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { DB, type Db } from '../db/db';
import { emailMessages, mailboxQueues } from '../db/schema';
import { GMAIL_MODIFY_SCOPE } from './google-oauth.service';
import { MailboxesService } from './mailboxes.service';
import { MAIL_PROVIDERS, type MailProviders } from './providers';

/** At most this many conversations per run in each direction; the rest follow on the next run. */
const BATCH = 200;

/**
 * Keeps the Gmail inbox in step with the tickets (owners O-31, O-34), like the team's old Gmail
 * habits: a conversation stays in the inbox while one of its tickets is **Open**, and is
 * archived once they are all Waiting (snoozed until the re-open date), Closed, Archived or
 * deleted. When a ticket opens again (the re-open date comes, a customer replies, someone
 * reopens it) the conversation goes back to the inbox. Only conversations Relay Desk itself
 * archived are ever put back.
 *
 * Runs after each mail check, so every way a ticket changes is covered and failures retry. Only
 * for inboxes with "Archive in Gmail" on that granted the modify permission.
 */
@Injectable()
export class InboxArchiveService {
  private readonly log = new Logger('InboxArchive');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MailboxesService) private readonly mailboxes: MailboxesService,
    @Inject(MAIL_PROVIDERS) private readonly providers: MailProviders,
  ) {}

  async archivePending(): Promise<{ archived: number; unarchived: number; failed: number }> {
    const mailboxOk = sql`q.archive_on_close and q.deleted_at is null
        and (q.credentials_enc is not null or q.provider = 'fake')
        and (' ' || coalesce(q.granted_scopes, '') || ' ') like ${`% ${GMAIL_MODIFY_SCOPE} %`}`;
    // Is any live ticket using this conversation still Open?
    const anyOpen = sql`exists (
          select 1 from email_messages m2
          join activities a2 on a2.id = m2.activity_id
          join tickets t2 on t2.id = a2.ticket_id
          where m2.queue_id = m.queue_id and m2.provider_thread_id = m.provider_thread_id
            and t2.deleted_at is null and t2.merged_into_id is null and t2.state = 'open'
        )`;

    const toArchive = await this.due(sql`
      select distinct m.queue_id, m.provider_thread_id as thread_id
      from email_messages m
      join activities a on a.id = m.activity_id
      join tickets t on t.id = a.ticket_id
      join mailbox_queues q on q.id = m.queue_id
      where m.inbox_archived_at is null and m.provider_thread_id is not null
        and (t.state in ('waiting', 'closed', 'archived') or t.deleted_at is not null)
        and ${mailboxOk} and not ${anyOpen}
      limit ${BATCH}`);
    const toUnarchive = await this.due(sql`
      select distinct m.queue_id, m.provider_thread_id as thread_id
      from email_messages m
      join mailbox_queues q on q.id = m.queue_id
      where m.inbox_archived_at is not null and m.provider_thread_id is not null
        and ${mailboxOk} and ${anyOpen}
      limit ${BATCH}`);

    const a = await this.apply(toArchive, 'archive');
    const u = await this.apply(toUnarchive, 'unarchive');
    return { archived: a.done, unarchived: u.done, failed: a.failed + u.failed };
  }

  private async due(query: SQL): Promise<Map<string, string[]>> {
    const rows = (await this.db.execute<{ queue_id: string; thread_id: string }>(query)).rows;
    const byQueue = new Map<string, string[]>();
    for (const r of rows) byQueue.set(r.queue_id, [...(byQueue.get(r.queue_id) ?? []), r.thread_id]);
    return byQueue;
  }

  private async apply(byQueue: Map<string, string[]>, action: 'archive' | 'unarchive') {
    let done = 0;
    let failed = 0;
    for (const [queueId, threadIds] of byQueue) {
      const [box] = await this.db.select().from(mailboxQueues).where(eq(mailboxQueues.id, queueId));
      if (!box) continue;
      try {
        const provider = this.providers[box.provider];
        if (action === 'archive') await provider.archiveThreads(this.mailboxes.ref(box), threadIds);
        else await provider.unarchiveThreads(this.mailboxes.ref(box), threadIds);
        await this.db
          .update(emailMessages)
          .set({ inboxArchivedAt: action === 'archive' ? new Date() : null })
          .where(and(eq(emailMessages.queueId, queueId), inArray(emailMessages.providerThreadId, threadIds)));
        done += threadIds.length;
      } catch (err) {
        failed += threadIds.length;
        this.log.warn(`${box.address}: could not ${action} ${threadIds.length} conversation(s): ${String(err)}`);
      }
    }
    return { done, failed };
  }
}
