import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { unzipSync, strFromU8 } from 'fflate';
import { DB, type Db } from '../src/db/db';
import { attachments, auditLog, categories, contacts, emailMessages, tickets } from '../src/db/schema';
import { GdprService } from '../src/gdpr/gdpr.service';
import { JobsService } from '../src/jobs/jobs.service';
import { StorageService } from '../src/storage/storage.service';
import { createTestContext, loginAs, type Client, type TestContext } from './helpers';
import { receive } from './mail-helpers';

/**
 * Phase 6 done-when (spec 20): "erasing a contact leaves no personal data in its tickets'
 * emails or attachments, and the audit log records it." Plus search, bulk jobs, import and
 * export, merge, anonymise, subject access export and retention (spec 12.4, 14).
 */
describe('Phase 6 acceptance', () => {
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
    await ctx.app.get(JobsService).settle();
    await ctx.close();
  });

  const settle = () => ctx.app.get(JobsService).settle();
  const support = () => ctx.ids.helpdesk.categories.support;
  const customerType = () => ({ [ctx.ids.crm.fields.customerType]: 'individual' });
  const newContact = async (name: string, email: string) => {
    const r = await admin.post('/api/crm/contacts', {
      databaseId: ctx.ids.crm.customersDb,
      name,
      emails: [email],
      customFields: customerType(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  const job = async (id: string) => {
    await settle();
    return (await admin.get(`/api/jobs/${id}`)).body;
  };
  const leaks = async (needle: string) => {
    const like = `%${needle}%`;
    const r = await db.execute<{ n: number }>(sql`
      select (select count(*) from email_messages where (email_messages.*)::text ilike ${like})
           + (select count(*) from activities where body_html ilike ${like})
           + (select count(*) from tickets where (tickets.*)::text ilike ${like})
           + (select count(*) from history_entries where changes::text ilike ${like})
           + (select count(*) from notifications where (notifications.*)::text ilike ${like})
           + (select count(*) from attachments where filename ilike ${like})
           + (select count(*) from contacts where (contacts.*)::text ilike ${like}) as n`);
    return Number(r.rows[0]!.n);
  };

  describe('right to erasure (spec 14)', () => {
    it("erasing a contact leaves no personal data in its tickets' emails or attachments, and the audit log records it", async () => {
      const contactId = await newContact('Zelda Quixote', 'zelda.quixote@example.com');
      const mail = (await receive(ctx.app, ctx.ids.helpdesk.mailbox, {
        from: 'Zelda Quixote <zelda.quixote@example.com>',
        subject: 'Delivery to 12 Acacia Avenue',
        text: 'Please call me on 07911 123456 about my order.',
        attachments: [{ filename: 'zelda-passport.txt', content: 'Passport number 123456789' }],
      })) as { ticketId: number };
      const id = mail.ticketId;
      expect((await db.select().from(tickets).where(eq(tickets.id, id)))[0]!.contactId).toBe(contactId);
      await agent.post(`/api/tickets/${id}/comments`, {
        bodyHtml: '<p>Spoke to Zelda Quixote, she lives at 12 Acacia Avenue</p>',
      });
      const files = [
        ...(await db.select({ k: attachments.storageKey }).from(attachments)).map((a) => a.k),
        ...(await db.select({ k: emailMessages.rawStorageKey }).from(emailMessages)).map((m) => m.k!).filter(Boolean),
      ];
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(await leaks('zelda')).toBeGreaterThan(0);

      expect((await admin.post(`/api/crm/contacts/${contactId}/erase`, { confirmation: 'yes' })).body.reason).toBe(
        'confirmation_required',
      );
      const res = await admin.post(`/api/crm/contacts/${contactId}/erase`, { confirmation: 'ERASE' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await job(res.body.id)).status).toBe('done');

      for (const needle of ['zelda', 'quixote', 'acacia', '07911', 'passport'])
        expect(await leaks(needle), needle).toBe(0);
      const storage = ctx.app.get(StorageService);
      for (const k of files) await expect(storage.get(k)).rejects.toThrow();
      const [m] = await db.select().from(emailMessages);
      expect(m).toMatchObject({
        subject: '[removed]',
        bodyText: '',
        rawStorageKey: null,
        from: { address: 'anonymised@invalid' },
      });
      const [t] = await db.select().from(tickets).where(eq(tickets.id, id));
      expect(t).toMatchObject({ isAnonymised: true, categoryId: support(), state: 'open' });
      const audit = await db.select().from(auditLog).where(eq(auditLog.eventType, 'gdpr.erased'));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorUserId: admin.userId, targetId: contactId });
      expect(audit[0]!.createdAt).toBeInstanceOf(Date);
    });

    it('anonymising a ticket needs the anonymise access and a typed confirmation', async () => {
      const id = (await admin.post('/api/tickets', { title: 'Call Jo Bloggs back', categoryId: support() })).body.id;
      expect((await agent.post(`/api/tickets/${id}/anonymise`, { confirmation: `ANONYMISE ${id}` })).status).toBe(403);
      expect((await admin.post(`/api/tickets/${id}/anonymise`, { confirmation: 'ANONYMISE' })).status).toBe(400);
      expect((await admin.post(`/api/tickets/${id}/anonymise`, { confirmation: `ANONYMISE ${id}` })).status).toBe(200);
      const t = (await admin.get(`/api/tickets/${id}`)).body;
      expect(t).toMatchObject({ title: `Anonymised ticket #${id}`, categoryId: support() });
      expect(await leaks('bloggs')).toBe(0);
    });

    it('a subject access export is one ZIP of the contact, tickets, emails and attachments', async () => {
      const contactId = await newContact('Sam Jones', 'sam.jones@example.com');
      await receive(ctx.app, ctx.ids.helpdesk.mailbox, {
        from: 'sam.jones@example.com',
        subject: 'My order',
        attachments: [{ filename: 'invoice.txt', content: 'Invoice 42' }],
      });
      const res = await admin.post(`/api/crm/contacts/${contactId}/subject-access-export`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await job(res.body.id)).hasFile).toBe(true);
      const file = await admin.agent
        .get(`/api/jobs/${res.body.id}/file`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      const zip = unzipSync(new Uint8Array(file.body as Buffer));
      const names = Object.keys(zip);
      expect(names).toContain('contact.json');
      expect(names.some((n) => n.startsWith('tickets/'))).toBe(true);
      expect(names.some((n) => n.startsWith('emails/') && n.endsWith('.eml'))).toBe(true);
      expect(names.some((n) => n.endsWith('invoice.txt'))).toBe(true);
      expect(JSON.parse(strFromU8(zip['contact.json']!))).toMatchObject({
        name: 'Sam Jones',
        emails: ['sam.jones@example.com'],
      });
      expect((await agent.post(`/api/crm/contacts/${contactId}/subject-access-export`)).status).toBe(403);
    });

    it('retention: tickets archived longer than the category allows are anonymised by the minute job', async () => {
      const id = (await admin.post('/api/tickets', { title: 'Old thing for Kim', categoryId: support() })).body.id;
      await db
        .update(categories)
        .set({ retentionAction: 'anonymise', retentionDays: 30 })
        .where(eq(categories.id, support()));
      await db
        .update(tickets)
        .set({ state: 'archived', archivedAt: new Date(Date.now() - 40 * 86_400_000) })
        .where(eq(tickets.id, id));
      expect(await ctx.app.get(GdprService).applyRetention()).toBe(1);
      expect((await db.select().from(tickets).where(eq(tickets.id, id)))[0]!.isAnonymised).toBe(true);
      expect(await ctx.app.get(GdprService).applyRetention()).toBe(0);
    });
  });

  describe('search (spec 14)', () => {
    it('finds tickets by words in email bodies, email subjects and comments (full text), within the user’s rights', async () => {
      const r = (await receive(ctx.app, ctx.ids.helpdesk.mailbox, {
        from: 'a@example.com',
        subject: 'Hello',
        text: 'The flux capacitor is leaking',
      })) as { ticketId: number };
      await agent.post(`/api/tickets/${r.ticketId}/comments`, { bodyHtml: '<p>Replaced the <b>gasket</b></p>' });
      const ids = async (q: string) =>
        ((await agent.get(`/api/search?q=${encodeURIComponent(q)}`)).body.tickets as { id: number }[]).map((t) => t.id);
      expect(await ids('capacitor')).toContain(r.ticketId);
      expect(await ids('flux capac')).toContain(r.ticketId);
      expect(await ids('gasket')).toContain(r.ticketId);
      expect(await ids('zz')).toEqual([]);
      const hidden = (
        await admin.post('/api/tickets', {
          title: 'Intake capacitor form',
          categoryId: ctx.ids.helpdesk.categories.intake,
        })
      ).body.id;
      expect(await ids('capacitor')).not.toContain(hidden);
    });
  });

  describe('bulk operations (spec 14)', () => {
    it('bulk delete is soft; an administrator restores within 30 days', async () => {
      const a = (await admin.post('/api/tickets', { title: 'Delete me', categoryId: support() })).body.id;
      const res = await admin.post('/api/tickets/bulk-delete', { ids: [a] });
      expect(res.body).toMatchObject({ deleted: [a], failed: [] });
      expect((await admin.get(`/api/tickets/${a}`)).status).toBe(404);
      const list = (await admin.get('/api/deleted/tickets')).body as { id: string }[];
      expect(list.map((x) => x.id)).toContain(String(a));
      expect((await agent.get('/api/deleted/tickets')).status).toBe(403);
      expect((await admin.post(`/api/deleted/tickets/${a}/restore`)).status).toBe(200);
      expect((await admin.get(`/api/tickets/${a}`)).status).toBe(200);
      await db
        .update(tickets)
        .set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) })
        .where(eq(tickets.id, a));
      expect((await admin.post(`/api/deleted/tickets/${a}/restore`)).status).toBe(404);
    });

    it('bulk edit and bulk delete above 200 items run as a background job with progress', async () => {
      const values = Array.from({ length: 205 }, (_, i) => ({ title: `Bulk ${i}`, categoryId: support() }));
      const ids = (await db.insert(tickets).values(values).returning({ id: tickets.id })).map((t) => t.id);
      const edit = await admin.post('/api/tickets/bulk-edit', { ticketIds: ids, changes: { priority: 'high' } });
      expect(edit.body.job).toMatchObject({ kind: 'bulk_edit' });
      expect(await job(edit.body.job.id)).toMatchObject({
        status: 'done',
        total: 205,
        done: 205,
        result: { done: 205, failed: 0 },
      });
      const [{ n }] = (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from tickets where priority = 'high' and title like 'Bulk %'`,
        )
      ).rows as [{ n: number }];
      expect(n).toBe(205);
      const del = await admin.post('/api/tickets/bulk-delete', { ids });
      expect((await job(del.body.job.id)).result).toMatchObject({ done: 205 });
      const notices = (await admin.get('/api/me/notifications')).body.items as { kind: string }[];
      expect(notices.filter((x) => x.kind === 'job_done')).toHaveLength(2);
    });
  });

  describe('import and export (spec 12.4)', () => {
    const upload = (c: Client, content: string, name = 'contacts.csv') =>
      c.agent.post('/api/imports/upload').set('x-csrf-token', c.csrf).attach('file', Buffer.from(content), name);

    it('import: upload, guess the mapping, preview, then a job that skips or updates duplicates and reports errors', async () => {
      await newContact('Existing Person', 'exist@example.com');
      const csv =
        'Full name,E-mail,Telephone,Company,Customer type\nNew Person,new@example.com,07911 123456,Acme Supplies Ltd,individual\nExisting Again,exist@example.com,,,business\n,nobody@example.com,,,\n';
      const up = await upload(admin, csv);
      expect(up.status, JSON.stringify(up.body)).toBe(201);
      expect(up.body).toMatchObject({
        headers: ['Full name', 'E-mail', 'Telephone', 'Company', 'Customer type'],
        total: 3,
      });
      const mapping = {
        'Full name': 'name',
        'E-mail': 'emails',
        Telephone: 'phones',
        Company: 'account',
        'Customer type': 'custom:customer_type',
      };
      const run = await admin.post('/api/imports', {
        fileId: up.body.fileId,
        entity: 'contacts',
        databaseId: ctx.ids.crm.customersDb,
        mapping,
        duplicate: 'skip',
        matchOn: 'email',
      });
      expect(run.status, JSON.stringify(run.body)).toBe(201);
      const done = await job(run.body.id);
      expect(done.result).toEqual({ created: 1, updated: 0, skipped: 1, failed: 1 });
      expect(done.hasFile).toBe(true);
      const report = await admin.get(`/api/jobs/${run.body.id}/file`);
      expect(report.text).toMatch(/No name/);
      const [created] = await db.select().from(contacts).where(eq(contacts.name, 'New Person'));
      expect(created).toMatchObject({ emails: ['new@example.com'], phones: ['+447911123456'] });
      expect(created!.accountId).not.toBeNull();

      const again = await upload(admin, csv);
      const upd = await admin.post('/api/imports', {
        fileId: again.body.fileId,
        entity: 'contacts',
        databaseId: ctx.ids.crm.customersDb,
        mapping,
        duplicate: 'update',
        matchOn: 'email',
      });
      expect((await job(upd.body.id)).result).toMatchObject({ updated: 2, created: 0 });
      expect(
        (
          await db
            .select()
            .from(contacts)
            .where(eq(contacts.emails, ['exist@example.com']))
        )[0]!.name,
      ).toBe('Existing Again');

      const tpl = await admin.post('/api/imports/templates', { entity: 'contacts', name: 'Unleashed export', mapping });
      expect(tpl.status).toBe(201);
      expect(
        (await admin.get('/api/imports/templates?entity=contacts')).body.map((x: { name: string }) => x.name),
      ).toEqual(['Unleashed export']);
      expect((await upload(agent, csv)).status).toBe(403);
    });

    it('export: the filtered list with chosen columns as CSV or XLSX, needing the export access', async () => {
      await newContact('=cmd|calc', 'formula@example.com');
      const csv = await admin.get('/api/exports/contacts?format=csv&columns=name,emails&q=formula');
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text).toBe("﻿Name,Emails\r\n'=cmd|calc,formula@example.com\r\n");
      const xlsx = await admin.agent
        .get('/api/exports/tickets?format=xlsx&columns=id,title,state')
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      expect((await agent.get('/api/exports/contacts')).status).toBe(403);
    });

    it('ticket emails export as a ZIP of .eml files', async () => {
      const r = (await receive(ctx.app, ctx.ids.helpdesk.mailbox, { from: 'zip@example.com', subject: 'Zip me' })) as {
        ticketId: number;
      };
      const res = await admin.post('/api/exports/tickets/emails', { q: 'Zip me' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect((await job(res.body.id)).result).toMatchObject({ tickets: 1, emails: 1 });
      expect(r.ticketId).toBeGreaterThan(0);
    });
  });

  describe('merge (spec 12.4)', () => {
    it('merging contacts keeps the survivor, combines emails, moves tickets and records the merge', async () => {
      const a = await newContact('Jo Smith', 'jo@a.example');
      const b = await newContact('Joanne Smith', 'jo@b.example');
      const t = (await admin.post('/api/tickets', { title: 'From Joanne', categoryId: support(), contactId: b })).body
        .id;
      const res = await admin.post('/api/crm/contacts/merge', { survivorId: a, ids: [a, b], choices: { name: b } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const survivor = (await admin.get(`/api/crm/contacts/${a}`)).body;
      expect(survivor).toMatchObject({ name: 'Joanne Smith', emails: ['jo@a.example', 'jo@b.example'] });
      expect((await admin.get(`/api/tickets/${t}`)).body.contactId).toBe(a);
      expect((await admin.get(`/api/crm/contacts/${b}`)).status).toBe(404);
      const hist = (await admin.get(`/api/crm/contacts/${a}/history`)).body as { action: string }[];
      expect(hist.some((h) => h.action === 'merge')).toBe(true);
      expect((await admin.post('/api/crm/contacts/merge', { survivorId: a, ids: [a, a] })).body.reason).toBe(
        'invalid_merge',
      );
    });

    it('merging accounts moves their contacts to the survivor', async () => {
      const x = (await admin.post('/api/crm/accounts', { databaseId: ctx.ids.crm.customersDb, name: 'Northgate Ltd' }))
        .body.id;
      const y = (
        await admin.post('/api/crm/accounts', { databaseId: ctx.ids.crm.customersDb, name: 'Northgate Limited' })
      ).body.id;
      const c = (
        await admin.post('/api/crm/contacts', {
          databaseId: ctx.ids.crm.customersDb,
          name: 'Dee',
          accountId: y,
          customFields: customerType(),
        })
      ).body.id;
      expect((await admin.post('/api/crm/accounts/merge', { survivorId: x, ids: [x, y] })).status).toBe(200);
      expect((await admin.get(`/api/crm/contacts/${c}`)).body.accountId).toBe(x);
    });
  });
});
