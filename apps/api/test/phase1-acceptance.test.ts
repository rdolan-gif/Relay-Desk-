import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/db';
import { TEST_DATABASE_URL, createTestContext, loginAs, type TestContext } from './helpers';

/**
 * Phase 1 done-when (spec 20): "a contact with two emails and a UK phone saves
 * normalised; a user without that database in their rights cannot find it in list,
 * search or API."
 */
describe('Phase 1 acceptance', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it('when a contact with two emails and a UK phone is saved, the system stores them normalised', async () => {
    const agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    const res = await agent.post('/api/crm/contacts', {
      databaseId: ctx.ids.crm.customersDb,
      name: 'Jo Bloggs',
      emails: ['  Jo.Bloggs@Example.COM ', 'JO@Work.Example'],
      phones: ['07400 123456'],
      customFields: { [ctx.ids.crm.fields.customerType]: 'individual' },
    });
    expect(res.status).toBe(201);
    expect(res.body.emails).toEqual(['jo.bloggs@example.com', 'jo@work.example']);
    expect(res.body.phones).toEqual(['+447400123456']);

    const fetched = await agent.get(`/api/crm/contacts/${res.body.id}`);
    expect(fetched.body).toMatchObject({
      emails: ['jo.bloggs@example.com', 'jo@work.example'],
      phones: ['+447400123456'],
    });

    const pool = createPool(TEST_DATABASE_URL);
    const { rows } = await pool.query('select emails, phones from contacts where id = $1', [res.body.id]);
    await pool.end();
    expect(rows[0]).toEqual({ emails: ['jo.bloggs@example.com', 'jo@work.example'], phones: ['+447400123456'] });
  });

  it('when a user lacks a CRM database in their rights, its contacts and accounts are not in list, search or API', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    const { partnersDb } = ctx.ids.crm;

    // The administrator (all databases) can find the partner contact and account.
    const adminList = await admin.get('/api/crm/contacts?q=Pat%20Partner');
    expect(adminList.body.items).toHaveLength(1);
    const pat = adminList.body.items[0];
    const globex = (await admin.get('/api/crm/accounts?q=Globex')).body.items[0];
    expect(globex.name).toBe('Globex Partners');

    // List
    const list = await agent.get('/api/crm/contacts?pageSize=200');
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: { name: string }) => c.name)).not.toContain('Pat Partner');
    expect(list.body.items.every((c: { databaseId: string }) => c.databaseId !== partnersDb)).toBe(true);
    expect((await agent.get('/api/crm/contacts?q=Pat%20Partner')).body.total).toBe(0);
    const byDb = await agent.get(
      `/api/crm/contacts?filter=${encodeURIComponent(JSON.stringify([{ field: 'databaseId', op: 'is', value: partnersDb }]))}`,
    );
    expect(byDb.body.total).toBe(0);
    const byEmail = await agent.get(
      `/api/crm/contacts?filter=${encodeURIComponent(JSON.stringify([{ field: 'emails', op: 'is', value: 'pat@globex.example' }]))}`,
    );
    expect(byEmail.body.total).toBe(0);
    expect((await agent.get('/api/crm/accounts?q=Globex')).body.total).toBe(0);

    // Search
    const search = await agent.get('/api/search?q=globex');
    expect(search.status).toBe(200);
    expect(search.body.contacts).toEqual([]);
    expect(search.body.accounts).toEqual([]);
    expect((await admin.get('/api/search?q=globex')).body.contacts.map((c: { name: string }) => c.name)).toEqual([
      'Pat Partner',
    ]);

    // API by id
    for (const url of [
      `/api/crm/contacts/${pat.id}`,
      `/api/crm/contacts/${pat.id}/history`,
      `/api/crm/contacts/${pat.id}/snapshot?at=2030-01-01`,
      `/api/crm/accounts/${globex.id}`,
      `/api/crm/accounts/${globex.id}/contacts`,
    ]) {
      expect((await agent.get(url)).status, url).toBe(404);
    }
    expect((await agent.patch(`/api/crm/contacts/${pat.id}`, { name: 'Hacked' })).status).toBe(404);
    // Agents have no delete access at all, so that is refused before scoping.
    expect((await agent.delete(`/api/crm/contacts/${pat.id}`)).status).toBe(403);
    const create = await agent.post('/api/crm/contacts', { databaseId: partnersDb, name: 'Sneaky' });
    expect(create.status).toBe(404);
    expect(create.body.reason).toBe('unknown_database');

    // Metadata only lists databases in the user's rights.
    const meta = await agent.get('/api/crm/meta');
    expect(meta.body.databases.map((d: { title: string }) => d.title)).toEqual(['Customers']);
    expect((await admin.get('/api/crm/meta')).body.databases.map((d: { title: string }) => d.title)).toEqual([
      'Customers',
      'Partners',
    ]);
  });
});
