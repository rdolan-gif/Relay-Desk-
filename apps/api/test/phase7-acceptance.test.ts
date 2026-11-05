import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { zonedTime } from '@relay-desk/domain';
import { DB, type Db } from '../src/db/db';
import { activities, historyEntries, tickets, users } from '../src/db/schema';
import { createTestContext, loginAs, type Client, type TestContext } from './helpers';
import { receive } from './mail-helpers';

const london = (m: number, d: number, h: number, mi = 0) =>
  new Date(zonedTime(2026, m, d, h * 60 + mi, 'Europe/London'));

/**
 * Phase 7 (spec 20) without the portal (owner S-8): reporting figures match a hand-worked
 * data set (spec 17), and the knowledge base honours folder rights, keeps versions and is
 * searchable (spec 15). The reply-editor insert is in e2e/tests/phase7.spec.ts.
 */
describe('Phase 7 acceptance', () => {
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

  describe('reporting (spec 17)', () => {
    /** Mon 12 – Fri 16 October 2026, Support (office hours Mon–Fri 09:00–17:00). */
    const seedWeek = async () => {
      const support = ctx.ids.helpdesk.categories.support;
      // Only this week's tickets in Support.
      await db.update(tickets).set({ deletedAt: new Date() }).where(eq(tickets.categoryId, support));
      const [ag] = await db.select().from(users).where(eq(users.email, 'agent@relaydesk.local'));
      const mk = async (v: Partial<typeof tickets.$inferInsert>, states: [Date, string][]) => {
        const [t] = await db
          .insert(tickets)
          .values({ title: 'Report test', categoryId: support, userId: ag!.id, ...v })
          .returning();
        await db.insert(historyEntries).values({
          entityType: 'ticket',
          entityId: String(t!.id),
          action: 'create',
          changes: [{ field: 'state', old: null, new: 'open' }],
          createdAt: t!.createdAt,
        });
        for (const [at, state] of states)
          await db.insert(historyEntries).values({
            entityType: 'ticket',
            entityId: String(t!.id),
            action: 'update',
            changes: [{ field: 'state', old: 'x', new: state }],
            createdAt: at,
          });
        return t!.id;
      };
      const t1 = await mk(
        {
          createdAt: london(10, 12, 10),
          firstAnswerAt: london(10, 12, 11),
          firstAnswerMet: true,
          solutionMet: true,
          state: 'closed',
        },
        [[london(10, 13, 10), 'closed']],
      );
      const t2 = await mk(
        {
          createdAt: london(10, 12, 16),
          firstAnswerAt: london(10, 13, 12),
          firstAnswerMet: false,
          slaPausedSeconds: 3600,
          state: 'open',
        },
        [
          [london(10, 14, 10), 'closed'],
          [london(10, 14, 12), 'open'],
        ],
      );
      const t3 = await mk({ createdAt: london(10, 14, 9), state: 'waiting', userId: null }, [
        [london(10, 15, 10), 'waiting'],
      ]);
      const t4 = await mk({ createdAt: london(10, 9, 10), state: 'open' }, []);
      await db.insert(activities).values({
        ticketId: t1,
        type: 'email',
        channel: 'email',
        direction: 'in',
        status: 'received',
        createdAt: london(10, 12, 10),
      });
      return { t1, t2, t3, t4, support, agentId: ag!.id };
    };
    const range = (extra = '') =>
      `from=${encodeURIComponent(london(10, 12, 0).toISOString())}&to=${encodeURIComponent(london(10, 16, 23, 59).toISOString())}${extra}`;

    it('created, closed, backlog, SLA met %, medians, reopen rate, workload and the inbound heatmap match a hand-worked week', async () => {
      const w = await seedWeek();
      const res = await admin.get(`/api/reports/summary?${range(`&categoryId=${w.support}`)}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const s = res.body;
      expect(s.days).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
      expect(s.created.map((d: { count: number }) => d.count)).toEqual([2, 0, 1, 0, 0]);
      expect(s.closed.map((d: { count: number }) => d.count)).toEqual([0, 1, 1, 0, 0]);
      expect(s.totals).toEqual({ created: 3, closed: 2 });
      expect(s.backlog.map((d: { count: number }) => d.count)).toEqual([3, 2, 3, 3, 3]);
      expect(s.firstAnswer).toEqual({ met: 1, decided: 2, percent: 50 });
      expect(s.solution).toEqual({ met: 1, decided: 1, percent: 100 });
      // T1: 60 working minutes; T2: Mon 16:00 → Tue 12:00 = 240.
      expect(s.medianFirstResponseMinutes).toBe(150);
      // T1: Mon 10:00 → Tue 10:00 = 480; T2: Mon 16:00 → Wed 10:00 = 600 − 60 waiting = 540.
      expect(s.medianResolutionMinutes).toBe(510);
      expect(s.reopenRate).toEqual({ reopened: 1, closed: 2, percent: 50 });
      expect(s.workload).toEqual([{ userId: w.agentId, name: 'Alex Agent', open: 2, closed: 2 }]);
      expect(s.heatmap[0][10]).toBe(1);
      expect(s.inboundEmails).toBe(1);
    });

    it('every figure drills down to its tickets and exports as CSV', async () => {
      const w = await seedWeek();
      const ids = async (metric: string, extra = '') =>
        (
          (await admin.get(`/api/reports/tickets?${range(`&categoryId=${w.support}&metric=${metric}${extra}`)}`))
            .body as { id: number }[]
        )
          .map((t) => t.id)
          .sort();
      expect(await ids('reopened')).toEqual([w.t2]);
      expect(await ids('created', '&day=2026-10-12')).toEqual([w.t1, w.t2].sort());
      expect(await ids('first_answer_missed')).toEqual([w.t2]);
      expect(await ids('open_by_user', `&forUserId=${w.agentId}`)).toEqual([w.t2, w.t4].sort());
      const csv = await admin.get(`/api/reports/export?${range(`&categoryId=${w.support}&section=daily&format=csv`)}`);
      expect(csv.text.split('\r\n').slice(0, 3)).toEqual([
        '﻿Day,Created,Closed,Backlog',
        '2026-10-12,2,0,3',
        '2026-10-13,0,1,2',
      ]);
      expect(w.t3).toBeGreaterThan(0);
    });

    it('reporting needs the Reporting module; bad ranges are refused', async () => {
      expect((await agent.get(`/api/reports/summary?${range()}`)).status).toBe(403);
      const bad = await admin.get(`/api/reports/summary?from=2026-10-20T00:00:00Z&to=2026-10-01T00:00:00Z`);
      expect(bad.status).toBe(400);
      expect(bad.body.reason).toBe('invalid_query');
    });

    it('the email activity listing shows mail across tickets, filterable by direction', async () => {
      await receive(ctx.app, ctx.ids.helpdesk.mailbox, { from: 'list@example.com', subject: 'Listing check' });
      const from = encodeURIComponent(new Date(Date.now() - 3600_000).toISOString());
      const to = encodeURIComponent(new Date(Date.now() + 3600_000).toISOString());
      const list = (await admin.get(`/api/reports/emails?from=${from}&to=${to}&direction=in`)).body as {
        subject: string;
        queue: string;
      }[];
      expect(list.some((e) => e.subject === 'Listing check' && e.queue === 'Support (demo)')).toBe(true);
    });
  });

  describe('knowledge base (spec 15)', () => {
    const f = () => ctx.ids.helpdesk.kbFolders;

    it('folder rights: agents see only their folders; restricted articles are hidden from lists, pages and global search', async () => {
      const titles = ((await agent.get('/api/kb/folders')).body as { title: string }[]).map((x) => x.title).sort();
      expect(titles).toEqual(['How we work', 'Products']);
      const secret = ((await admin.get(`/api/kb/articles?folderId=${f().restricted}`)).body as { id: string }[])[0]!;
      expect((await agent.get(`/api/kb/articles/${secret.id}`)).status).toBe(404);
      expect(((await agent.get('/api/kb/articles?q=margins')).body as unknown[]).length).toBe(0);
      expect((await agent.get('/api/search?q=margins')).body.kb).toEqual([]);
      expect((await admin.get('/api/search?q=margins')).body.kb.map((x: { title: string }) => x.title)).toEqual([
        'Pricing margins 2026',
      ]);
      expect((await agent.post('/api/kb/articles', { folderId: f().Products, title: 'Nope' })).status).toBe(403);
    });

    it('articles keep every version; restoring an old one saves it as a new version', async () => {
      const a = await admin.post('/api/kb/articles', {
        folderId: f().Products,
        title: 'Track lights',
        bodyHtml: '<p>v1</p>',
        tags: ['Track', 'lights'],
      });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      await admin.put(`/api/kb/articles/${a.body.id}`, {
        folderId: f().Products,
        title: 'Track lights',
        bodyHtml: '<p>v2</p>',
        tags: ['track'],
      });
      const r = await admin.post(`/api/kb/articles/${a.body.id}/versions/1/restore`);
      expect(r.body.version).toBe(3);
      const art = (await admin.get(`/api/kb/articles/${a.body.id}`)).body;
      expect(art).toMatchObject({ bodyHtml: '<p>v1</p>', tags: ['track', 'lights'], version: 3 });
      expect(
        ((await admin.get(`/api/kb/articles/${a.body.id}/versions`)).body as { version: number }[]).map(
          (v) => v.version,
        ),
      ).toEqual([3, 2, 1]);
    });

    it('search by words, folder (with subfolders) and tag', async () => {
      const sub = await admin.post('/api/kb/folders', { title: 'Panels', parentId: f().Products });
      expect(sub.status).toBe(201);
      await admin.post('/api/kb/articles', {
        folderId: sub.body.id,
        title: 'Colour temperatures',
        bodyHtml: '<p>Warm white is 3000K</p>',
        tags: ['led'],
      });
      const titles = async (q: string) =>
        ((await agent.get(`/api/kb/articles?${q}`)).body as { title: string }[]).map((x) => x.title).sort();
      expect(await titles('q=warm whi')).toEqual(['Colour temperatures']);
      expect(await titles(`folderId=${f().Products}`)).toEqual(['Colour temperatures', 'LED panels: common questions']);
      expect(await titles('tag=led')).toEqual(['Colour temperatures', 'LED panels: common questions']);
      expect(
        (await admin.put(`/api/kb/folders/${f().Products}`, { title: 'Products', parentId: sub.body.id })).body.reason,
      ).toBe('folder_cycle');
    });

    it('"Create article" from a ticket activity pre-fills the draft from that activity', async () => {
      const r = (await receive(ctx.app, ctx.ids.helpdesk.mailbox, {
        from: 'q@example.com',
        subject: 'How do I reset the driver?',
        text: 'Hold the button for 5 seconds.',
      })) as { ticketId: number; activityId: string };
      const draft = await admin.get(`/api/kb/drafts/from-activity/${r.activityId}`);
      expect(draft.body).toMatchObject({ title: 'How do I reset the driver?', sourceActivityId: r.activityId });
      expect(draft.body.bodyHtml).toContain('Hold the button');
      const made = await admin.post('/api/kb/articles', {
        folderId: f().Products,
        title: draft.body.title,
        bodyHtml: draft.body.bodyHtml,
        sourceActivityId: r.activityId,
      });
      expect(made.status).toBe(201);
    });

    it('images may only point at the article’s own files; files download with the article’s rights', async () => {
      const a = await admin.post('/api/kb/articles', {
        folderId: f().Products,
        title: 'Pictures',
        bodyHtml: '<p>x</p>',
      });
      const up = await admin.agent
        .post(`/api/kb/articles/${a.body.id}/files`)
        .set('x-csrf-token', admin.csrf)
        .attach('file', Buffer.from('GIF89a'), { filename: 'pic.gif', contentType: 'image/gif' });
      expect(up.status).toBe(201);
      await admin.put(`/api/kb/articles/${a.body.id}`, {
        folderId: f().Products,
        title: 'Pictures',
        bodyHtml: `<p><img src="${up.body.url}" alt="ok"><img src="https://tracker.example/p.gif"><img src="javascript:alert(1)"></p>`,
      });
      const body = (await agent.get(`/api/kb/articles/${a.body.id}`)).body.bodyHtml as string;
      expect(body).toContain(`src="${up.body.url}"`);
      expect(body).not.toContain('tracker');
      expect(body).not.toContain('javascript');
      const file = await agent.get(up.body.url);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toBe('image/gif');
    });
  });
});
