import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STRONG_PASSWORD, createTestContext, loginAs, type Client, type TestContext } from './helpers';

const enc = (conds: unknown) => encodeURIComponent(JSON.stringify(conds));

describe('CRM (spec 7, 12, 14, 17)', () => {
  let ctx: TestContext;
  let admin: Client;
  beforeEach(async () => {
    ctx = await createTestContext();
    admin = await loginAs(ctx.app, 'admin@relaydesk.local');
  });
  afterEach(async () => {
    await ctx.close();
  });

  const newContact = (extra: Record<string, unknown> = {}) =>
    admin.post('/api/crm/contacts', {
      databaseId: ctx.ids.crm.customersDb,
      name: 'Test Person',
      emails: ['test@example.com'],
      customFields: { [ctx.ids.crm.fields.customerType]: 'individual' },
      ...extra,
    });

  describe('custom fields (spec 7.3)', () => {
    it('when an admin creates a field, it joins the shared pool used by every form', async () => {
      const res = await admin.post('/api/settings/custom-fields', {
        key: 'shoe_size',
        name: 'Shoe size',
        type: 'number',
      });
      expect(res.status).toBe(201);
      const meta = await admin.get('/api/crm/meta');
      expect(meta.body.customFields.map((f: { key: string }) => f.key)).toContain('shoe_size');
      expect(meta.body.filterFields.contacts.map((f: { label: string }) => f.label)).toContain('Shoe size');
    });

    it('when an admin changes a field key or type, the system refuses', async () => {
      const id = ctx.ids.crm.fields.tier;
      const field = (await admin.get(`/api/settings/custom-fields/${id}`)).body;
      expect((await admin.put(`/api/settings/custom-fields/${id}`, { ...field, key: 'level' })).status).toBe(400);
      expect((await admin.put(`/api/settings/custom-fields/${id}`, { ...field, type: 'radio' })).status).toBe(400);
    });

    it('when a duplicate key is used, the system returns 409', async () => {
      const res = await admin.post('/api/settings/custom-fields', { key: 'tier', name: 'Again', type: 'text' });
      expect(res.status).toBe(409);
    });

    it('when an admin removes an option in use, the system warns with usage counts until confirmed', async () => {
      const id = ctx.ids.crm.fields.tier;
      const field = (await admin.get(`/api/settings/custom-fields/${id}`)).body;
      const withoutGold = field.options.filter((o: { value: string }) => o.value !== 'gold');
      const warn = await admin.put(`/api/settings/custom-fields/${id}`, { ...field, options: withoutGold });
      expect(warn.status).toBe(409);
      expect(warn.body.reason).toBe('options_in_use');
      // Sam Smith (contact) and Acme Supplies (account) use "gold".
      expect(warn.body.usage).toMatchObject({ contacts: 1, accounts: 1, records: 0, total: 2, values: ['gold'] });

      const ok = await admin.put(`/api/settings/custom-fields/${id}`, {
        ...field,
        options: withoutGold,
        confirmOptionRemoval: true,
      });
      expect(ok.status).toBe(200);
      expect(ok.body.options.map((o: { value: string }) => o.value)).toEqual(['silver', 'bronze']);
    });

    it('removing an unused option needs no confirmation', async () => {
      const id = ctx.ids.crm.fields.tier;
      const field = (await admin.get(`/api/settings/custom-fields/${id}`)).body;
      const res = await admin.put(`/api/settings/custom-fields/${id}`, {
        ...field,
        options: field.options.filter((o: { value: string }) => o.value !== 'bronze'),
      });
      expect(res.status).toBe(200);
    });

    it('when a field is on a form, deleting it returns 409 naming the forms', async () => {
      const res = await admin.delete(`/api/settings/custom-fields/${ctx.ids.crm.fields.tier}`);
      expect(res.status).toBe(409);
      expect(res.body.forms).toContain('Customers (contact form)');
    });

    it('field changes are recorded in the audit log', async () => {
      await admin.post('/api/settings/custom-fields', { key: 'colour', name: 'Colour', type: 'text' });
      const log = await admin.get('/api/settings/audit-log?eventType=settings.created');
      expect(log.body.some((e: { targetType: string }) => e.targetType === 'custom_field')).toBe(true);
    });
  });

  describe('CRM databases and forms (spec 12.1, 7.4)', () => {
    it('exactly one database is the default; making another default moves the flag', async () => {
      const res = await admin.post('/api/settings/crm-databases', { title: 'Brand B', isDefault: true });
      expect(res.status).toBe(201);
      const list = (await admin.get('/api/settings/crm-databases')).body as { title: string; isDefault: boolean }[];
      expect(list.filter((d) => d.isDefault).map((d) => d.title)).toEqual(['Brand B']);
    });

    it('the default database cannot be un-defaulted or deleted', async () => {
      const db = (await admin.get(`/api/settings/crm-databases/${ctx.ids.crm.customersDb}`)).body;
      expect((await admin.put(`/api/settings/crm-databases/${db.id}`, { ...db, isDefault: false })).body.reason).toBe(
        'default_required',
      );
      expect((await admin.delete(`/api/settings/crm-databases/${db.id}`)).body.reason).toBe('default_required');
    });

    it('a database with contacts cannot be deleted; an empty one can', async () => {
      expect((await admin.delete(`/api/settings/crm-databases/${ctx.ids.crm.partnersDb}`)).body.reason).toBe(
        'database_not_empty',
      );
      const empty = await admin.post('/api/settings/crm-databases', { title: 'Empty' });
      expect((await admin.delete(`/api/settings/crm-databases/${empty.body.id}`)).status).toBe(204);
    });

    it('when a layout references an unknown field, the system refuses it', async () => {
      const res = await admin.post('/api/settings/crm-databases', {
        title: 'Bad',
        contactFormLayout: {
          sections: [{ id: 's', title: 'S', fields: [{ fieldId: '00000000-0000-4000-8000-000000000000' }] }],
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe('invalid_layout');
    });

    it('when a required custom field is missing, saving a contact returns 400 naming the field', async () => {
      const res = await newContact({ customFields: {} });
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe('invalid_form');
      expect(res.body.fieldErrors[0]).toMatchObject({ fieldId: ctx.ids.crm.fields.customerType, code: 'required' });
    });

    it('when a field is not on the database’s contact form, the system refuses it', async () => {
      const res = await newContact({
        customFields: { [ctx.ids.crm.fields.customerType]: 'individual', [ctx.ids.crm.fields.dealValue]: 5 },
      });
      expect(res.status).toBe(400);
      expect(res.body.fieldErrors[0].code).toBe('unknown_field');
    });

    it('when an email or phone is invalid, the system returns 400', async () => {
      const res = await newContact({ phones: ['12345'] });
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe('invalid_identifiers');
    });

    it('when a contact is linked to an account in another database, the system refuses', async () => {
      const globex = (await admin.get('/api/crm/accounts?q=Globex')).body.items[0];
      const res = await newContact({ accountId: globex.id });
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe('account_database_mismatch');
    });
  });

  describe('history and snapshots (spec 12.2, 17)', () => {
    it('every field change is logged with old and new values and the form can be viewed as it was', async () => {
      const created = await newContact();
      const id = created.body.id as string;
      await new Promise((r) => setTimeout(r, 30));
      const between = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 30));
      const updated = await admin.patch(`/api/crm/contacts/${id}`, {
        name: 'Renamed Person',
        customFields: { [ctx.ids.crm.fields.tier]: 'silver' },
      });
      expect(updated.status).toBe(200);

      const history = (await admin.get(`/api/crm/contacts/${id}/history`)).body;
      expect(history.map((h: { action: string }) => h.action)).toEqual(['create', 'update']);
      expect(history[1].userName).toBe('Ada Admin');
      expect(history[1].sessionId).toBeTruthy();
      expect(history[1].changes).toEqual(
        expect.arrayContaining([
          { field: 'name', old: 'Test Person', new: 'Renamed Person' },
          { field: `custom.${ctx.ids.crm.fields.tier}`, old: null, new: 'silver' },
        ]),
      );

      const snap = await admin.get(`/api/crm/contacts/${id}/snapshot?at=${encodeURIComponent(between)}`);
      expect(snap.status).toBe(200);
      expect(snap.body.name).toBe('Test Person');
      expect(snap.body.customFields).toEqual({ [ctx.ids.crm.fields.customerType]: 'individual' });

      const before = await admin.get(`/api/crm/contacts/${id}/snapshot?at=2000-01-01`);
      expect(before.status).toBe(404);
    });

    it('a save that changes nothing writes no history entry', async () => {
      const created = await newContact();
      await admin.patch(`/api/crm/contacts/${created.body.id}`, { name: 'Test Person' });
      const history = (await admin.get(`/api/crm/contacts/${created.body.id}/history`)).body;
      expect(history).toHaveLength(1);
    });

    it('accounts and records keep history too', async () => {
      const acme = (await admin.get('/api/crm/accounts?q=Acme')).body.items[0];
      await admin.patch(`/api/crm/accounts/${acme.id}`, { name: 'Acme Supplies Group' });
      const history = (await admin.get(`/api/crm/accounts/${acme.id}/history`)).body;
      expect(history.at(-1).changes).toEqual([{ field: 'name', old: 'Acme Supplies Ltd', new: 'Acme Supplies Group' }]);

      const deal = (await admin.get('/api/crm/records?q=renewal')).body.items[0];
      await admin.patch(`/api/crm/records/${deal.id}`, { status: 'won', stage: 'closed' });
      const rh = (await admin.get(`/api/crm/records/${deal.id}/history`)).body;
      expect(rh.at(-1).changes).toEqual(
        expect.arrayContaining([
          { field: 'stage', old: 'open', new: 'closed' },
          { field: 'status', old: 'qualified', new: 'won' },
        ]),
      );
    });
  });

  describe('contact list filters (spec 6.1, 12.2, 14)', () => {
    const names = async (query: string) =>
      ((await admin.get(`/api/crm/contacts?${query}`)).body.items as { name: string }[]).map((c) => c.name).sort();

    it('filters by email, phone, custom fields and dates; all conditions must match', async () => {
      expect(await names(`filter=${enc([{ field: 'emails', op: 'contains', value: 'acme' }])}`)).toEqual(['Sam Smith']);
      expect(await names(`filter=${enc([{ field: 'emails', op: 'is', value: 'PRIYA.PATEL@example.co.uk' }])}`)).toEqual(
        ['Priya Patel'],
      );
      expect(await names(`filter=${enc([{ field: 'phones', op: 'contains', value: '123 456' }])}`)).toEqual([
        'Sam Smith',
      ]);
      expect(await names(`filter=${enc([{ field: 'phones', op: 'is', value: '020 7946 0958' }])}`)).toEqual([
        'Priya Patel',
      ]);
      expect(await names(`filter=${enc([{ field: 'phones', op: 'empty' }])}`)).toEqual(['Pat Partner']);
      expect(
        await names(`filter=${enc([{ field: `custom.${ctx.ids.crm.fields.tier}`, op: 'is', value: 'gold' }])}`),
      ).toEqual(['Sam Smith']);
      expect(await names(`filter=${enc([{ field: `custom.${ctx.ids.crm.fields.tier}`, op: 'empty' }])}`)).toEqual([
        'Pat Partner',
        'Priya Patel',
      ]);
      expect(await names(`filter=${enc([{ field: 'createdAt', op: 'in_last_days', value: 1 }])}`)).toHaveLength(3);
      expect(await names(`filter=${enc([{ field: 'createdAt', op: 'before', value: '2000-01-01' }])}`)).toEqual([]);
      expect(
        await names(
          `filter=${enc([
            { field: 'name', op: 'contains', value: 'p' },
            { field: `custom.${ctx.ids.crm.fields.customerType}`, op: 'is', value: 'individual' },
          ])}`,
        ),
      ).toEqual(['Priya Patel']);
    });

    it('when a filter is invalid, the system returns 400', async () => {
      const res = await admin.get(`/api/crm/contacts?filter=${enc([{ field: 'nope', op: 'is', value: 'x' }])}`);
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe('invalid_filter');
      expect((await admin.get('/api/crm/contacts?filter=not-json')).status).toBe(400);
    });

    it('searches name, email and phone digits; sorts and paginates', async () => {
      expect(await names('q=gmail')).toEqual(['Sam Smith']);
      expect(await names('q=7946')).toEqual(['Priya Patel']);
      const page = await admin.get('/api/crm/contacts?sort=name&dir=desc&pageSize=2&page=1');
      expect(page.body.total).toBe(3);
      expect(page.body.items.map((c: { name: string }) => c.name)).toEqual(['Sam Smith', 'Priya Patel']);
      expect(page.body.items[0].accountName).toBe('Acme Supplies Ltd');
    });

    it('saved filter schemes are private to their owner', async () => {
      const saved = await admin.post('/api/me/lists/filter-schemes', {
        list: 'contacts',
        name: 'Gold customers',
        conditions: [{ field: `custom.${ctx.ids.crm.fields.tier}`, op: 'is', value: 'gold' }],
      });
      expect(saved.status).toBe(201);
      expect(
        (await admin.get('/api/me/lists/contacts/filter-schemes')).body.map((s: { name: string }) => s.name),
      ).toEqual(['Gold customers']);
      const agent = await loginAs(ctx.app, 'agent@relaydesk.local');
      expect((await agent.get('/api/me/lists/contacts/filter-schemes')).body).toEqual([]);
      expect((await agent.delete(`/api/me/lists/filter-schemes/${saved.body.id}`)).status).toBe(404);
      const dup = await admin.post('/api/me/lists/filter-schemes', {
        list: 'contacts',
        name: 'Gold customers',
        conditions: [],
      });
      expect(dup.status).toBe(409);
    });

    it('chosen columns persist per user per list', async () => {
      expect((await admin.get('/api/me/lists/contacts/columns')).body).toEqual({ columns: null });
      await admin.put('/api/me/lists/contacts/columns', { columns: ['name', 'emails', 'accountName'] });
      expect((await admin.get('/api/me/lists/contacts/columns')).body).toEqual({
        columns: ['name', 'emails', 'accountName'],
      });
    });
  });

  describe('records and record types (spec 12.2)', () => {
    it('when a record type is not in the rights, its records are invisible', async () => {
      const rp = await admin.post('/api/settings/rights-profiles', {
        name: 'No deals',
        crmDatabases: 'all',
        crmRecordTypes: [],
      });
      await admin.post('/api/settings/users', {
        email: 'nodeals@relaydesk.local',
        name: 'No Deals',
        type: 'agent',
        password: STRONG_PASSWORD,
        accessProfileId: ctx.ids.accessProfiles.Agent,
        rightsProfileId: rp.body.id,
      });
      const user = await loginAs(ctx.app, 'nodeals@relaydesk.local', STRONG_PASSWORD);
      const deal = (await admin.get('/api/crm/records')).body.items[0];
      expect((await user.get('/api/crm/records')).body.total).toBe(0);
      expect((await user.get(`/api/crm/records/${deal.id}`)).status).toBe(404);
      expect((await user.get('/api/search?q=renewal')).body.records).toEqual([]);
      expect((await user.get('/api/crm/meta')).body.recordTypes).toEqual([]);
    });

    it("a record's status must be one of its type's statuses", async () => {
      const res = await admin.post('/api/crm/records', {
        recordTypeId: ctx.ids.crm.dealType,
        title: 'X',
        status: 'bogus',
      });
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe('invalid_status');
    });

    it('a record can link a contact, account and owner; links must be visible to the user', async () => {
      const agent = await loginAs(ctx.app, 'agent@relaydesk.local');
      const pat = (await admin.get('/api/crm/contacts?q=Pat')).body.items[0];
      const bad = await agent.post('/api/crm/records', {
        recordTypeId: ctx.ids.crm.dealType,
        title: 'Partner deal',
        contactId: pat.id,
      });
      expect(bad.status).toBe(400);
      expect(bad.body.reason).toBe('unknown_contact');

      const sam = (await agent.get('/api/crm/contacts?q=Sam')).body.items[0];
      const ok = await agent.post('/api/crm/records', {
        recordTypeId: ctx.ids.crm.dealType,
        title: 'Upsell',
        status: 'new',
        contactId: sam.id,
        accountId: sam.accountId,
        userId: agent.userId,
        customFields: { [ctx.ids.crm.fields.dealValue]: '2500' },
      });
      expect(ok.status).toBe(201);
      expect(ok.body.customFields[ctx.ids.crm.fields.dealValue]).toBe(2500);
      const ofContact = await agent.get(`/api/crm/contacts/${sam.id}/records`);
      expect(ofContact.body.items.map((r: { title: string }) => r.title).sort()).toEqual([
        'Acme renewal 2027',
        'Upsell',
      ]);
    });

    it('a status still used by records cannot be removed from the type', async () => {
      const type = (await admin.get(`/api/settings/crm-record-types/${ctx.ids.crm.dealType}`)).body;
      const res = await admin.put(`/api/settings/crm-record-types/${type.id}`, {
        ...type,
        statuses: type.statuses.filter((s: { key: string }) => s.key !== 'qualified'),
      });
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('status_in_use');
    });
  });

  describe('access and rights (spec 4)', () => {
    it('a user without the CRM records module gets 403 on records and no record search results', async () => {
      const bo = await loginAs(ctx.app, 'backoffice@relaydesk.local');
      expect((await bo.get('/api/crm/records')).status).toBe(403);
      expect((await bo.get('/api/crm/contacts')).status).toBe(200);
      const search = await bo.get('/api/search?q=renewal');
      expect(search.body.records).toEqual([]);
    });

    it('search needs at least 3 characters', async () => {
      expect((await admin.get('/api/search?q=sa')).body).toEqual({ contacts: [], accounts: [], records: [] });
      expect((await admin.get('/api/search?q=sam')).body.contacts.length).toBe(1);
    });

    it('a delegated admin cannot grant CRM databases they cannot see', async () => {
      const ap = await admin.post('/api/settings/access-profiles', {
        name: 'CRM admin',
        modules: { settings_rights_profiles: { enabled: true, create: true, read: true, update: true } },
      });
      await admin.post('/api/settings/users', {
        email: 'crmadmin@relaydesk.local',
        name: 'Crm Admin',
        type: 'administrator',
        password: STRONG_PASSWORD,
        accessProfileId: ap.body.id,
        rightsProfileId: ctx.ids.rightsProfiles['Standard agent'],
      });
      // Standard agent rights: only the Customers database, and no profile-editing.
      const rp = await admin.put(`/api/settings/rights-profiles/${ctx.ids.rightsProfiles['Standard agent']}`, {
        name: 'Standard agent',
        crmDatabases: [ctx.ids.crm.customersDb],
        crmRecordTypes: 'all',
        editableRightsProfiles: [ctx.ids.rightsProfiles['Standard agent']],
      });
      expect(rp.status).toBe(200);
      const crmAdmin = await loginAs(ctx.app, 'crmadmin@relaydesk.local', STRONG_PASSWORD);
      const res = await crmAdmin.put(`/api/settings/rights-profiles/${ctx.ids.rightsProfiles['Standard agent']}`, {
        name: 'Standard agent',
        crmDatabases: 'all',
        crmRecordTypes: 'all',
        editableRightsProfiles: [ctx.ids.rightsProfiles['Standard agent']],
      });
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('privilege_escalation');
    });
  });
});
