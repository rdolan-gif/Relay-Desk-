import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, loginAs, type Client, type TestContext } from './helpers';

/** Owner answer Q2 (04/11/2026): customers with branches, Company › Branch › Branch number. */
describe('company › branch accounts (owner Q2)', () => {
  let ctx: TestContext;
  let admin: Client;
  beforeEach(async () => {
    ctx = await createTestContext();
    admin = await loginAs(ctx.app, 'admin@relaydesk.local');
  });
  afterEach(async () => {
    await ctx.close();
  });

  const company = () =>
    admin.post('/api/crm/accounts', { databaseId: ctx.ids.crm.customersDb, name: 'Northgate Electrical' });
  const branch = (parentId: string, extra: Record<string, unknown> = {}) =>
    admin.post('/api/crm/accounts', {
      databaseId: ctx.ids.crm.customersDb,
      name: 'Leeds',
      parentId,
      branchCode: '0345',
      phones: ['0113 496 0000'],
      emails: ['Leeds@Northgate.example'],
      addresses: [
        { label: 'Goods in', line1: 'Unit 4, Mill Lane', town: 'Leeds', postcode: 'ls14ap', isDelivery: true },
        { label: 'Office', line1: '1 Park Row', town: 'Leeds', postcode: 'LS1 5AB', isDelivery: false },
      ],
      ...extra,
    });

  it('a branch belongs to a company and shows as Company › Branch › Branch number, with details normalised', async () => {
    const co = (await company()).body;
    const res = await branch(co.id);
    expect(res.status).toBe(201);
    const leeds = (await admin.get(`/api/crm/accounts/${res.body.id}`)).body;
    expect(leeds).toMatchObject({
      path: 'Northgate Electrical › Leeds › 0345',
      parent: { id: co.id, name: 'Northgate Electrical' },
      phones: ['+441134960000'],
      emails: ['leeds@northgate.example'],
    });
    expect(leeds.addresses[0]).toMatchObject({ label: 'Goods in', postcode: 'LS1 4AP', isDelivery: true });
    const parent = (await admin.get(`/api/crm/accounts/${co.id}`)).body;
    expect(parent.branches.map((b: { path: string }) => b.path)).toEqual(['Northgate Electrical › Leeds › 0345']);
    const listed = (await admin.get('/api/crm/accounts?q=Northgate')).body.items.map((a: { path: string }) => a.path);
    expect(listed).toEqual(['Northgate Electrical', 'Northgate Electrical › Leeds › 0345']);
    expect((await admin.get('/api/crm/accounts?q=0345')).body.total).toBe(1);
  });

  it('branches cannot have branches; a company with branches cannot become one; parents stay in the same database', async () => {
    const co = (await company()).body;
    const leeds = (await branch(co.id)).body;
    expect((await branch(leeds.id)).body.reason).toBe('invalid_parent');
    const other = (await company()).body;
    expect((await admin.patch(`/api/crm/accounts/${co.id}`, { parentId: other.id })).body.reason).toBe(
      'invalid_parent',
    );
    const globex = (await admin.get('/api/crm/accounts?q=Globex')).body.items[0];
    expect((await branch(globex.id)).body.reason).toBe('invalid_parent');
    expect((await admin.delete(`/api/crm/accounts/${co.id}`)).body.reason).toBe('account_has_branches');
  });

  it('an invalid postcode is refused', async () => {
    const co = (await company()).body;
    const res = await branch(co.id, {
      addresses: [{ line1: '1 Road', town: 'Leeds', postcode: 'NOPE', isDelivery: true }],
    });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('invalid_address');
  });

  it("the ticket's contact card shows the branch path, contact details and delivery addresses", async () => {
    const co = (await company()).body;
    const leeds = (await branch(co.id)).body;
    const contact = (
      await admin.post('/api/crm/contacts', {
        databaseId: ctx.ids.crm.customersDb,
        name: 'Dana Buyer',
        emails: ['dana@northgate.example'],
        accountId: leeds.id,
        customFields: { [ctx.ids.crm.fields.customerType]: 'business' },
      })
    ).body;
    const t = (
      await admin.post('/api/tickets', {
        title: 'Quote for Leeds',
        categoryId: ctx.ids.helpdesk.categories.billing,
        contactId: contact.id,
      })
    ).body;
    const card = (await admin.get(`/api/tickets/${t.id}`)).body.contactCard;
    expect(card.account).toMatchObject({
      path: 'Northgate Electrical › Leeds › 0345',
      company: { name: 'Northgate Electrical' },
      phones: ['+441134960000'],
      emails: ['leeds@northgate.example'],
      deliveryAddresses: [expect.objectContaining({ label: 'Goods in', postcode: 'LS1 4AP' })],
    });
    expect(card.account.deliveryAddresses).toHaveLength(1);

    // The branch's enquiries are reachable from the branch, and from the company.
    const ofBranch = (await admin.get(`/api/crm/accounts/${leeds.id}/tickets`)).body;
    expect(ofBranch.items.map((x: { id: number }) => x.id)).toEqual([t.id]);
    const ofCompany = (await admin.get(`/api/crm/accounts/${co.id}/tickets`)).body;
    expect(ofCompany.items.map((x: { id: number }) => x.id)).toEqual([t.id]);
    const other = (await admin.get(`/api/crm/accounts/${(await company()).body.id}/tickets`)).body;
    expect(other.total).toBe(0);
  });
});
