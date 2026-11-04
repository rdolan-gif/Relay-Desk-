import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeMailProvider } from '../src/email/providers';
import { createTestContext, loginAs, type Client, type TestContext } from './helpers';
import { receive, sentCount, SUPPORT } from './mail-helpers';

/**
 * Phase 3 done-when (spec 20): "a reply with a changed subject threads to the right
 * ticket; a reply to an Archived ticket creates a new one; a no-reply sender routes to
 * Do not reply; an auto-reply never triggers our auto-response."
 */
describe('Phase 3 acceptance', () => {
  let ctx: TestContext;
  let agent: Client;
  let admin: Client;
  let mailbox: string;
  beforeEach(async () => {
    ctx = await createTestContext();
    ctx.app.get(FakeMailProvider).reset();
    agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    mailbox = ctx.ids.helpdesk.mailbox;
  });
  afterEach(async () => {
    await ctx.close();
  });

  /** Customer writes in; an agent replies from the ticket. Returns the ticket and our Message-ID. */
  async function conversation() {
    const first = await receive(ctx.app, mailbox, {
      from: 'Dana <dana@customer.example>',
      subject: 'Order 51873 missing a driver',
      messageId: 'c1@customer.example',
    });
    expect(first.outcome).toBe('created');
    const ticketId = (first as { ticketId: number }).ticketId;
    const acts = (await agent.get(`/api/tickets/${ticketId}/activities`)).body;
    const sent = await agent.post('/api/emails', {
      queueId: mailbox,
      ticketId,
      kind: 'reply',
      replyToActivityId: acts[0].id,
      to: ['dana@customer.example'],
      subject: 'Re: Order 51873 missing a driver',
      bodyHtml: '<p>We are sending one today.</p>',
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.status).toBe('sent');
    expect(sent.body.subject).toBe(`Re: Order 51873 missing a driver [#${ticketId}]`);
    return { ticketId, ourMessageId: sent.body.messageId as string };
  }

  it('when a customer replies with a changed subject, the email threads by its headers to the right ticket', async () => {
    const { ticketId, ourMessageId } = await conversation();
    const reply = await receive(ctx.app, mailbox, {
      from: 'dana@customer.example',
      subject: 'Different subject entirely',
      inReplyTo: ourMessageId,
      references: ['c1@customer.example', ourMessageId],
    });
    expect(reply).toMatchObject({ outcome: 'appended', ticketId });
    const acts = (await agent.get(`/api/tickets/${ticketId}/activities`)).body;
    expect(acts.map((a: { direction: string }) => a.direction)).toEqual(['in', 'out', 'in']);
    expect(acts[2].email.subject).toBe('Different subject entirely');
  });

  it('when a customer replies to an Archived ticket, a new ticket is created instead', async () => {
    const { ticketId, ourMessageId } = await conversation();
    expect(
      (
        await agent.patch(`/api/tickets/${ticketId}`, {
          state: 'archived',
          statusIds: [ctx.ids.helpdesk.statuses.resolved],
        })
      ).status,
    ).toBe(200);
    const reply = await receive(ctx.app, mailbox, {
      from: 'dana@customer.example',
      subject: 'Re: Order 51873 missing a driver',
      inReplyTo: ourMessageId,
      references: [ourMessageId],
    });
    expect(reply.outcome).toBe('created');
    expect((reply as { ticketId: number }).ticketId).not.toBe(ticketId);
  });

  it('when the sender is a no-reply address, the new ticket routes to Do not reply', async () => {
    const r = await receive(ctx.app, mailbox, { from: 'noreply@supplier.example', subject: 'Your weekly statement' });
    const t = (await admin.get(`/api/tickets/${(r as { ticketId: number }).ticketId}`)).body;
    expect(t.category.title).toBe('Do not reply');
    expect(t.priority).toBe('low');
  });

  it('when an auto-reply arrives, our auto-response is never sent (but a normal email gets one)', async () => {
    const tpl = await admin.post('/api/templates', {
      kind: 'auto_response',
      title: 'We have your email',
      subject: 'We have received your email',
      bodyHtml: '<p>Thanks {contact.name}, your reference is #{ticket.id}.</p>',
    });
    const box = (await admin.get('/api/settings/mailboxes')).body.mailboxes.find(
      (m: { id: string }) => m.id === mailbox,
    );
    const upd = await admin.put(`/api/settings/mailboxes/${mailbox}`, {
      ...box,
      autoResponseEnabled: true,
      autoResponseNewOnly: true,
      autoResponseTemplateId: tpl.body.id,
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);

    const normal = await receive(ctx.app, mailbox, { from: 'new.customer@example.com', subject: 'Quick question' });
    expect(normal).toMatchObject({ outcome: 'created', autoResponded: true });
    expect(sentCount(ctx.app)).toBe(1);
    const sentRaw = ctx.app.get(FakeMailProvider).sent.get(SUPPORT)![0]!.toString();
    expect(sentRaw).toMatch(/Auto-Submitted: auto-replied/i);
    expect(sentRaw).toContain(`[#${(normal as { ticketId: number }).ticketId}]`);

    const ooo = await receive(ctx.app, mailbox, {
      from: 'away@example.com',
      subject: 'Out of office',
      headers: { 'Auto-Submitted': 'auto-replied' },
    });
    expect(ooo).toMatchObject({ outcome: 'created', autoResponded: false });
    const listed = await receive(ctx.app, mailbox, {
      from: 'news@example.com',
      subject: 'Newsletter',
      headers: { Precedence: 'bulk' },
    });
    expect(listed).toMatchObject({ autoResponded: false });
    expect(sentCount(ctx.app)).toBe(1);

    // The auto-response does not count as a reply (spec 8).
    const t = (await admin.get(`/api/tickets/${(normal as { ticketId: number }).ticketId}`)).body;
    expect(t.firstAnswerAt).toBeNull();
  });
});
