import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool } from '../src/db/db';
import { setupSupportTeam } from '../src/db/setup-support-team';
import { TEST_DATABASE_URL, createTestContext, loginAs, type Client, type TestContext } from './helpers';

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

  it("Ricoman setup: Richard and Ryan are administrators, only they have Unassigned (without personal inboxes), and person views show that person's tickets", async () => {
    const pool = createPool(TEST_DATABASE_URL);
    let setup: Awaited<ReturnType<typeof setupSupportTeam>>;
    try {
      setup = await setupSupportTeam(createDb(pool), { demo: true });
      await setupSupportTeam(createDb(pool), { demo: true }); // idempotent
    } finally {
      await pool.end();
    }
    // The "order" rule (O-30) is added once, after the other routing rules.
    const pool2 = createPool(TEST_DATABASE_URL);
    const rules = await pool2.query<{ title: string; position: number }>(
      'select title, position from routing_rules where deleted_at is null order by position',
    );
    await pool2.end();
    expect(rules.rows.filter((x) => x.title === 'Orders in the subject')).toHaveLength(1);
    expect(rules.rows.at(-1)!.title).toBe('Orders in the subject');

    const ryan = await loginAs(ctx.app, 'ryan@relaydesk.local');
    const richard = await loginAs(ctx.app, 'richard@relaydesk.local');
    const thierry = await loginAs(ctx.app, 'thierry@relaydesk.local');
    expect((await ryan.get('/api/auth/me')).body.user.type).toBe('administrator');
    expect((await richard.get('/api/auth/me')).body.user.type).toBe('administrator');
    const teamViews = async (c: Client) =>
      ((await c.get('/api/tickets/views')).body.teamViews as { id: string; name: string }[]).map((v) => v.name);
    expect(await teamViews(ryan)).toContain('Unassigned');
    expect(await teamViews(richard)).toContain('Unassigned');
    expect(await teamViews(thierry)).not.toContain('Unassigned');

    const create = async (title: string, categoryId: string) =>
      (await ryan.post('/api/tickets', { title, categoryId })).body.id as number;
    const enquiry = await create('Nobody has this enquiry', setup!.categories.Enquiries!);
    const personal = await create('From Ryan’s own inbox', setup!.categories["Ryan's Tickets"]!);
    const listed = (
      (await ryan.get(`/api/tickets?viewId=${setup!.views.Unassigned}&pageSize=200`)).body.items as { id: number }[]
    ).map((t) => t.id);
    expect(listed).toContain(enquiry);
    expect(listed).not.toContain(personal);

    // Person views (O-24): tickets assigned to that person, in any category, and nothing else.
    expect(setup!.linkedPersonViews.sort()).toEqual(['Heather', 'Richard', 'Ryan', 'Thierry']);
    const heatherId = (await (await loginAs(ctx.app, 'heather@relaydesk.local')).get('/api/auth/me')).body.user.id;
    const hers = (
      await ryan.post('/api/tickets', {
        title: 'Assigned to Heather',
        categoryId: setup!.categories.Enquiries!,
        userId: heatherId,
      })
    ).body.id as number;
    const labelOnly = await create('In the Heather category, owned by nobody', setup!.categories.Heather!);
    const inView = (await ryan.get(`/api/tickets?viewId=${setup!.views.Heather}&pageSize=200`)).body.items as {
      id: number;
      userId: string | null;
    }[];
    expect(inView.map((t) => t.id)).toContain(hers);
    expect(inView.map((t) => t.id)).not.toContain(labelOnly);
    expect(inView.every((t) => t.userId === heatherId)).toBe(true);

    // Personal inboxes (O-25): new mail is assigned to the owner, and shows only in their
    // "… Tickets" view, not in their person view.
    const ryanId = (await ryan.get('/api/auth/me')).body.user.id as string;
    const boxesRes = await ryan.get('/api/settings/mailboxes');
    const boxes = boxesRes.body.mailboxes as {
      address: string;
      defaultUserId: string | null;
    }[];
    expect(boxes.find((b) => b.address === 'ryan@ricoman.com')!.defaultUserId).toBe(ryanId);
    expect(boxes.find((b) => b.address === 'support@ricoman.com')!.defaultUserId).toBeNull();
    const own = (
      await ryan.post('/api/tickets', {
        title: 'From Ryan’s inbox, assigned to Ryan',
        categoryId: setup!.categories["Ryan's Tickets"]!,
        userId: ryanId,
      })
    ).body.id as number;
    const ids = async (viewId: string) =>
      ((await ryan.get(`/api/tickets?viewId=${viewId}&pageSize=200`)).body.items as { id: number }[]).map((t) => t.id);
    expect(await ids(setup!.views.Ryan!)).not.toContain(own);
    expect(await ids(setup!.views["Ryan's Tickets"]!)).toContain(own);
  });

  it('working views show Open and Waiting only; closed tickets move to "Closed & archived" (O-31)', async () => {
    const pool = createPool(TEST_DATABASE_URL);
    let setup: Awaited<ReturnType<typeof setupSupportTeam>>;
    try {
      setup = await setupSupportTeam(createDb(pool), { demo: true });
      // A view made by an earlier setup (closed tickets included) is brought up to date on a
      // re-run; one somebody changed by hand is left alone.
      await pool.query('update ticket_views set conditions = $1 where id = $2', [
        JSON.stringify([
          { field: 'categoryId', op: 'is', value: setup.categories.Enquiries },
          { field: 'state', op: 'is_not', value: 'archived' },
        ]),
        setup.views.Enquiries,
      ]);
      const custom = [{ field: 'categoryId', op: 'is', value: setup.categories['Accounts & Returns'] }];
      await pool.query('update ticket_views set conditions = $1 where id = $2', [
        JSON.stringify(custom),
        setup.views['Accounts & Returns'],
      ]);
      await setupSupportTeam(createDb(pool), { demo: true });
      const rows = (
        await pool.query<{ id: string; conditions: { value?: string }[] }>(
          'select id, conditions from ticket_views where id = any($1)',
          [[setup.views.Enquiries, setup.views['Accounts & Returns']]],
        )
      ).rows;
      expect(rows.find((r) => r.id === setup.views.Enquiries)!.conditions.map((c) => c.value)).toContain('closed');
      expect(rows.find((r) => r.id === setup.views['Accounts & Returns'])!.conditions).toEqual(custom);
    } finally {
      await pool.end();
    }

    const thierry = await loginAs(ctx.app, 'thierry@relaydesk.local');
    const ryan = await loginAs(ctx.app, 'ryan@relaydesk.local');
    const id = (await ryan.post('/api/tickets', { title: 'Closing soon', categoryId: setup!.categories.Enquiries! }))
      .body.id as number;
    const inView = async (c: Client, viewId: string) =>
      ((await c.get(`/api/tickets?viewId=${viewId}&pageSize=200`)).body.items as { id: number }[]).map((t) => t.id);
    expect(await inView(thierry, setup!.views.Enquiries!)).toContain(id);
    expect((await ryan.patch(`/api/tickets/${id}`, { state: 'closed' })).status).toBe(200);
    expect(await inView(thierry, setup!.views.Enquiries!)).not.toContain(id);
    // Everyone has "Closed & archived", and it holds the closed ticket.
    const names = ((await thierry.get('/api/tickets/views')).body.teamViews as { name: string }[]).map((v) => v.name);
    expect(names).toContain('Closed & archived');
    expect(await inView(thierry, setup!.views['Closed & archived']!)).toContain(id);
  });

  it('search finds a closed ticket by the customer: contact name, email address or company (O-31)', async () => {
    const sam = ((await admin.get('/api/crm/contacts?q=Sam')).body.items as { id: string; name: string }[])[0]!;
    const id = (
      await admin.post('/api/tickets', {
        title: 'Panels for the new site',
        categoryId: ctx.ids.helpdesk.categories.support,
        contactId: sam.id,
      })
    ).body.id as number;
    await admin.patch(`/api/tickets/${id}`, { state: 'closed', statusIds: [ctx.ids.helpdesk.statuses.resolved] });
    const found = async (q: string) =>
      ((await admin.get(`/api/tickets?q=${encodeURIComponent(q)}&pageSize=200`)).body.items as { id: number }[]).map(
        (t) => t.id,
      );
    expect(await found('Sam Smith')).toContain(id);
    expect(await found('sam@acme')).toContain(id);
    expect(await found('Acme Supplies')).toContain(id);
    const global = (await admin.get('/api/search?q=Acme%20Supplies')).body.tickets as { id: number; state: string }[];
    expect(global.find((t) => t.id === id)?.state).toBe('closed');
  });
});
