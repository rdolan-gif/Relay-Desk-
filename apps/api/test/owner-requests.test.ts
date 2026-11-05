import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, loginAs, type Client, type TestContext } from './helpers';

/** Changes the owner asked for after trying the demo. */
describe('owner requests', () => {
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

  it('an Open ticket is unread until the person opens it, and unread again after new activity; closed tickets are never unread', async () => {
    const id = (
      await admin.post('/api/tickets', { title: 'Unread test', categoryId: ctx.ids.helpdesk.categories.support })
    ).body.id;
    const unread = async () =>
      ((await agent.get('/api/tickets?pageSize=200')).body.items as { id: number; unread: boolean }[]).find(
        (t) => t.id === id,
      )!.unread;
    expect(await unread()).toBe(true);
    await agent.get(`/api/tickets/${id}`);
    expect(await unread()).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    await admin.post(`/api/tickets/${id}/comments`, { bodyHtml: '<p>New information</p>' });
    expect(await unread()).toBe(true);
    await agent.get(`/api/tickets/${id}`);
    expect(await unread()).toBe(false);
    await admin.patch(`/api/tickets/${id}`, { state: 'closed', statusIds: [ctx.ids.helpdesk.statuses.resolved] });
    expect(await unread()).toBe(false);
  });

  it('a view filtering on an empty person field (Unassigned) lists tickets instead of failing', async () => {
    const id = (
      await admin.post('/api/tickets', { title: 'Nobody owns me', categoryId: ctx.ids.helpdesk.categories.support })
    ).body.id;
    const views = (await agent.get('/api/tickets/views')).body.teamViews as { id: string; name: string }[];
    const unassigned = views.find((v) => v.name === 'Unassigned')!;
    const res = await agent.get(`/api/tickets?viewId=${unassigned.id}`);
    expect(res.status).toBe(200);
    expect((res.body.items as { id: number }[]).map((t) => t.id)).toContain(id);
  });
});
