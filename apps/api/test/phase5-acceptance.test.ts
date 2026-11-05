import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { zonedTime } from '@relay-desk/domain';
import { DB, type Db } from '../src/db/db';
import { mailboxQueues, tickets } from '../src/db/schema';
import { FakeMailProvider } from '../src/email/providers';
import { NotificationsService } from '../src/notifications/notifications.service';
import { RealtimeService } from '../src/notifications/realtime.service';
import { SlaService } from '../src/sla/sla.service';
import { createTestContext, loginAs, type Client, type TestContext } from './helpers';
import { receive, SUPPORT } from './mail-helpers';

const london = (y: number, m: number, d: number, h: number, mi = 0) =>
  new Date(zonedTime(y, m, d, h * 60 + mi, 'Europe/London'));

/**
 * Phase 5 done-when (spec 20): "a Waiting +2 days, Back macro sets the fields, saves and
 * returns to the list in one click." The click itself is in e2e/tests/phase5.spec.ts; here
 * the macro rules, notifications (spec 13) and presence run through the API.
 */
describe('Phase 5 acceptance', () => {
  let ctx: TestContext;
  let admin: Client;
  let agent: Client;
  let db: Db;
  beforeEach(async () => {
    ctx = await createTestContext();
    admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    db = ctx.app.get(DB);
  });
  afterEach(async () => {
    await ctx.close();
  });

  const support = () => ctx.ids.helpdesk.categories.support;
  const newTicket = async (c: Client, extra: Record<string, unknown> = {}) => {
    const res = await c.post('/api/tickets', { title: 'Phase 5 test', categoryId: support(), ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as number;
  };
  const inbox = async (c: Client) =>
    (await c.get('/api/me/notifications')).body as {
      items: { kind: string; ticketId: number; title: string; id: string }[];
      unread: number;
    };

  describe('macros (spec 10)', () => {
    it('"Waiting +2 days, Back" is offered on Support tickets and its save sets Waiting with a re-open time', async () => {
      const id = await newTicket(agent, { userId: agent.userId });
      const list = await agent.get(`/api/tickets/${id}/macros`);
      expect(list.status).toBe(200);
      const macro = list.body.macros.find((m: { title: string }) => m.title === 'Waiting +2 days');
      expect(macro.actions.map((a: { type: string }) => a.type)).toEqual(['set_state', 'set_reopen', 'back']);
      const reopenAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const res = await agent.patch(`/api/tickets/${id}`, { state: 'waiting', reopenAt, macroId: macro.id });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ state: 'waiting', reopenAt });
    });

    it('a macro is only available where it is enabled for the category and in the user’s rights', async () => {
      const intake = (
        await admin.post('/api/tickets', { title: 'Intake', categoryId: ctx.ids.helpdesk.categories.intake })
      ).body.id;
      expect((await admin.get(`/api/tickets/${intake}/macros`)).body.macros).toEqual([]);
      const res = await admin.patch(`/api/tickets/${intake}`, {
        state: 'waiting',
        macroId: ctx.ids.helpdesk.waitingMacro,
      });
      expect(res.status).toBe(404);
      expect(res.body.reason).toBe('unknown_macro');
      // Take the macro out of the agent's rights.
      const profiles = (await admin.get('/api/settings/rights-profiles')).body as { id: string; name: string }[];
      const standard = profiles.find((p) => p.name === 'Standard agent')!;
      const full = (await admin.get(`/api/settings/rights-profiles/${standard.id}`)).body;
      const { id: _id, ...input } = full;
      expect((await admin.put(`/api/settings/rights-profiles/${standard.id}`, { ...input, macros: [] })).status).toBe(
        200,
      );
      const t = await newTicket(admin);
      expect((await agent.get(`/api/tickets/${t}/macros`)).body.macros).toEqual([]);
    });

    it('a macro that sets a different user wins over "auto-fill User on close"', async () => {
      const id = await newTicket(agent);
      const res = await agent.patch(`/api/tickets/${id}`, {
        state: 'closed',
        statusIds: [ctx.ids.helpdesk.statuses.resolved],
        userId: admin.userId,
        macroId: ctx.ids.helpdesk.waitingMacro,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.userId).toBe(admin.userId);
    });

    it('macros are validated, can be cloned, and only admins manage them', async () => {
      const bad = await admin.post('/api/settings/macros', {
        title: 'Bad',
        actions: [{ type: 'back' }, { type: 'save' }],
      });
      expect(bad.status).toBe(400);
      expect(bad.body.reason).toBe('invalid_macro');
      const url = await admin.post('/api/settings/macros', {
        title: 'Bad URL',
        actions: [{ type: 'open_url', url: 'javascript:alert(1)' }],
      });
      expect(url.status).toBe(400);
      const clone = await admin.post(`/api/settings/macros/${ctx.ids.helpdesk.waitingMacro}/clone`);
      expect(clone.status).toBe(201);
      expect(clone.body).toMatchObject({
        title: 'Waiting +2 days (copy)',
        categoryIds: expect.arrayContaining([support()]),
      });
      expect((await agent.get('/api/settings/macros')).status).toBe(403);
    });
  });

  describe('notifications (spec 13)', () => {
    it('assignment notifies the new owner, never the person who caused it, and is pushed live', async () => {
      const pushed: unknown[] = [];
      const sub = ctx.app
        .get(RealtimeService)
        .stream(agent.userId)
        .subscribe((m) => m.type === 'notification' && pushed.push(m.data));
      const id = await newTicket(admin);
      expect((await admin.patch(`/api/tickets/${id}`, { userId: agent.userId })).status).toBe(200);
      sub.unsubscribe();
      const mine = await inbox(agent);
      expect(mine.items[0]).toMatchObject({ kind: 'assigned', ticketId: id });
      expect(mine.unread).toBe(1);
      expect(pushed).toHaveLength(1);
      expect((await inbox(admin)).items).toEqual([]);
    });

    it('a comment notifies the owner and followers; an @mention reaches someone who is not a follower; the author hears nothing', async () => {
      const id = await newTicket(agent, { userId: agent.userId });
      const res = await admin.post(`/api/tickets/${id}/comments`, {
        bodyHtml: '<p>Over to you</p>',
        mentionUserIds: [],
      });
      expect(res.status).toBe(201);
      expect((await inbox(agent)).items[0]).toMatchObject({ kind: 'activity', ticketId: id });
      // Admin commented, so now follows; the agent mentions a back-office user.
      const [bo] = ((await admin.get('/api/settings/users')).body as { id: string; email: string }[]).filter(
        (u: { email: string }) => u.email === 'backoffice@relaydesk.local',
      );
      await agent.post(`/api/tickets/${id}/comments`, { bodyHtml: '<p>Can you check?</p>', mentionUserIds: [bo!.id] });
      const backoffice = await loginAs(ctx.app, 'backoffice@relaydesk.local');
      expect((await inbox(backoffice)).items[0]).toMatchObject({ kind: 'mention', ticketId: id });
      expect((await inbox(admin)).items[0]).toMatchObject({ kind: 'activity', ticketId: id });
      expect((await inbox(agent)).items).toHaveLength(1);
    });

    it('a mention added while editing a comment notifies only that person', async () => {
      const id = await newTicket(agent, { userId: agent.userId });
      const c = await agent.post(`/api/tickets/${id}/comments`, { bodyHtml: '<p>Note</p>' });
      const edit = await agent.patch(`/api/tickets/${id}/comments/${c.body.id}`, {
        bodyHtml: '<p>Note for Ada</p>',
        mentionUserIds: [admin.userId],
      });
      expect(edit.status, JSON.stringify(edit.body)).toBe(200);
      expect((await inbox(admin)).items.map((n) => n.kind)).toEqual(['mention']);
    });

    it('an incoming email on my ticket notifies me; an auto-assigned email notifies whoever got it', async () => {
      const first = (await receive(ctx.app, ctx.ids.helpdesk.mailbox, {
        from: 'kim@example.com',
        subject: 'Order status',
        messageId: 'm1@example.com',
      })) as { ticketId: number };
      await admin.patch(`/api/tickets/${first.ticketId}`, { userId: agent.userId });
      await receive(ctx.app, ctx.ids.helpdesk.mailbox, {
        from: 'kim@example.com',
        subject: 'Re: Order status',
        inReplyTo: 'm1@example.com',
      });
      expect((await inbox(agent)).items.map((n) => n.kind)).toEqual(['activity', 'assigned']);
      await agent.put('/api/me/queues', { queueIds: [ctx.ids.helpdesk.mailbox] });
      await db.update(tickets).set({ userId: null }).where(eq(tickets.categoryId, support()));
      const next = (await receive(ctx.app, ctx.ids.helpdesk.mailbox, {
        from: 'lee@example.com',
        subject: 'New order',
      })) as { ticketId: number };
      expect((await inbox(agent)).items[0]).toMatchObject({ kind: 'assigned', ticketId: next.ticketId });
    });

    it('nobody is notified about a ticket in a category they cannot see', async () => {
      const id = (await admin.post('/api/tickets', { title: 'Hidden', categoryId: ctx.ids.helpdesk.categories.intake }))
        .body.id;
      expect((await admin.patch(`/api/tickets/${id}`, { userId: agent.userId })).status).toBe(200);
      expect((await inbox(agent)).items).toEqual([]);
    });

    it('entries can be marked read one at a time or all at once', async () => {
      for (const n of [1, 2])
        await admin.patch(`/api/tickets/${await newTicket(admin)}`, { userId: agent.userId, title: `T${n}` });
      const before = await inbox(agent);
      expect(before.unread).toBe(2);
      expect((await agent.post(`/api/me/notifications/${before.items[0]!.id}/read`)).body.unread).toBe(1);
      expect((await agent.post('/api/me/notifications/read-all')).body.unread).toBe(0);
      expect((await admin.post(`/api/me/notifications/${before.items[1]!.id}/read`)).body.unread).toBe(0);
      expect((await inbox(agent)).unread).toBe(0);
    });

    it('email rules per category: "New" sends a notification email from the notifications mailbox', async () => {
      await db
        .update(mailboxQueues)
        .set({ sendsNotifications: true })
        .where(eq(mailboxQueues.id, ctx.ids.helpdesk.mailbox));
      const rules = (await agent.get('/api/me/notification-rules')).body;
      expect(rules.emailAvailable).toBe(true);
      expect(
        rules.categories.some((c: { categoryId: string }) => c.categoryId === ctx.ids.helpdesk.categories.intake),
      ).toBe(false);
      const put = await agent.put('/api/me/notification-rules', {
        notificationEmail: 'alex.alerts@example.com',
        rules: [{ categoryId: support(), new: true }],
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      await receive(ctx.app, ctx.ids.helpdesk.mailbox, { from: 'new@example.com', subject: 'Brand new enquiry' });
      const sent = (ctx.app.get(FakeMailProvider).sent.get(SUPPORT) ?? []).map((b) => b.toString());
      const mail = sent.find((m) => /To: alex\.alerts@example\.com/.test(m));
      expect(mail).toBeDefined();
      expect(mail).toMatch(/Auto-Submitted: auto-generated/);
      expect(mail).toMatch(/Brand new enquiry/);
    });

    it('a failed email send is reported to the person who sent it', async () => {
      const id = await newTicket(agent, { userId: agent.userId });
      ctx.app.get(FakeMailProvider).failNextSend = 'Mailbox full';
      const res = await agent.post('/api/emails', {
        queueId: ctx.ids.helpdesk.mailbox,
        ticketId: id,
        to: ['x@example.com'],
        subject: 'Hi',
        bodyHtml: '<p>Hi</p>',
      });
      expect(res.body.status).toBe('failed');
      expect((await inbox(agent)).items[0]).toMatchObject({ kind: 'email_failed', ticketId: id });
    });

    it('SLA about to breach (30 working minutes before) and breached are each sent once', async () => {
      const id = await newTicket(admin, { priority: 'high', userId: agent.userId });
      const created = london(2026, 10, 13, 10);
      await db.update(tickets).set({ createdAt: created }).where(eq(tickets.id, id));
      await ctx.app.get(SlaService).refresh(db, [id], created);
      const svc = ctx.app.get(NotificationsService);
      // High: first reply due 11:00. At 10:20 nothing; at 10:35 a warning (once); at 11:10 a breach.
      await svc.slaSweep(london(2026, 10, 13, 10, 20));
      expect((await inbox(agent)).items.filter((n) => n.kind.startsWith('sla'))).toEqual([]);
      await svc.slaSweep(london(2026, 10, 13, 10, 35));
      await svc.slaSweep(london(2026, 10, 13, 10, 40));
      await svc.slaSweep(london(2026, 10, 13, 11, 10));
      const kinds = (await inbox(agent)).items.filter((n) => n.kind.startsWith('sla')).map((n) => n.kind);
      expect(kinds).toEqual(['sla_breached', 'sla_warning']);
    });
  });

  describe('presence (spec 13)', () => {
    it('each viewer sees who else has the ticket open, and who is editing', async () => {
      const id = await newTicket(admin);
      expect((await agent.post(`/api/tickets/${id}/presence`, { editing: false })).body).toEqual([]);
      const seen = await admin.post(`/api/tickets/${id}/presence`, { editing: true });
      expect(seen.body).toEqual([{ userId: agent.userId, name: 'Alex Agent', editing: false }]);
      expect((await agent.post(`/api/tickets/${id}/presence`, { editing: false })).body).toEqual([
        { userId: admin.userId, name: 'Ada Admin', editing: true },
      ]);
      await admin.post(`/api/tickets/${id}/presence/leave`);
      expect((await agent.post(`/api/tickets/${id}/presence`, {})).body).toEqual([]);
      const hidden = (
        await admin.post('/api/tickets', { title: 'Hidden', categoryId: ctx.ids.helpdesk.categories.intake })
      ).body.id;
      expect((await agent.post(`/api/tickets/${hidden}/presence`, {})).status).toBe(404);
    });
  });
});
