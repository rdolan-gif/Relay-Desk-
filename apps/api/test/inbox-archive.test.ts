import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InboundService } from '../src/email/inbound.service';
import { InboxArchiveService } from '../src/email/inbox-archive.service';
import { GMAIL_MODIFY_SCOPE } from '../src/email/google-oauth.service';
import { MailboxesService } from '../src/email/mailboxes.service';
import { FakeMailProvider } from '../src/email/providers';
import { createPool } from '../src/db/db';
import { TEST_DATABASE_URL, createTestContext, loginAs, type Client, type TestContext } from './helpers';
import { SUPPORT, rawMail } from './mail-helpers';

/** Owner O-31: closing a ticket archives its conversation in Gmail, like the team's old habit. */
describe('archive in Gmail when a ticket closes', () => {
  let ctx: TestContext;
  let admin: Client;
  let fake: FakeMailProvider;
  let mailbox: string;
  const sql = async (text: string, params: unknown[] = []) => {
    const pool = createPool(TEST_DATABASE_URL);
    try {
      return (await pool.query(text, params)).rows;
    } finally {
      await pool.end();
    }
  };
  beforeEach(async () => {
    ctx = await createTestContext();
    fake = ctx.app.get(FakeMailProvider);
    fake.reset();
    admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    mailbox = ctx.ids.helpdesk.mailbox;
    // The inbox was connected with the permission archiving needs.
    await sql('update mailbox_queues set granted_scopes = $1 where id = $2', [
      `https://www.googleapis.com/auth/gmail.send ${GMAIL_MODIFY_SCOPE}`,
      mailbox,
    ]);
  });
  afterEach(async () => {
    await ctx.close();
  });

  const receive = async (thread: string, subject: string, extra: { inReplyTo?: string; messageId?: string } = {}) => {
    fake.deliver(SUPPORT, await rawMail({ from: 'dana@customer.example', subject, ...extra }), thread);
    const out = await ctx.app.get(InboundService).syncMailbox(mailbox);
    return (out.at(-1) as { ticketId: number }).ticketId;
  };
  const close = (id: number) =>
    admin.patch(`/api/tickets/${id}`, { state: 'closed', statusIds: [ctx.ids.helpdesk.statuses.resolved] });
  const run = () => ctx.app.get(InboxArchiveService).archivePending();
  const archived = () => fake.archived.get(SUPPORT) ?? [];

  it('closing a ticket archives its conversation once; open and waiting tickets stay in the inbox', async () => {
    const closed = await receive('t-closed', 'Done with this');
    const open = await receive('t-open', 'Still working');
    const waiting = await receive('t-waiting', 'Waiting on customer');
    await admin.patch(`/api/tickets/${waiting}`, { state: 'waiting', reopenAt: new Date(Date.now() + 86_400_000) });
    expect((await close(closed)).status).toBe(200);

    expect(await run()).toEqual({ archived: 1, failed: 0 });
    expect(archived()).toEqual(['t-closed']);
    expect(await run()).toEqual({ archived: 0, failed: 0 }); // never twice
    expect(open).toBeGreaterThan(0);
  });

  it('a deleted ticket (e.g. spam) is archived too', async () => {
    const spam = await receive('t-spam', 'You have won');
    expect((await admin.delete(`/api/tickets/${spam}`)).status).toBeLessThan(300);
    await run();
    expect(archived()).toEqual(['t-spam']);
  });

  it('the customer replying reopens the ticket; closing it again archives the conversation again', async () => {
    const id = await receive('t-1', 'Lamp quote', { messageId: 'first@customer.example' });
    await close(id);
    await run();
    const reply = await receive('t-1', 'Re: Lamp quote', { inReplyTo: 'first@customer.example' });
    expect(reply).toBe(id);
    expect((await admin.get(`/api/tickets/${id}`)).body.state).toBe('open');
    expect(await run()).toEqual({ archived: 0, failed: 0 }); // open again: left in the inbox
    await close(id);
    await run();
    expect(archived()).toEqual(['t-1', 't-1']);
  });

  it('a conversation shared with a ticket that is still open is left in the inbox', async () => {
    const a = await receive('t-shared', 'First');
    const b = await receive('t-shared', 'Different subject, same Gmail conversation');
    expect(b).not.toBe(a);
    await close(a);
    expect(await run()).toEqual({ archived: 0, failed: 0 });
    await close(b);
    await run();
    expect(archived()).toEqual(['t-shared']);
  });

  it('nothing is archived for an inbox with archiving off, or one connected before the permission existed', async () => {
    const id = await receive('t-x', 'Closed');
    await close(id);
    await sql('update mailbox_queues set archive_on_close = false where id = $1', [mailbox]);
    expect(await run()).toEqual({ archived: 0, failed: 0 });
    await sql(
      "update mailbox_queues set archive_on_close = true, granted_scopes = 'https://www.googleapis.com/auth/gmail.send' where id = $1",
      [mailbox],
    );
    expect(await run()).toEqual({ archived: 0, failed: 0 });
    const box = (
      (await admin.get('/api/settings/mailboxes')).body.mailboxes as { id: string; canArchive: boolean }[]
    ).find((m) => m.id === mailbox)!;
    expect(box.canArchive).toBe(false);
  });

  it('if Gmail refuses, the archive is retried on the next run', async () => {
    const id = await receive('t-retry', 'Closed');
    await close(id);
    fake.failNextArchive = 'Gmail is having a moment';
    expect(await run()).toEqual({ archived: 0, failed: 1 });
    expect(await run()).toEqual({ archived: 1, failed: 0 });
    expect(archived()).toEqual(['t-retry']);
  });

  it('reconnecting the same Gmail account keeps its place, so no email in between is skipped', async () => {
    await sql(
      "update mailbox_queues set address = 'support@relaydesk.local', connected_as = 'support@relaydesk.local', sync_cursor = '7' where id = $1",
      [mailbox],
    );
    const mailboxes = ctx.app.get(MailboxesService);
    await mailboxes.connect(mailbox, admin.userId, 'support@relaydesk.local', 'rt', GMAIL_MODIFY_SCOPE);
    expect((await sql('select sync_cursor, granted_scopes from mailbox_queues where id = $1', [mailbox]))[0]).toEqual({
      sync_cursor: '7',
      granted_scopes: GMAIL_MODIFY_SCOPE,
    });
  });
});
