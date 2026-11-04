import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { zonedTime } from '@relay-desk/domain';
import { DB, type Db } from '../src/db/db';
import { queueLogins, rightsProfileCategories, tickets, users } from '../src/db/schema';
import { DistributionService } from '../src/sla/distribution.service';
import { SlaService } from '../src/sla/sla.service';
import { SlaSettingsService } from '../src/sla/sla-settings.service';
import { TicketJobsService } from '../src/tickets/ticket-jobs.service';
import { createTestContext, loginAs, type Client, type TestContext } from './helpers';
import { receive } from './mail-helpers';

/** A London wall-clock time. */
const london = (y: number, m: number, d: number, h: number, mi = 0) =>
  new Date(zonedTime(y, m, d, h * 60 + mi, 'Europe/London'));

/**
 * Phase 4 done-when (spec 20): "all SLA tests in section 8 pass, and with limit 2 and
 * three new tickets for one eligible agent, the third waits in backlog until one goes to
 * Waiting." The section 8 maths is unit-tested in packages/domain/src/sla.test.ts; here
 * the same rules run through the API, the database and the jobs.
 */
describe('Phase 4 acceptance', () => {
  let ctx: TestContext;
  let admin: Client;
  let agent: Client;
  let db: Db;
  let sla: SlaService;
  beforeEach(async () => {
    ctx = await createTestContext();
    admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    db = ctx.app.get(DB);
    sla = ctx.app.get(SlaService);
  });
  afterEach(async () => {
    await ctx.close();
  });

  const support = () => ctx.ids.helpdesk.categories.support;
  const mailbox = () => ctx.ids.helpdesk.mailbox;
  const newTicket = async (extra: Record<string, unknown> = {}) => {
    const res = await admin.post('/api/tickets', { title: 'SLA test', categoryId: support(), ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as number;
  };
  /** Moves a ticket's creation to a fixed time and recomputes its SLA as of then. */
  const createdAt = async (id: number, at: Date) => {
    await db.update(tickets).set({ createdAt: at }).where(eq(tickets.id, id));
    await sla.refresh(db, [id], at);
  };
  const row = async (id: number) => (await db.select().from(tickets).where(eq(tickets.id, id)))[0]!;

  describe('SLA (spec 8) through the API', () => {
    it('Response 1 h + Solution 8 h (High on Support), created 10:00 Tuesday: first answer due 11:00 Tuesday, deadline 11:00 Wednesday', async () => {
      const id = await newTicket({ priority: 'high' });
      await createdAt(id, london(2026, 10, 13, 10));
      const t = await row(id);
      expect(t.firstAnswerDeadline).toEqual(london(2026, 10, 13, 11));
      expect(t.deadline).toEqual(london(2026, 10, 14, 11));
    });

    it('Waiting from 12:00 to 15:00 the same working day moves the deadline 3 working hours later', async () => {
      const id = await newTicket({ priority: 'normal' });
      await createdAt(id, london(2026, 10, 13, 10));
      // Normal: 4 h + 16 h = 20 working hours from Tue 10:00 → Thu 14:00 (Mon–Fri 09–17).
      expect((await row(id)).deadline).toEqual(london(2026, 10, 15, 14));
      await db.update(tickets).set({ state: 'waiting' }).where(eq(tickets.id, id));
      await sla.refresh(db, [id], london(2026, 10, 13, 12));
      await db.update(tickets).set({ state: 'open' }).where(eq(tickets.id, id));
      await sla.refresh(db, [id], london(2026, 10, 13, 15));
      const t = await row(id);
      expect(t.slaPausedSeconds).toBe(3 * 3600);
      expect(t.deadline).toEqual(london(2026, 10, 15, 17));
    });

    it("when the contact's account has its own SLA, its times are used with the category's working hours", async () => {
      const own = await admin.post('/api/settings/slas', {
        title: 'Key accounts',
        unit: 'hours',
        targets: { low: { solution: 2 }, normal: { solution: 2 }, high: { solution: 2 } },
      });
      expect(own.status, JSON.stringify(own.body)).toBe(201);
      const acc = await admin.post('/api/crm/accounts', {
        databaseId: ctx.ids.crm.customersDb,
        name: 'Key Customer Ltd',
        slaId: own.body.id,
      });
      expect(acc.status, JSON.stringify(acc.body)).toBe(201);
      const contact = await admin.post('/api/crm/contacts', {
        databaseId: ctx.ids.crm.customersDb,
        name: 'Kim Key',
        emails: ['kim@key.example'],
        accountId: acc.body.id,
        customFields: { [ctx.ids.crm.fields.customerType]: 'business' },
      });
      expect(contact.status, JSON.stringify(contact.body)).toBe(201);
      const id = await newTicket({ contactId: contact.body.id });
      // Friday 16:00 + 2 working hours (category hours Mon–Fri 09–17) → Monday 10:00.
      await createdAt(id, london(2026, 10, 9, 16));
      expect((await row(id)).deadline).toEqual(london(2026, 10, 12, 10));
      expect((await row(id)).firstAnswerDeadline).toBeNull();

      // Removing the account SLA hands the ticket back to the category's SLA.
      expect((await admin.patch(`/api/crm/accounts/${acc.body.id}`, { slaId: null })).status).toBe(200);
      expect((await row(id)).firstAnswerDeadline).toEqual(london(2026, 10, 12, 12));
    });

    it('priority changes recalculate the deadline; a manual deadline is never recalculated', async () => {
      const id = await newTicket({ priority: 'normal' });
      await createdAt(id, london(2026, 10, 13, 10));
      const patch = (body: object) => admin.patch(`/api/tickets/${id}`, { ...body, version: undefined });
      expect((await patch({ priority: 'high' })).status).toBe(200);
      expect((await row(id)).deadline).toEqual(london(2026, 10, 14, 11));
      const manual = '2026-12-01T09:00:00.000Z';
      expect((await patch({ deadline: manual })).status).toBe(200);
      expect((await row(id)).deadlineManual).toBe(true);
      expect((await patch({ priority: 'low' })).status).toBe(200);
      expect((await row(id)).deadline).toEqual(new Date(manual));
      // Saving the form again with the same deadline keeps it manual; clearing it hands it back.
      expect((await patch({ deadline: manual, title: 'Renamed' })).status).toBe(200);
      expect((await row(id)).deadlineManual).toBe(true);
      expect((await patch({ deadline: null })).status).toBe(200);
      expect((await row(id)).deadlineManual).toBe(false);
      // Low: 8 h + 40 h = 48 working hours from Tue 10:00 → Wed of the next week 10:00.
      expect((await row(id)).deadline).toEqual(london(2026, 10, 21, 10));
    });

    it('an agent email is the first answer and sets first_answer_met; an auto-response does not count', async () => {
      const tpl = await admin.post('/api/templates', {
        kind: 'auto_response',
        title: 'Got it',
        bodyHtml: '<p>Thanks</p>',
      });
      const box = (await admin.get('/api/settings/mailboxes')).body.mailboxes.find(
        (m: { id: string }) => m.id === mailbox(),
      );
      await admin.put(`/api/settings/mailboxes/${mailbox()}`, {
        ...box,
        autoResponseEnabled: true,
        autoResponseTemplateId: tpl.body.id,
      });
      const got = await receive(ctx.app, mailbox(), { from: 'buyer@example.com', subject: 'Price please' });
      const id = (got as { ticketId: number }).ticketId;
      expect(got).toMatchObject({ autoResponded: true });
      let t = await row(id);
      expect(t.firstAnswerAt).toBeNull();
      expect(t.firstAnswerMet).toBeNull();
      expect(t.firstAnswerDeadline).not.toBeNull();
      const sent = await agent.post('/api/emails', {
        queueId: mailbox(),
        ticketId: id,
        to: ['buyer@example.com'],
        subject: 'Re: Price please',
        bodyHtml: '<p>£10</p>',
      });
      expect(sent.status, JSON.stringify(sent.body)).toBe(201);
      t = await row(id);
      expect(t.firstAnswerAt).not.toBeNull();
      expect(t.firstAnswerMet).toBe(true);
    });

    it('the minute job freezes a missed first answer and a breached Open ticket', async () => {
      const id = await newTicket({ priority: 'high' });
      await createdAt(id, london(2026, 10, 13, 10));
      await ctx.app.get(TicketJobsService).tick(london(2026, 10, 14, 12));
      const t = await row(id);
      expect(t.firstAnswerMet).toBe(false);
      expect(t.solutionMet).toBe(false);
      // Closing later does not turn the frozen outcome into met.
      expect(
        (await admin.patch(`/api/tickets/${id}`, { state: 'closed', statusIds: [ctx.ids.helpdesk.statuses.resolved] }))
          .status,
      ).toBe(200);
      expect((await row(id)).solutionMet).toBe(false);
    });

    it('closing in time sets solution_met; FYI tickets never count as a missed first answer', async () => {
      const closed = await newTicket({ priority: 'low' });
      expect(
        (
          await admin.patch(`/api/tickets/${closed}`, {
            state: 'closed',
            statusIds: [ctx.ids.helpdesk.statuses.resolved],
          })
        ).status,
      ).toBe(200);
      expect((await row(closed)).solutionMet).toBe(true);
      const fyi = await newTicket({ priority: 'high' });
      expect((await admin.post(`/api/tickets/${fyi}/fyi`)).status).toBe(200);
      await ctx.app.get(TicketJobsService).tick(new Date(Date.now() + 30 * 86_400_000));
      expect(await row(fyi)).toMatchObject({ noReplyNeeded: true, firstAnswerMet: null, solutionMet: true });
    });

    it('lists and the ticket show the SLA icon state; no SLA means no icon', async () => {
      const id = await newTicket({ priority: 'high' });
      const one = (await admin.get(`/api/tickets/${id}`)).body;
      expect(one.sla.indicator).toMatchObject({ kind: 'response', status: 'counting' });
      const list = (await admin.get('/api/tickets?pageSize=200')).body.items as {
        id: number;
        sla: { indicator: unknown };
      }[];
      expect(list.find((x) => x.id === id)!.sla.indicator).toMatchObject({ kind: 'response' });
      const billing = await admin.post('/api/tickets', {
        title: 'No SLA',
        categoryId: ctx.ids.helpdesk.categories.billing,
      });
      expect((await admin.get(`/api/tickets/${billing.body.id}`)).body.sla.indicator).toBeNull();
    });

    it("changing a category's SLA or working hours recalculates its tickets", async () => {
      const id = await newTicket({ priority: 'high' });
      await createdAt(id, london(2026, 10, 13, 10));
      const cat = (await admin.get(`/api/settings/categories/${support()}`)).body;
      const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...input } = cat;
      const res = await admin.put(`/api/settings/categories/${support()}`, { ...input, timeGroupId: null });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // 24/7 now: 1 h + 8 h from Tue 10:00 → Tue 19:00.
      expect((await row(id)).deadline).toEqual(london(2026, 10, 13, 19));
    });
  });

  describe('SLA and working-hours settings', () => {
    it('SLAs are validated; one based on the enquiry type needs a target for every value plus "anything else" (owner O-11)', async () => {
      const bad = await admin.post('/api/settings/slas', {
        title: 'Bad',
        unit: 'hours',
        targets: { low: { solution: 1 } },
      });
      expect(bad.status).toBe(400);
      expect(bad.body.reason).toBe('invalid_sla');
      const missing = await admin.post('/api/settings/slas', {
        title: 'Reply targets',
        basisFieldId: ctx.ids.helpdesk.enquiryType,
        targets: { purchase_order: { response: 2, solution: 40 }, quotation: { response: 4, solution: 40 } },
      });
      expect(missing.status).toBe(400);
      const ok = await admin.post('/api/settings/slas', {
        title: 'Reply targets',
        basisFieldId: ctx.ids.helpdesk.enquiryType,
        targets: {
          purchase_order: { response: 2, solution: 40 },
          quotation: { response: 4, solution: 40 },
          general: { response: 8, solution: 40 },
          _other: { response: 8, solution: 40 },
        },
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    });

    it('a purchase order email gets a 2-hour reply target from the enquiry-type SLA', async () => {
      const replyTargets = await admin.post('/api/settings/slas', {
        title: 'Reply targets',
        basisFieldId: ctx.ids.helpdesk.enquiryType,
        targets: {
          purchase_order: { response: 2, solution: 40 },
          quotation: { response: 4, solution: 40 },
          general: { response: 8, solution: 40 },
          _other: { response: 8, solution: 40 },
        },
      });
      const cat = (await admin.get(`/api/settings/categories/${support()}`)).body;
      const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...input } = cat;
      await admin.put(`/api/settings/categories/${support()}`, {
        ...input,
        slaId: replyTargets.body.id,
        timeGroupId: null,
      });
      const po = await receive(ctx.app, mailbox(), { from: 'orders@example.com', subject: 'Purchase order 4471' });
      const t = await row((po as { ticketId: number }).ticketId);
      expect(t.customFields[ctx.ids.helpdesk.enquiryType]).toBe('purchase_order');
      expect(t.firstAnswerDeadline!.getTime() - t.createdAt.getTime()).toBe(2 * 3600_000);
    });

    it('time groups are validated, and UK bank holidays are imported (from the built-in list when GOV.UK is unreachable)', async () => {
      const bad = await admin.post('/api/settings/time-groups', {
        title: 'Bad',
        timezone: 'Mars/Base',
        week: [[], [], [], [], [], [], []],
      });
      expect(bad.status).toBe(400);
      expect(bad.body.reason).toBe('invalid_time_group');
      const tg = await admin.post('/api/settings/time-groups', {
        title: 'Warehouse',
        week: [[{ start: '07:00', end: '15:00' }], [], [], [], [], [], []],
      });
      expect(tg.status, JSON.stringify(tg.body)).toBe(201);
      const auth = { user: { id: admin.userId } } as never;
      const offline = (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch;
      const res = await ctx.app.get(SlaSettingsService).importBankHolidays(auth, tg.body.id, null, offline);
      expect(res.source).toBe('built-in');
      expect(res.exceptions.some((e) => e.date === '2026-12-25')).toBe(true);
      const again = await ctx.app.get(SlaSettingsService).importBankHolidays(auth, tg.body.id, null, offline);
      expect(again.added).toBe(0);
    });

    it('SLAs and working hours in use cannot be deleted; agents cannot open these settings', async () => {
      expect((await admin.delete(`/api/settings/slas/${ctx.ids.helpdesk.standardSla}`)).status).toBe(409);
      expect((await admin.delete(`/api/settings/time-groups/${ctx.ids.helpdesk.officeHours}`)).status).toBe(409);
      expect((await agent.get('/api/settings/slas')).status).toBe(403);
      expect((await agent.get('/api/settings/time-groups')).status).toBe(403);
    });
  });

  describe('distribution (spec 9)', () => {
    // The demo seed gives the agent an Open Support ticket; start each test with none.
    beforeEach(async () => {
      await db.update(tickets).set({ userId: null }).where(eq(tickets.categoryId, support()));
    });
    const setLimit = async (limit: number | null) => {
      const [u] = await db.select().from(users).where(eq(users.email, 'agent@relaydesk.local'));
      await db
        .update(rightsProfileCategories)
        .set({ distribute: limit !== null, distributionLimit: limit })
        .where(
          and(
            eq(rightsProfileCategories.rightsProfileId, u!.rightsProfileId!),
            eq(rightsProfileCategories.categoryId, support()),
          ),
        );
    };
    const mail = async (n: number) =>
      (await receive(ctx.app, mailbox(), { from: `customer${n}@example.com`, subject: `Question ${n}` })) as {
        ticketId: number;
      };

    it('with limit 2 and three new tickets for one eligible agent, the third waits in backlog until one goes to Waiting', async () => {
      await setLimit(2);
      const ready = await agent.put('/api/me/queues', { queueIds: [mailbox()] });
      expect(ready.status, JSON.stringify(ready.body)).toBe(200);
      expect(ready.body.find((q: { id: string }) => q.id === mailbox()).ready).toBe(true);
      const [a, b, c] = [await mail(1), await mail(2), await mail(3)];
      expect((await row(a.ticketId)).userId).toBe(agent.userId);
      expect((await row(b.ticketId)).userId).toBe(agent.userId);
      expect((await row(c.ticketId)).userId).toBeNull();
      const res = await agent.patch(`/api/tickets/${a.ticketId}`, { state: 'waiting' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await row(c.ticketId)).userId).toBe(agent.userId);
    });

    it('nobody gets tickets until they are "Ready for email"; logging in takes the oldest backlog tickets first', async () => {
      await setLimit(1);
      const first = await mail(1);
      const second = await mail(2);
      expect((await row(first.ticketId)).userId).toBeNull();
      await agent.put('/api/me/queues', { queueIds: [mailbox()] });
      expect((await row(first.ticketId)).userId).toBe(agent.userId);
      expect((await row(second.ticketId)).userId).toBeNull();
    });

    it('with distribution switched off nothing is assigned; Ready stays on after signing out until turned off (owner O-16)', async () => {
      await setLimit(null);
      await agent.put('/api/me/queues', { queueIds: [mailbox()] });
      expect((await row((await mail(1)).ticketId)).userId).toBeNull();
      await setLimit(3);
      await agent.post('/api/auth/logout');
      expect((await row((await mail(2)).ticketId)).userId).toBe(agent.userId);
      const again = await loginAs(ctx.app, 'agent@relaydesk.local');
      await again.put('/api/me/queues', { queueIds: [] });
      expect((await row((await mail(3)).ticketId)).userId).toBeNull();
    });

    it('with no cap, enquiries go to whoever has the fewest open, however many they have (owner O-16)', async () => {
      const [u] = await db.select().from(users).where(eq(users.email, 'agent@relaydesk.local'));
      await db
        .update(rightsProfileCategories)
        .set({ distribute: true, distributionLimit: null })
        .where(
          and(
            eq(rightsProfileCategories.rightsProfileId, u!.rightsProfileId!),
            eq(rightsProfileCategories.categoryId, support()),
          ),
        );
      await agent.put('/api/me/queues', { queueIds: [mailbox()] });
      const got = [];
      for (let n = 1; n <= 8; n++) got.push((await row((await mail(n)).ticketId)).userId);
      expect(got.every((x) => x === agent.userId)).toBe(true);
    });

    it('reassigning frees a slot; manually created tickets are never distributed', async () => {
      await setLimit(1);
      await agent.put('/api/me/queues', { queueIds: [mailbox()] });
      const a = await mail(1);
      const b = await mail(2);
      expect((await row(b.ticketId)).userId).toBeNull();
      const manual = await newTicket();
      expect((await admin.patch(`/api/tickets/${a.ticketId}`, { userId: admin.userId })).status).toBe(200);
      expect((await row(b.ticketId)).userId).toBe(agent.userId);
      expect((await row(manual)).userId).toBeNull();
    });

    it('two runs at once never assign past the limit', async () => {
      await setLimit(2);
      const ids = [await mail(1), await mail(2), await mail(3), await mail(4)].map((m) => m.ticketId);
      await db.insert(queueLogins).values({ userId: agent.userId, queueId: mailbox() });
      const dist = ctx.app.get(DistributionService);
      await Promise.all([dist.run([support()]), dist.run([support()]), dist.run([support()])]);
      const owned = (await Promise.all(ids.map(row))).filter((t) => t.userId === agent.userId);
      expect(owned).toHaveLength(2);
    });

    it('only mailboxes in the agent’s rights can be marked ready', async () => {
      const res = await agent.put('/api/me/queues', { queueIds: ['00000000-0000-4000-8000-000000000000'] });
      expect(res.status).toBe(200);
      expect(res.body.every((q: { ready: boolean }) => !q.ready)).toBe(true);
    });
  });
});
