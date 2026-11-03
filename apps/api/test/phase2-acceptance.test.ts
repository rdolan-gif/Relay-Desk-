import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TicketsService } from '../src/tickets/tickets.service';
import { createTestContext, loginAs, type Client, type TestContext } from './helpers';

/**
 * Phase 2 done-when (spec 20): "every row of both tables in 6.3 has a passing test, and
 * the auto-fill-user-on-close rule works from the form but not from bulk edit."
 *
 * Every row is unit-tested in packages/domain/src/tickets/state.test.ts. Here the rows
 * that Phase 2 can exercise end-to-end run through the API; rows that need email
 * (Phase 3), in-progress channels (later) or the portal (Phase 7) are proven at the
 * domain level and get API tests in those phases.
 */
describe('Phase 2 acceptance', () => {
  let ctx: TestContext;
  let admin: Client;
  let agent: Client;
  beforeEach(async () => {
    ctx = await createTestContext();
    admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    agent = await loginAs(ctx.app, 'agent@relaydesk.local');
  });
  afterEach(async () => {
    await ctx.close();
  });

  const newTicket = async (c: Client, extra: Record<string, unknown> = {}) => {
    const res = await c.post('/api/tickets', {
      title: 'Test ticket',
      categoryId: ctx.ids.helpdesk.categories.billing,
      ...extra,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: number; state: string; userId: string | null; version: number };
  };
  const setState = async (c: Client, id: number, state: string, extra: Record<string, unknown> = {}) => {
    const res = await c.patch(`/api/tickets/${id}`, { state, ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  };
  const comment = (c: Client, id: number) => c.post(`/api/tickets/${id}/comments`, { bodyHtml: '<p>An update</p>' });
  const stateOf = async (id: number) => (await admin.get(`/api/tickets/${id}`)).body.state as string;
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

  describe('table 2 rows exercised through the API', () => {
    it("internal comment by someone other than the ticket's User reopens Waiting", async () => {
      const t = await newTicket(agent, { userId: agent.userId });
      await setState(agent, t.id, 'waiting', { reopenAt: tomorrow() });
      expect((await comment(admin, t.id)).status).toBe(201);
      expect(await stateOf(t.id)).toBe('open');
    });

    it("internal comment by someone other than the ticket's User reopens Closed", async () => {
      const t = await newTicket(agent, { userId: agent.userId });
      await setState(agent, t.id, 'closed');
      await comment(admin, t.id);
      expect(await stateOf(t.id)).toBe('open');
    });

    it('re-open date/time reached reopens Waiting', async () => {
      const t = await newTicket(agent, { userId: agent.userId });
      await setState(agent, t.id, 'waiting', { reopenAt: new Date(Date.now() + 60_000).toISOString() });
      const reopened = await ctx.app.get(TicketsService).reopenDue(new Date(Date.now() + 120_000));
      expect(reopened).toContain(t.id);
      const after = (await admin.get(`/api/tickets/${t.id}`)).body;
      expect(after.state).toBe('open');
      expect(after.reopenAt).toBeNull();
    });

    it('re-open date/time reached reopens Closed', async () => {
      const t = await newTicket(agent, { userId: agent.userId });
      await setState(agent, t.id, 'closed', { reopenAt: new Date(Date.now() + 60_000).toISOString() });
      await ctx.app.get(TicketsService).reopenDue(new Date(Date.now() + 120_000));
      expect(await stateOf(t.id)).toBe('open');
    });
  });

  describe('no-change cases exercised through the API', () => {
    it('a comment on your own ticket does not reopen it', async () => {
      const t = await newTicket(agent, { userId: agent.userId });
      await setState(agent, t.id, 'closed');
      await comment(agent, t.id);
      expect(await stateOf(t.id)).toBe('closed');
    });

    it('a comment on an unassigned ticket does not reopen it', async () => {
      const t = await newTicket(admin);
      await setState(admin, t.id, 'waiting', { reopenAt: tomorrow() });
      await comment(agent, t.id);
      expect(await stateOf(t.id)).toBe('waiting');
    });

    it('moving activities between tickets changes neither ticket’s state or user', async () => {
      const a = await newTicket(agent, { userId: agent.userId });
      const b = await newTicket(agent, { userId: agent.userId });
      const c = (await comment(agent, a.id)).body;
      await setState(agent, a.id, 'closed');
      await setState(agent, b.id, 'closed');
      const moved = await agent.post(`/api/tickets/${a.id}/activities/${c.id}/move`, { targetTicketId: b.id });
      expect(moved.status).toBe(200);
      for (const id of [a.id, b.id]) {
        const t = (await admin.get(`/api/tickets/${id}`)).body;
        expect(t.state).toBe('closed');
        expect(t.userId).toBe(agent.userId);
      }
      expect((await admin.get(`/api/tickets/${b.id}/activities`)).body.map((x: { id: string }) => x.id)).toContain(
        c.id,
      );
    });

    it('anything on an Archived ticket: a comment by another user does not reopen it', async () => {
      const t = await newTicket(agent, { userId: agent.userId });
      await setState(agent, t.id, 'archived');
      await comment(admin, t.id);
      expect(await stateOf(t.id)).toBe('archived');
    });
  });

  describe('auto-fill User on close (spec 6.3)', () => {
    it('when a ticket with no User is closed from the ticket form, User becomes the person saving', async () => {
      const t = await newTicket(agent);
      expect(t.userId).toBeNull();
      const closed = await setState(agent, t.id, 'closed');
      expect(closed.userId).toBe(agent.userId);
    });

    it('when the same is done by bulk edit, User stays empty', async () => {
      const t1 = await newTicket(admin);
      const t2 = await newTicket(admin);
      const res = await admin.post('/api/tickets/bulk-edit', {
        ticketIds: [t1.id, t2.id],
        changes: { state: 'closed' },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updated: [t1.id, t2.id], failed: [] });
      for (const id of [t1.id, t2.id]) {
        const t = (await admin.get(`/api/tickets/${id}`)).body;
        expect(t.state).toBe('closed');
        expect(t.userId).toBeNull();
      }
    });

    it('archiving from the form also auto-fills the User', async () => {
      const t = await newTicket(agent);
      expect((await setState(agent, t.id, 'archived')).userId).toBe(agent.userId);
    });
  });
});
