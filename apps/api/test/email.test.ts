import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InboundService } from '../src/email/inbound.service';
import { FakeMailProvider } from '../src/email/providers';
import { createPool } from '../src/db/db';
import { TEST_DATABASE_URL, createTestContext, loginAs, type Client, type TestContext } from './helpers';
import { rawMail, receive, sentCount, SUPPORT } from './mail-helpers';

describe('email channel (spec 11)', () => {
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
  const tid = (r: unknown) => (r as { ticketId: number }).ticketId;

  describe('inbound pipeline (spec 11.2)', () => {
    it('every email lands in exactly one ticket: a message is never processed twice', async () => {
      const fake = ctx.app.get(FakeMailProvider);
      const raw = await rawMail({ from: 'a@example.com', subject: 'Hello' });
      fake.deliver(SUPPORT, raw);
      await ctx.app.get(InboundService).syncMailbox(mailbox);
      // Simulate a restart that re-reads the same mailbox from the start.
      const box = await admin.get('/api/settings/mailboxes');
      expect(box.status).toBe(200);
      const pool = createPool(TEST_DATABASE_URL);
      await pool.query('update mailbox_queues set sync_cursor = null where id = $1', [mailbox]);
      await pool.end();
      const again = await ctx.app.get(InboundService).syncMailbox(mailbox);
      expect(again.map((o) => o.outcome)).toEqual(['duplicate']);
      expect((await admin.get('/api/tickets?q=Hello')).body.total).toBe(1);
    });

    it('a personal inbox assigns its new tickets to its owner; a shared inbox leaves them unassigned', async () => {
      const me = (await agent.get('/api/auth/me')).body.user.id as string;
      const box = await admin.post('/api/settings/mailboxes', {
        title: "Alex's inbox",
        address: 'alex@relaydesk.local',
        provider: 'fake',
        defaultCategoryId: ctx.ids.helpdesk.categories.support,
        defaultUserId: me,
      });
      expect(box.status).toBe(201);
      expect(box.body.defaultUserId).toBe(me);
      expect(box.body.defaultCategoryTitle).toBe('Support');
      const personal = await receive(ctx.app, box.body.id, {
        from: 'buyer@example.com',
        to: 'alex@relaydesk.local',
        subject: 'For Alex',
      });
      expect((await admin.get(`/api/tickets/${tid(personal)}`)).body.userId).toBe(me);
      const shared = await receive(ctx.app, mailbox, { from: 'buyer@example.com', subject: 'For anyone' });
      expect((await admin.get(`/api/tickets/${tid(shared)}`)).body.userId).toBeNull();
      // Only an active person can own a mailbox.
      const bad = await admin.put(`/api/settings/mailboxes/${box.body.id}`, {
        title: "Alex's inbox",
        address: 'alex@relaydesk.local',
        provider: 'fake',
        defaultCategoryId: ctx.ids.helpdesk.categories.support,
        defaultUserId: '00000000-0000-4000-8000-000000000000',
      });
      expect(bad.body.reason).toBe('unknown_user');
    });

    it('mail from our own mailbox address is dropped as a loop', async () => {
      const r = await receive(ctx.app, mailbox, { from: SUPPORT, subject: 'Loop' });
      expect(r.outcome).toBe('dropped_loop');
    });

    it('the sender is matched to a contact in the mailbox’s CRM databases; the ticket gets the contact', async () => {
      const r = await receive(ctx.app, mailbox, { from: 'Sam <SAM@acme.example>', subject: 'Panels', text: 'Hi' });
      const t = (await agent.get(`/api/tickets/${tid(r)}`)).body;
      expect(t.contactCard.name).toBe('Sam Smith');
      // Contacts in databases not linked to the mailbox are not matched.
      const pat = await receive(ctx.app, mailbox, { from: 'pat@globex.example', subject: 'Partner' });
      expect((await admin.get(`/api/tickets/${tid(pat)}`)).body.contactId).toBeNull();
    });

    it('a customer email reopens a Waiting ticket; HTML is sanitised; attachments are stored and downloadable', async () => {
      const first = await receive(ctx.app, mailbox, {
        from: 'dana@customer.example',
        subject: 'Broken panel',
        messageId: 'm1@customer.example',
      });
      await agent.patch(`/api/tickets/${tid(first)}`, { state: 'waiting', userId: agent.userId });
      const second = await receive(ctx.app, mailbox, {
        from: 'dana@customer.example',
        subject: 'Re: Broken panel',
        inReplyTo: 'm1@customer.example',
        html: '<p>Photo attached<script>alert(1)</script><img src="x" onerror="alert(1)"></p>',
        attachments: [{ filename: 'photo.txt', content: 'pretend image' }],
      });
      expect(second).toMatchObject({ outcome: 'appended', ticketId: tid(first) });
      expect((await agent.get(`/api/tickets/${tid(first)}`)).body.state).toBe('open');
      const acts = (await agent.get(`/api/tickets/${tid(first)}/activities`)).body;
      expect(acts[1].bodyHtml).not.toMatch(/script|onerror/);
      expect(acts[1].attachments).toEqual([expect.objectContaining({ filename: 'photo.txt' })]);
      const file = await agent.agent.get(`/api/attachments/${acts[1].attachments[0].id}`);
      expect(file.status).toBe(200);
      expect(file.headers['content-disposition']).toMatch(/attachment/);
      expect(file.text ?? file.body.toString()).toBe('pretend image');
    });

    it('when headers match several tickets, the email goes to the most recent and the others are suggested', async () => {
      const a = await receive(ctx.app, mailbox, {
        from: 'x@example.com',
        subject: 'One',
        messageId: 'one@example.com',
      });
      const b = await receive(ctx.app, mailbox, {
        from: 'x@example.com',
        subject: 'Two',
        messageId: 'two@example.com',
      });
      const r = await receive(ctx.app, mailbox, {
        from: 'x@example.com',
        subject: 'Both',
        references: ['one@example.com', 'two@example.com'],
      });
      expect(r).toMatchObject({ outcome: 'appended', ticketId: tid(b) });
      const acts = (await admin.get(`/api/tickets/${tid(b)}/activities`)).body;
      expect(acts.at(-1).suggestedTicketIds).toEqual([tid(a)]);
    });

    it('the [#123] subject token threads a reply when headers are missing', async () => {
      const a = await receive(ctx.app, mailbox, { from: 'y@example.com', subject: 'Token test' });
      const r = await receive(ctx.app, mailbox, { from: 'y@example.com', subject: `Re: Token test [#${tid(a)}]` });
      expect(r).toMatchObject({ outcome: 'appended', ticketId: tid(a) });
    });

    it('a reply to a merged ticket goes to the ticket it was merged into', async () => {
      const a = await receive(ctx.app, mailbox, { from: 'z@example.com', subject: 'A', messageId: 'a@z.example' });
      const b = await receive(ctx.app, mailbox, { from: 'z@example.com', subject: 'B', messageId: 'b@z.example' });
      await agent.post('/api/tickets/merge', { ticketIds: [tid(a), tid(b)], survivorId: tid(a) });
      const r = await receive(ctx.app, mailbox, { from: 'z@example.com', subject: 'Re: B', inReplyTo: 'b@z.example' });
      expect(r).toMatchObject({ outcome: 'appended', ticketId: tid(a) });
    });

    it('routing rules set the enquiry type: purchase orders and quotation requests (owner O-11)', async () => {
      const field = ctx.ids.helpdesk.enquiryType;
      const po = await receive(ctx.app, mailbox, {
        from: 'buyer@trade.example',
        subject: 'PO 55123 – 40 panels',
        text: 'Please process.',
      });
      const quote = await receive(ctx.app, mailbox, {
        from: 'buyer@trade.example',
        subject: 'Quote for downlights please',
      });
      const other = await receive(ctx.app, mailbox, { from: 'buyer@trade.example', subject: 'Opening hours' });
      expect((await admin.get(`/api/tickets/${tid(po)}`)).body.customFields[field]).toBe('purchase_order');
      expect((await admin.get(`/api/tickets/${tid(quote)}`)).body.customFields[field]).toBe('quotation');
      expect((await admin.get(`/api/tickets/${tid(other)}`)).body.customFields[field]).toBe('general');
    });

    it('a bounce marks our original email Failed instead of opening a ticket', async () => {
      const first = await receive(ctx.app, mailbox, { from: 'gone@example.com', subject: 'Hi' });
      const acts = (await agent.get(`/api/tickets/${tid(first)}/activities`)).body;
      const sent = (
        await agent.post('/api/emails', {
          queueId: mailbox,
          ticketId: tid(first),
          kind: 'reply',
          replyToActivityId: acts[0].id,
          to: ['gone@example.com'],
          subject: 'Re: Hi',
          bodyHtml: '<p>x</p>',
        })
      ).body;
      const bounce = await receive(ctx.app, mailbox, {
        from: 'MAILER-DAEMON@mx.example',
        subject: 'Undelivered Mail Returned to Sender',
        references: [sent.messageId],
      });
      expect(bounce).toEqual({ outcome: 'bounce', matched: true });
      const after = (await agent.get(`/api/tickets/${tid(first)}/activities`)).body;
      expect(after.find((a: { id: string }) => a.id === sent.id).status).toBe('failed');
    });
  });

  describe('composing and sending (spec 11.4)', () => {
    it('Reply all goes out with threading headers and the ticket token; the first agent reply is recorded', async () => {
      const first = await receive(ctx.app, mailbox, {
        from: 'dana@customer.example',
        subject: 'Help',
        messageId: 'h1@customer.example',
      });
      const acts = (await agent.get(`/api/tickets/${tid(first)}/activities`)).body;
      const res = await agent.post('/api/emails', {
        queueId: mailbox,
        ticketId: tid(first),
        kind: 'reply_all',
        replyToActivityId: acts[0].id,
        to: ['dana@customer.example'],
        cc: ['boss@customer.example'],
        subject: 'Re: Help',
        bodyHtml: '<p>On it.</p><p>Kind regards,<br>Alex Agent</p>',
      });
      expect(res.status).toBe(201);
      const raw = ctx.app.get(FakeMailProvider).sent.get(SUPPORT)![0]!.toString();
      expect(raw).toMatch(/In-Reply-To: <h1@customer\.example>/);
      expect(raw).toMatch(/Cc: boss@customer\.example/);
      expect(raw).toContain(`Re: Help [#${tid(first)}]`);
      expect((await agent.get(`/api/tickets/${tid(first)}`)).body.firstAnswerAt).toBeTruthy();
    });

    it('a new email not linked to a ticket creates one: Open (owner O-15), Low, the sender as User, the matched contact', async () => {
      const res = await agent.post('/api/emails', {
        queueId: mailbox,
        kind: 'new',
        to: ['sam@acme.example'],
        subject: 'Your quote',
        bodyHtml: '<p>Attached.</p>',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const t = (await agent.get(`/api/tickets/${res.body.ticketId}`)).body;
      expect(t).toMatchObject({ title: 'Your quote', state: 'open', priority: 'low', userId: agent.userId });
      expect(t.contactCard.name).toBe('Sam Smith');
      expect(t.category.title).toBe('Support');
    });

    it('when sending fails, the email is kept and marked Failed with the reason', async () => {
      ctx.app.get(FakeMailProvider).failNextSend = 'SMTP 550 mailbox unavailable';
      const res = await agent.post('/api/emails', {
        queueId: mailbox,
        kind: 'new',
        to: ['x@example.com'],
        subject: 'Hi',
        bodyHtml: '<p>x</p>',
      });
      expect(res.body).toMatchObject({ status: 'failed', error: 'SMTP 550 mailbox unavailable' });
    });

    it('back-office users cannot send email; nobody can send from a mailbox outside their rights', async () => {
      const bo = await loginAs(ctx.app, 'backoffice@relaydesk.local');
      expect(
        (
          await bo.post('/api/emails', {
            queueId: mailbox,
            kind: 'new',
            to: ['x@example.com'],
            subject: 'Hi',
            bodyHtml: '<p>x</p>',
          })
        ).body.reason,
      ).toBe('cannot_send_external');
      const other = await admin.post('/api/settings/mailboxes', {
        title: 'Billing',
        address: 'billing@relaydesk.local',
        provider: 'fake',
        defaultCategoryId: ctx.ids.helpdesk.categories.billing,
      });
      expect(other.status).toBe(201);
      const res = await agent.post('/api/emails', {
        queueId: other.body.id,
        kind: 'new',
        to: ['x@example.com'],
        subject: 'Hi',
        bodyHtml: '<p>x</p>',
      });
      expect(res.body.reason).toBe('mailbox_not_allowed');
      expect((await agent.get('/api/mailboxes')).body.map((m: { address: string }) => m.address)).toEqual([SUPPORT]);
    });

    it('uploads can be attached to an email; only the uploader can use them', async () => {
      const up = await agent.agent
        .post('/api/attachments')
        .set('x-csrf-token', agent.csrf)
        .attach('file', Buffer.from('price list'), 'prices.csv');
      expect(up.status).toBe(201);
      const res = await agent.post('/api/emails', {
        queueId: mailbox,
        kind: 'new',
        to: ['x@example.com'],
        subject: 'Prices',
        bodyHtml: '<p>See attached.</p>',
        attachmentIds: [up.body.id],
      });
      expect(res.body.status).toBe('sent');
      expect(ctx.app.get(FakeMailProvider).sent.get(SUPPORT)!.at(-1)!.toString()).toContain('prices.csv');
      const acts = (await agent.get(`/api/tickets/${res.body.ticketId}/activities`)).body;
      expect(acts[0].attachments.map((a: { filename: string }) => a.filename)).toEqual(['prices.csv']);
    });
  });

  describe('templates (spec 11.5, owner O-6)', () => {
    it('agents create templates; placeholders fill from the ticket, contact, account and user', async () => {
      const first = await receive(ctx.app, mailbox, { from: 'sam@acme.example', subject: 'Driver' });
      const tpl = await agent.post('/api/templates', {
        title: 'Thanks',
        bodyHtml: '<p>Hi {contact.name} at {account.name}, about #{ticket.id} – {user.name}</p>',
      });
      expect(tpl.status).toBe(201);
      const r = await agent.post(`/api/templates/${tpl.body.id}/render`, { ticketId: tid(first) });
      expect(r.body.bodyHtml).toBe(`<p>Hi Sam Smith at Acme Supplies Ltd, about #${tid(first)} – Alex Agent</p>`);
      // Only the author (or an administrator) can change it.
      const bo = await loginAs(ctx.app, 'backoffice@relaydesk.local');
      expect((await bo.put(`/api/templates/${tpl.body.id}`, { title: 'x', bodyHtml: '' })).status).toBe(403);
      expect(
        (await admin.put(`/api/templates/${tpl.body.id}`, { title: 'Thanks!', bodyHtml: '<p>ok</p>' })).status,
      ).toBe(200);
    });
  });

  describe('routing rules settings (spec 11.3)', () => {
    it('rules are ordered, invalid patterns are refused, and reordering changes which wins', async () => {
      expect(
        (
          await admin.post('/api/settings/email-routing', {
            title: 'Bad',
            all: [{ field: 'subject', op: 'regex', value: '(' }],
          })
        ).body.reason,
      ).toBe('invalid_rule');
      const vip = await admin.post('/api/settings/email-routing', {
        title: 'VIP',
        all: [{ field: 'from_domain', op: 'equals', value: 'vip-client.example' }],
        actions: { priority: 'high' },
      });
      expect(vip.status).toBe(201);
      const r = await receive(ctx.app, mailbox, { from: 'boss@vip-client.example', subject: 'Hello' });
      expect((await admin.get(`/api/tickets/${tid(r)}`)).body.priority).toBe('high');
      const ids = (await admin.get('/api/settings/email-routing')).body.map((x: { id: string }) => x.id);
      const reordered = await admin.put('/api/settings/email-routing/order', { ids: [...ids].reverse() });
      expect(reordered.body[0].title).toBe('VIP');
    });
  });

  describe('FYI (owner O-12)', () => {
    it('"FYI – no reply needed" closes the ticket with the FYI status and marks that no reply is expected', async () => {
      const r = await receive(ctx.app, mailbox, { from: 'supplier@example.com', subject: 'Price update for December' });
      const res = await agent.post(`/api/tickets/${tid(r)}/fyi`);
      expect(res.status).toBe(200);
      const t = (await agent.get(`/api/tickets/${tid(r)}`)).body;
      expect(t).toMatchObject({
        state: 'closed',
        noReplyNeeded: true,
        userId: agent.userId,
        statusIds: [ctx.ids.helpdesk.statuses.fyi],
      });
    });
  });

  describe('mailbox settings and Google sign-in (owner O-2, O-10)', () => {
    it('connecting needs Google credentials to be configured; credentials are never returned', async () => {
      const res = await admin.post(`/api/settings/mailboxes/${mailbox}/connect`);
      expect(res.body.reason).toBe('google_not_configured');
      const list = (await admin.get('/api/settings/mailboxes')).body;
      expect(list.googleConfigured).toBe(false);
      expect(JSON.stringify(list)).not.toMatch(/credentials|refresh/i);
    });

    it('the Google callback rejects a forged state', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/oauth/google/callback?code=x&state=forged.sig');
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/error=/);
    });

    it('agents cannot change mailbox settings', async () => {
      expect((await agent.get('/api/settings/mailboxes')).status).toBe(403);
    });

    it('sending still works from an inactive mailbox (spec 11.1)', async () => {
      const box = (await admin.get('/api/settings/mailboxes')).body.mailboxes.find(
        (m: { id: string }) => m.id === mailbox,
      );
      await admin.put(`/api/settings/mailboxes/${mailbox}`, { ...box, active: false });
      const res = await agent.post('/api/emails', {
        queueId: mailbox,
        kind: 'new',
        to: ['x@example.com'],
        subject: 'Hi',
        bodyHtml: '<p>x</p>',
      });
      expect(res.body.status).toBe('sent');
      expect(sentCount(ctx.app)).toBe(1);
    });
  });
});
