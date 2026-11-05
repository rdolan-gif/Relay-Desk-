import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TicketsService } from '../src/tickets/tickets.service';
import { STRONG_PASSWORD, createTestContext, loginAs, type Client, type TestContext } from './helpers';

const enc = (v: unknown) => encodeURIComponent(JSON.stringify(v));

describe('tickets (spec 6, 7)', () => {
  let ctx: TestContext;
  let admin: Client;
  let agent: Client;
  let cats: TestContext['ids']['helpdesk']['categories'];
  let st: TestContext['ids']['helpdesk']['statuses'];
  beforeEach(async () => {
    ctx = await createTestContext();
    admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    cats = ctx.ids.helpdesk.categories;
    st = ctx.ids.helpdesk.statuses;
  });
  afterEach(async () => {
    await ctx.close();
  });

  const create = async (c: Client, extra: Record<string, unknown> = {}) => {
    const res = await c.post('/api/tickets', { title: 'A ticket', categoryId: cats.billing, ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };

  describe('categories and rights (spec 4, 7.1)', () => {
    it('with Access = No a user can create a ticket in the category but cannot see it after saving', async () => {
      const res = await agent.post('/api/tickets', { title: 'Onboard supplier', categoryId: cats.intake });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.any(Number), visible: false });
      expect((await agent.get(`/api/tickets/${res.body.id}`)).status).toBe(404);
      expect((await agent.get('/api/tickets?q=Onboard')).body.total).toBe(0);
      expect((await admin.get(`/api/tickets/${res.body.id}`)).status).toBe(200);
    });

    it('a category not in the rights cannot be used at all', async () => {
      const cat = await admin.post('/api/settings/categories', { title: 'Secret' });
      expect(cat.status).toBe(201);
      const res = await agent.post('/api/tickets', { title: 'x', categoryId: cat.body.id });
      expect(res.status).toBe(404);
    });

    it('every ticket must have a category', async () => {
      expect((await agent.post('/api/tickets', { title: 'x' })).status).toBe(400);
    });

    it('when closing in a category with status required on close, a status is mandatory', async () => {
      const t = await create(agent, { categoryId: cats.support, userId: agent.userId });
      const res = await agent.patch(`/api/tickets/${t.id}`, { state: 'closed' });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors[0]).toMatchObject({ fieldId: 'statusIds', code: 'required' });
      expect((await agent.patch(`/api/tickets/${t.id}`, { state: 'closed', statusIds: [st.resolved] })).status).toBe(
        200,
      );
    });

    it('a status not enabled for the category is refused', async () => {
      const t = await create(agent, { categoryId: cats.support });
      const res = await agent.patch(`/api/tickets/${t.id}`, { statusIds: [st.refundIssued] });
      expect(res.status).toBe(400);
    });

    it('when saving to Waiting in a category that requires it, the re-open time is mandatory', async () => {
      const t = await create(agent);
      const res = await agent.patch(`/api/tickets/${t.id}`, { state: 'waiting' });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors[0]).toMatchObject({ fieldId: 'reopenAt', code: 'required' });
    });

    it('with "check child tickets on close", closing or deleting is refused while a child is unresolved', async () => {
      const parent = await create(admin, { categoryId: cats.support });
      const child = (await admin.post(`/api/tickets/${parent.id}/children`, { title: 'Child' })).body;
      expect(child.parent).toEqual({ id: parent.id, title: 'A ticket' });
      const close = await admin.patch(`/api/tickets/${parent.id}`, { state: 'closed', statusIds: [st.resolved] });
      expect(close.status).toBe(400);
      expect(close.body.fieldErrors[0].code).toBe('open_children');
      expect((await admin.delete(`/api/tickets/${parent.id}`)).body.reason).toBe('open_children');
      await admin.patch(`/api/tickets/${child.id}`, { state: 'closed', statusIds: [st.resolved] });
      expect(
        (await admin.patch(`/api/tickets/${parent.id}`, { state: 'closed', statusIds: [st.resolved] })).status,
      ).toBe(200);
    });

    it('removing a status from a category keeps it on existing tickets', async () => {
      const t = await create(agent, { statusIds: [st.refundIssued] });
      const cat = (await admin.get(`/api/settings/categories/${cats.billing}`)).body;
      await admin.put(`/api/settings/categories/${cats.billing}`, { ...cat, statusIds: [st.resolved] });
      const after = (await agent.patch(`/api/tickets/${t.id}`, { title: 'Renamed' })).body;
      expect(after.statusIds).toEqual([st.refundIssued]);
    });

    it('a category with tickets cannot be deleted', async () => {
      expect((await admin.delete(`/api/settings/categories/${cats.billing}`)).body.reason).toBe('category_in_use');
    });
  });

  describe('scheduled jobs (spec 6.3)', () => {
    it('a Closed ticket is archived after the category’s auto-archive days', async () => {
      const t = await create(admin, { categoryId: cats.support, state: 'closed', statusIds: [st.resolved] });
      const svc = ctx.app.get(TicketsService);
      expect(await svc.autoArchive(new Date(Date.now() + 29 * 86_400_000))).not.toContain(t.id);
      expect(await svc.autoArchive(new Date(Date.now() + 31 * 86_400_000))).toContain(t.id);
      expect((await admin.get(`/api/tickets/${t.id}`)).body.state).toBe('archived');
      const history = (await admin.get(`/api/tickets/${t.id}/history`)).body;
      expect(history.at(-1)).toMatchObject({
        userId: null,
        changes: [{ field: 'state', old: 'closed', new: 'archived' }],
      });
    });
  });

  describe('comments, mentions and followers (spec 6.2, 13)', () => {
    it('the author and @mentioned users become followers', async () => {
      const t = await create(agent);
      const res = await agent.post(`/api/tickets/${t.id}/comments`, {
        bodyHtml: '<p>Hi @Ada</p>',
        mentionUserIds: [admin.userId],
      });
      expect(res.status).toBe(201);
      expect(res.body.mentionUserIds).toEqual([admin.userId]);
      const followers = (await agent.get(`/api/tickets/${t.id}`)).body.followers
        .map((f: { id: string }) => f.id)
        .sort();
      expect(followers).toEqual([admin.userId, agent.userId].sort());
    });

    it('comment HTML is sanitised', async () => {
      const t = await create(agent);
      const res = await agent.post(`/api/tickets/${t.id}/comments`, {
        bodyHtml: '<p onclick="x()">ok<script>alert(1)</script><a href="javascript:x">l</a></p>',
      });
      expect(res.body.bodyHtml).not.toMatch(/script|onclick|javascript/);
      expect(res.body.bodyHtml).toContain('ok');
    });

    it('authors can edit their own comments; edits show "edited" and are logged in history', async () => {
      const t = await create(agent);
      const c = (await agent.post(`/api/tickets/${t.id}/comments`, { bodyHtml: '<p>First</p>' })).body;
      expect((await admin.patch(`/api/tickets/${t.id}/comments/${c.id}`, { bodyHtml: '<p>Hijack</p>' })).status).toBe(
        403,
      );
      const edited = await agent.patch(`/api/tickets/${t.id}/comments/${c.id}`, {
        bodyHtml: '<p>Second</p>',
        mentionUserIds: [admin.userId],
      });
      expect(edited.status).toBe(200);
      expect(edited.body.editedAt).toBeTruthy();
      expect(edited.body.newMentionUserIds).toEqual([admin.userId]);
      const history = (await agent.get(`/api/tickets/${t.id}/history`)).body;
      expect(history.at(-1).changes).toEqual([{ field: `comment:${c.id}`, old: '<p>First</p>', new: '<p>Second</p>' }]);
    });

    it('external comments are only allowed where the category allows them', async () => {
      const t = await create(agent);
      const res = await agent.post(`/api/tickets/${t.id}/comments`, { bodyHtml: '<p>x</p>', isExternal: true });
      expect(res.body.reason).toBe('external_not_allowed');
    });

    it('any user can follow and unfollow a ticket', async () => {
      const t = await create(admin);
      await agent.post(`/api/tickets/${t.id}/follow`);
      expect((await agent.get(`/api/tickets/${t.id}`)).body.followers.map((f: { id: string }) => f.id)).toContain(
        agent.userId,
      );
      await agent.delete(`/api/tickets/${t.id}/follow`);
      expect((await agent.get(`/api/tickets/${t.id}`)).body.followers).toEqual([]);
    });

    it('when a user is deactivated they are removed as follower, and their tickets lose the User on next save', async () => {
      const created = await admin.post('/api/settings/users', {
        email: 'leaver@relaydesk.local',
        name: 'Lee Leaver',
        type: 'agent',
        password: STRONG_PASSWORD,
        accessProfileId: ctx.ids.accessProfiles.Agent,
        rightsProfileId: ctx.ids.rightsProfiles['Standard agent'],
      });
      const t = await create(admin, { userId: created.body.id, followerIds: [created.body.id] });
      await admin.patch(`/api/settings/users/${created.body.id}`, { isActive: false });
      expect((await admin.get(`/api/tickets/${t.id}`)).body.followers).toEqual([]);
      const saved = (await admin.patch(`/api/tickets/${t.id}`, { priority: 'high' })).body;
      expect(saved.userId).toBeNull();
    });
  });

  describe('merge, parent/child, move (spec 6.4)', () => {
    it('when tickets are merged they become one: activities and followers move in and the other disappears (owner Q4)', async () => {
      const a = await create(agent);
      const b = await create(agent, { title: 'Zebra duplicate' });
      await agent.post(`/api/tickets/${b.id}/comments`, { bodyHtml: '<p>On B</p>' });
      await admin.post(`/api/tickets/${b.id}/follow`);
      const res = await agent.post('/api/tickets/merge', { ticketIds: [a.id, b.id], survivorId: a.id });
      expect(res.status).toBe(200);
      expect(res.body.followers.map((f: { id: string }) => f.id).sort()).toEqual([admin.userId, agent.userId].sort());
      expect(res.body.merges).toEqual([expect.objectContaining({ mergedId: b.id, title: 'Zebra duplicate' })]);
      expect(
        (await agent.get(`/api/tickets/${a.id}/activities`)).body.map((x: { bodyHtml: string }) => x.bodyHtml),
      ).toEqual(['<p>On B</p>']);
      const gone = await agent.get(`/api/tickets/${b.id}`);
      expect(gone.status).toBe(404);
      expect(gone.body).toMatchObject({ reason: 'merged', mergedIntoId: a.id });
      expect((await agent.get('/api/tickets?q=Zebra')).body.total).toBe(0);
      expect((await agent.get(`/api/tickets/${a.id}/history`)).body.at(-1).action).toBe('merge');
    });

    it('a merge can be undone: the ticket returns with the activities and followers it brought (owner Q4)', async () => {
      const a = await create(agent);
      const b = await create(agent, { title: 'Wrongly merged' });
      await agent.post(`/api/tickets/${a.id}/comments`, { bodyHtml: '<p>On A</p>' });
      await agent.post(`/api/tickets/${b.id}/comments`, { bodyHtml: '<p>On B</p>' });
      await admin.post(`/api/tickets/${b.id}/follow`);
      const merged = (await agent.post('/api/tickets/merge', { ticketIds: [a.id, b.id], survivorId: a.id })).body;
      const undo = await agent.post(`/api/tickets/${a.id}/merges/${merged.merges[0].id}/undo`);
      expect(undo.status).toBe(200);
      expect(undo.body.merges).toEqual([]);
      expect(undo.body.followers.map((f: { id: string }) => f.id)).toEqual([agent.userId]);
      expect(
        (await agent.get(`/api/tickets/${a.id}/activities`)).body.map((x: { bodyHtml: string }) => x.bodyHtml),
      ).toEqual(['<p>On A</p>']);
      const back = await agent.get(`/api/tickets/${b.id}`);
      expect(back.status).toBe(200);
      expect(back.body.mergedIntoId).toBeNull();
      expect(
        (await agent.get(`/api/tickets/${b.id}/activities`)).body.map((x: { bodyHtml: string }) => x.bodyHtml),
      ).toEqual(['<p>On B</p>']);
      expect((await agent.post(`/api/tickets/${a.id}/merges/${merged.merges[0].id}/undo`)).status).toBe(404);
    });

    it('merge needs the merge permission', async () => {
      const bo = await loginAs(ctx.app, 'backoffice@relaydesk.local');
      expect((await bo.post('/api/tickets/merge', { ticketIds: [1, 2], survivorId: 1 })).status).toBe(403);
    });

    it('a child ticket created from an activity copies the contact and links the activity', async () => {
      const sam = (await admin.get('/api/crm/contacts?q=Sam')).body.items[0];
      const parent = await create(agent, { contactId: sam.id });
      const c = (await agent.post(`/api/tickets/${parent.id}/comments`, { bodyHtml: '<p>Needs a part</p>' })).body;
      const child = await agent.post(`/api/tickets/${parent.id}/children`, { title: 'Order part', activityId: c.id });
      expect(child.status).toBe(201);
      expect(child.body).toMatchObject({ contactId: sam.id, parentId: parent.id, sourceActivityId: null });
      const fetched = (await agent.get(`/api/tickets/${child.body.id}`)).body;
      expect(fetched.sourceActivityId).toBe(c.id);
      expect(fetched.description).toBe('<p>Needs a part</p>');
      expect((await agent.get(`/api/tickets/${parent.id}`)).body.children.map((x: { id: number }) => x.id)).toEqual([
        child.body.id,
      ]);
    });

    it('a ticket cannot become its own ancestor', async () => {
      const a = await create(agent);
      const b = (await agent.post(`/api/tickets/${a.id}/children`, { title: 'B' })).body;
      const res = await agent.patch(`/api/tickets/${a.id}`, { parentId: b.id });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors[0].code).toBe('cycle');
    });
  });

  describe('archived tickets (owner Q9)', () => {
    it('when a ticket is Archived it is read-only: edits, comments, moves, merges and children are refused', async () => {
      const t = await create(agent, { userId: agent.userId });
      const other = await create(agent);
      const c = (await agent.post(`/api/tickets/${t.id}/comments`, { bodyHtml: '<p>x</p>' })).body;
      await agent.patch(`/api/tickets/${t.id}`, { state: 'archived' });
      const edit = await agent.patch(`/api/tickets/${t.id}`, { title: 'Changed' });
      expect(edit.status).toBe(409);
      expect(edit.body).toMatchObject({ reason: 'archived_read_only', fields: ['title'] });
      expect((await agent.post(`/api/tickets/${t.id}/comments`, { bodyHtml: '<p>y</p>' })).body.reason).toBe(
        'archived_read_only',
      );
      expect(
        (await agent.post(`/api/tickets/${t.id}/activities/${c.id}/move`, { targetTicketId: other.id })).body.reason,
      ).toBe('archived_read_only');
      expect(
        (await agent.post('/api/tickets/merge', { ticketIds: [t.id, other.id], survivorId: other.id })).body.reason,
      ).toBe('archived_read_only');
      expect((await agent.post(`/api/tickets/${t.id}/children`, { title: 'Child' })).body.reason).toBe(
        'archived_read_only',
      );
    });

    it('an Archived ticket can be un-archived and then behaves as a standard ticket', async () => {
      const t = await create(agent, { userId: agent.userId });
      await agent.patch(`/api/tickets/${t.id}`, { state: 'archived' });
      const mixed = await agent.patch(`/api/tickets/${t.id}`, { state: 'open', title: 'Both at once' });
      expect(mixed.body.reason).toBe('archived_read_only');
      const back = await agent.patch(`/api/tickets/${t.id}`, { state: 'open' });
      expect(back.status).toBe(200);
      expect(back.body.state).toBe('open');
      expect((await agent.patch(`/api/tickets/${t.id}`, { title: 'Editable again' })).status).toBe(200);
      expect((await agent.post(`/api/tickets/${t.id}/comments`, { bodyHtml: '<p>ok</p>' })).status).toBe(201);
    });
  });

  describe('optimistic locking (spec 13)', () => {
    it('when two users save the same version, the second save is rejected with the current values', async () => {
      const t = await create(agent);
      expect((await agent.patch(`/api/tickets/${t.id}`, { priority: 'high', version: t.version })).status).toBe(200);
      const second = await admin.patch(`/api/tickets/${t.id}`, { priority: 'low', version: t.version });
      expect(second.status).toBe(409);
      expect(second.body.reason).toBe('version_conflict');
      expect(second.body.current.priority).toBe('high');
    });
  });

  describe('list, filters, search, views (spec 6.1)', () => {
    it('filters by state, priority, status and @me; searches title and #number', async () => {
      const t = await create(agent, {
        title: 'Refund for broken kettle',
        priority: 'high',
        statusIds: [st.refundIssued],
        userId: agent.userId,
      });
      const ids = async (query: string) =>
        ((await agent.get(`/api/tickets?${query}`)).body.items as { id: number }[]).map((x) => x.id);
      expect(
        await ids(
          `filter=${enc([
            { field: 'priority', op: 'is', value: 'high' },
            { field: 'statusIds', op: 'is', value: st.refundIssued },
          ])}`,
        ),
      ).toEqual([t.id]);
      expect(await ids(`q=kettle`)).toEqual([t.id]);
      expect(await ids(`q=%23${t.id}`)).toEqual([t.id]);
      expect(
        await ids(
          `filter=${enc([
            { field: 'userId', op: 'is', value: '@me' },
            { field: 'title', op: 'contains', value: 'kettle' },
          ])}`,
        ),
      ).toEqual([t.id]);
      expect((await agent.get('/api/search?q=kettle')).body.tickets.map((x: { id: number }) => x.id)).toEqual([t.id]);
    });

    it('team views come from rights; their conditions resolve @me per user', async () => {
      const mine = await create(agent, { userId: agent.userId });
      const sidebar = (await agent.get('/api/tickets/views')).body;
      expect(sidebar.teamViews.map((v: { name: string }) => v.name)).toEqual(['My open tickets', 'Unassigned']);
      const res = await agent.get(`/api/tickets?viewId=${ctx.ids.helpdesk.views.myOpen}`);
      expect(res.body.items.map((x: { id: number }) => x.id)).toContain(mine.id);
      expect(res.body.items.every((x: { userId: string }) => x.userId === agent.userId)).toBe(true);
    });

    it('team views not in the rights cannot be used', async () => {
      const rp = await admin.post('/api/settings/rights-profiles', {
        name: 'No views',
        categories: 'all',
        ticketViews: [],
      });
      await admin.post('/api/settings/users', {
        email: 'noviews@relaydesk.local',
        name: 'No Views',
        type: 'agent',
        password: STRONG_PASSWORD,
        accessProfileId: ctx.ids.accessProfiles.Agent,
        rightsProfileId: rp.body.id,
      });
      const u = await loginAs(ctx.app, 'noviews@relaydesk.local', STRONG_PASSWORD);
      expect((await u.get('/api/tickets/views')).body.teamViews).toEqual([]);
      expect((await u.get(`/api/tickets?viewId=${ctx.ids.helpdesk.views.myOpen}`)).status).toBe(404);
    });

    it('users with the permission create My views, pin team views, reorder and nest; removing from the sidebar does not delete', async () => {
      const view = await agent.post('/api/tickets/views', {
        name: 'High priority',
        conditions: [{ field: 'priority', op: 'is', value: 'high' }],
      });
      expect(view.status).toBe(201);
      let sidebar = (await agent.get('/api/tickets/views')).body;
      expect(sidebar.items.map((i: { viewId: string }) => i.viewId)).toEqual([view.body.id]);
      const pinned = await agent.put('/api/tickets/views/sidebar', {
        items: [
          { viewId: ctx.ids.helpdesk.views.unassigned, position: 0, folder: 'Queues' },
          { viewId: view.body.id, position: 1, parentViewId: ctx.ids.helpdesk.views.unassigned },
        ],
      });
      expect(pinned.status).toBe(200);
      expect(pinned.body.items.map((i: { viewId: string }) => i.viewId)).toEqual([
        ctx.ids.helpdesk.views.unassigned,
        view.body.id,
      ]);
      sidebar = (await agent.put('/api/tickets/views/sidebar', { items: [] })).body;
      expect(sidebar.myViews.map((v: { name: string }) => v.name)).toEqual(['High priority']);

      const bo = await loginAs(ctx.app, 'backoffice@relaydesk.local');
      expect((await bo.post('/api/tickets/views', { name: 'x' })).status).toBe(403);
    });
  });

  describe('permissions (spec 4)', () => {
    it('deleting needs the delete-tickets permission; deleted tickets disappear', async () => {
      const t = await create(admin);
      expect((await agent.delete(`/api/tickets/${t.id}`)).status).toBe(403);
      expect((await admin.delete(`/api/tickets/${t.id}`)).status).toBe(204);
      expect((await admin.get(`/api/tickets/${t.id}`)).status).toBe(404);
    });

    it('bulk edit needs the bulk-edit permission', async () => {
      expect(
        (await agent.post('/api/tickets/bulk-edit', { ticketIds: [1], changes: { priority: 'low' } })).status,
      ).toBe(403);
    });

    it('moving activities needs the move permission', async () => {
      const bo = await loginAs(ctx.app, 'backoffice@relaydesk.local');
      expect(
        (await bo.post('/api/tickets/1/activities/00000000-0000-4000-8000-000000000000/move', { targetTicketId: 2 }))
          .status,
      ).toBe(403);
    });

    it('the ticket shows the contact card with other open tickets of the same contact', async () => {
      const sam = (await admin.get('/api/crm/contacts?q=Sam')).body.items[0];
      const t = await create(agent, { contactId: sam.id });
      const card = (await agent.get(`/api/tickets/${t.id}`)).body.contactCard;
      expect(card).toMatchObject({ name: 'Sam Smith', account: { name: 'Acme Supplies Ltd' }, openRecordCount: 1 });
      expect(card.otherOpenTickets.map((x: { title: string }) => x.title)).toContain(
        'Printer jams on every second page',
      );
    });
  });
});
