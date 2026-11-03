import { and, eq, isNull } from 'drizzle-orm';
import { fullAccessProfile, normaliseAccessProfile, type AccessProfile, type UserType } from '@relay-desk/domain';
import { PasswordService } from '../auth/password.service';
import { createDb, createPool, type Db } from './db';
import {
  accessProfiles,
  accounts,
  contacts,
  crmDatabases,
  crmRecordTypes,
  crmRecords,
  customFields,
  rightsProfileCrmDatabases,
  rightsProfileCategories,
  rightsProfiles,
  categories,
  categoryStatuses,
  ticketStatuses,
  ticketViews,
  tickets,
  users,
} from './schema';
import type { FieldOption, FieldType, FormLayout } from '@relay-desk/domain';

/** Development-only default; override with SEED_PASSWORD. Never used in production. */
export const DEFAULT_SEED_PASSWORD = 'harbour-lantern-violet-42';

const crud = (create: boolean, read: boolean, update: boolean, del: boolean) => ({
  enabled: true,
  create,
  read,
  update,
  delete: del,
});

export const SEED_ACCESS_PROFILES: Record<string, AccessProfile> = {
  Administrator: fullAccessProfile(),
  Agent: normaliseAccessProfile({
    modules: {
      tickets: crud(true, true, true, false),
      crm_contacts: crud(true, true, true, false),
      crm_accounts: crud(true, true, true, false),
      crm_records: crud(true, true, true, false),
      knowledge_base: crud(false, true, false, false),
    },
    flags: { can_create_own_ticket_views: true, can_merge_tickets: true, can_move_activities: true },
  }),
  'Back-office': normaliseAccessProfile({
    modules: {
      tickets: crud(false, true, true, false),
      crm_contacts: crud(false, true, false, false),
      crm_accounts: crud(false, true, false, false),
      knowledge_base: crud(false, true, false, false),
    },
  }),
};

/**
 * Idempotent seed: creates the starter profiles and demo users if missing.
 * Safe to run repeatedly; it never overwrites changes made through the app.
 */
export async function seed(db: Db, password = process.env.SEED_PASSWORD ?? DEFAULT_SEED_PASSWORD) {
  const passwords = new PasswordService();
  const ap: Record<string, string> = {};
  for (const [name, profile] of Object.entries(SEED_ACCESS_PROFILES)) {
    const [existing] = await db
      .select({ id: accessProfiles.id })
      .from(accessProfiles)
      .where(and(eq(accessProfiles.name, name), isNull(accessProfiles.deletedAt)));
    ap[name] =
      existing?.id ??
      (
        await db
          .insert(accessProfiles)
          .values({ name, description: `Seeded ${name} profile`, ...profile })
          .returning()
      )[0]!.id;
  }

  const rp: Record<string, string> = {};
  const rights = {
    Administrator: {
      userVisibility: 'all' as const,
      editAllAccessProfiles: true,
      editAllRightsProfiles: true,
      allCrmDatabases: true,
      allCrmRecordTypes: true,
      allCategories: true,
      allTicketViews: true,
    },
    'Standard agent': {
      userVisibility: 'all' as const,
      editAllAccessProfiles: false,
      editAllRightsProfiles: false,
      allCrmDatabases: false,
      allCrmRecordTypes: true,
      allCategories: false,
      allTicketViews: true,
    },
  };
  for (const [name, values] of Object.entries(rights)) {
    const [existing] = await db
      .select({ id: rightsProfiles.id })
      .from(rightsProfiles)
      .where(and(eq(rightsProfiles.name, name), isNull(rightsProfiles.deletedAt)));
    rp[name] =
      existing?.id ??
      (
        await db
          .insert(rightsProfiles)
          .values({ name, description: `Seeded ${name} rights`, ...values })
          .returning()
      )[0]!.id;
  }

  const hash = await passwords.hash(password);
  const demoUsers: { email: string; name: string; type: UserType; access: string; rights: string }[] = [
    {
      email: 'admin@relaydesk.local',
      name: 'Ada Admin',
      type: 'administrator',
      access: 'Administrator',
      rights: 'Administrator',
    },
    { email: 'agent@relaydesk.local', name: 'Alex Agent', type: 'agent', access: 'Agent', rights: 'Standard agent' },
    {
      email: 'backoffice@relaydesk.local',
      name: 'Bo Backoffice',
      type: 'back_office',
      access: 'Back-office',
      rights: 'Standard agent',
    },
  ];
  for (const u of demoUsers) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, u.email), isNull(users.deletedAt)));
    if (existing) continue;
    await db.insert(users).values({
      email: u.email,
      name: u.name,
      type: u.type,
      passwordHash: hash,
      passwordChangedAt: new Date(),
      accessProfileId: ap[u.access]!,
      rightsProfileId: rp[u.rights]!,
    });
  }
  const crm = await seedCrm(db, rp['Standard agent']!);
  const helpdesk = await seedHelpdesk(db, rp['Standard agent']!, crm);
  return { accessProfiles: ap, rightsProfiles: rp, crm, helpdesk };
}

/**
 * CRM demo data: a default "Customers" database agents can see and a "Partners"
 * database only administrators can see.
 */
async function seedCrm(db: Db, standardAgentRightsId: string) {
  const field = async (key: string, name: string, type: FieldType, options: FieldOption[] = []) => {
    const [existing] = await db.select().from(customFields).where(eq(customFields.key, key));
    return existing?.id ?? (await db.insert(customFields).values({ key, name, type, options }).returning())[0]!.id;
  };
  const opt = (...labels: string[]) => labels.map((label, i) => ({ value: label.toLowerCase(), label, sort: i + 1 }));
  const f = {
    customerType: await field('customer_type', 'Customer type', 'radio', opt('Business', 'Individual')),
    vatNumber: await field('vat_number', 'VAT number', 'text'),
    tier: await field('tier', 'Tier', 'select', opt('Gold', 'Silver', 'Bronze')),
    notes: await field('notes', 'Notes', 'textarea'),
    dealValue: await field('deal_value', 'Deal value (£)', 'number'),
    closeDate: await field('close_date', 'Expected close date', 'date'),
  };
  const contactLayout: FormLayout = {
    sections: [
      {
        id: 'details',
        title: 'Details',
        fields: [
          { fieldId: f.customerType, required: true },
          {
            fieldId: f.vatNumber,
            visibleWhen: { fieldId: f.customerType, equals: 'business' },
            tooltip: 'UK VAT registration number',
          },
          { fieldId: f.tier },
        ],
      },
      { id: 'notes', title: 'Notes', collapsed: true, fields: [{ fieldId: f.notes, rows: 4 }] },
    ],
  };
  const accountLayout: FormLayout = {
    sections: [{ id: 'account', title: 'Account', fields: [{ fieldId: f.tier }, { fieldId: f.notes, rows: 3 }] }],
  };

  const database = async (title: string, isDefault: boolean) => {
    const [existing] = await db
      .select()
      .from(crmDatabases)
      .where(and(eq(crmDatabases.title, title), isNull(crmDatabases.deletedAt)));
    return (
      existing?.id ??
      (
        await db
          .insert(crmDatabases)
          .values({ title, isDefault, contactFormLayout: contactLayout, accountFormLayout: accountLayout })
          .returning()
      )[0]!.id
    );
  };
  const customersDb = await database('Customers', true);
  const partnersDb = await database('Partners', false);
  await db
    .insert(rightsProfileCrmDatabases)
    .values({ rightsProfileId: standardAgentRightsId, crmDatabaseId: customersDb })
    .onConflictDoNothing();

  const [existingType] = await db.select().from(crmRecordTypes).where(eq(crmRecordTypes.title, 'Deal'));
  const dealType =
    existingType?.id ??
    (
      await db
        .insert(crmRecordTypes)
        .values({
          title: 'Deal',
          statuses: [
            { key: 'new', title: 'New' },
            { key: 'qualified', title: 'Qualified' },
            { key: 'won', title: 'Won' },
            { key: 'lost', title: 'Lost' },
          ],
          formLayout: {
            sections: [{ id: 'deal', title: 'Deal', fields: [{ fieldId: f.dealValue }, { fieldId: f.closeDate }] }],
          },
        })
        .returning()
    )[0]!.id;

  const account = async (databaseId: string, name: string, custom: Record<string, unknown>) => {
    const [existing] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.name, name), eq(accounts.databaseId, databaseId)));
    return (
      existing?.id ?? (await db.insert(accounts).values({ databaseId, name, customFields: custom }).returning())[0]!.id
    );
  };
  const acme = await account(customersDb, 'Acme Supplies Ltd', { [f.tier]: 'gold' });
  const globex = await account(partnersDb, 'Globex Partners', {});

  const contact = async (
    databaseId: string,
    name: string,
    emails: string[],
    phones: string[],
    accountId: string | null,
    custom: Record<string, unknown>,
  ) => {
    const [existing] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.name, name), eq(contacts.databaseId, databaseId)));
    return (
      existing?.id ??
      (
        await db
          .insert(contacts)
          .values({ databaseId, name, emails, phones, accountId, customFields: custom })
          .returning()
      )[0]!.id
    );
  };
  const sam = await contact(
    customersDb,
    'Sam Smith',
    ['sam@acme.example', 'sam.smith@gmail.example'],
    ['+447911123456'],
    acme,
    {
      [f.customerType]: 'business',
      [f.vatNumber]: 'GB123456789',
      [f.tier]: 'gold',
    },
  );
  await contact(customersDb, 'Priya Patel', ['priya.patel@example.co.uk'], ['+442079460958'], null, {
    [f.customerType]: 'individual',
  });
  await contact(partnersDb, 'Pat Partner', ['pat@globex.example'], [], globex, {});

  const [existingDeal] = await db.select().from(crmRecords).where(eq(crmRecords.title, 'Acme renewal 2027'));
  if (!existingDeal) {
    await db.insert(crmRecords).values({
      recordTypeId: dealType,
      title: 'Acme renewal 2027',
      status: 'qualified',
      contactId: sam,
      accountId: acme,
      customFields: { [f.dealValue]: 12000, [f.closeDate]: '2027-01-31' },
    });
  }
  return { customersDb, partnersDb, dealType, fields: f };
}

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_PASSWORD) {
    console.error('Refusing to seed production without SEED_PASSWORD');
    process.exit(1);
  }
  const pool = createPool(process.env.DATABASE_URL ?? 'postgres://relay:relay@localhost:5432/relay_desk');
  seed(createDb(pool))
    .then(() => {
      console.log('Seed complete. Users: admin@relaydesk.local, agent@relaydesk.local, backoffice@relaydesk.local');
      if (!process.env.SEED_PASSWORD) console.log(`Password (dev default): ${DEFAULT_SEED_PASSWORD}`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

/**
 * Helpdesk demo data: statuses, three categories (agents get Support and Billing with
 * Access, and Intake without Access), two team views and a few tickets.
 */
async function seedHelpdesk(db: Db, standardAgentRightsId: string, crm: Awaited<ReturnType<typeof seedCrm>>) {
  const status = async (title: string, color: string) => {
    const [existing] = await db.select().from(ticketStatuses).where(eq(ticketStatuses.title, title));
    return existing?.id ?? (await db.insert(ticketStatuses).values({ title, color }).returning())[0]!.id;
  };
  const st = {
    awaitingParts: await status('Awaiting parts', 'orange'),
    refundIssued: await status('Refund issued', 'teal'),
    resolved: await status('Resolved', 'green'),
    duplicate: await status('Duplicate', 'gray'),
  };
  const category = async (title: string, values: Partial<typeof categories.$inferInsert>, statusIds: string[]) => {
    const [existing] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.title, title), isNull(categories.deletedAt)));
    if (existing) return existing.id;
    const [row] = await db
      .insert(categories)
      .values({ title, ...values })
      .returning();
    if (statusIds.length)
      await db.insert(categoryStatuses).values(statusIds.map((statusId) => ({ categoryId: row!.id, statusId })));
    return row!.id;
  };
  const support = await category(
    'Support',
    {
      groupName: 'Customer service',
      statusRequired: 'on_close',
      checkChildOnClose: true,
      autoArchiveDays: 30,
      defaultCrmDatabaseId: crm.customersDb,
      formLayout: {
        sections: [
          {
            id: 'ticket',
            title: 'Ticket details',
            fields: [{ fieldId: crm.fields.tier, readOnly: true, tooltip: 'From the customer record' }],
          },
        ],
      },
    },
    [st.awaitingParts, st.resolved, st.duplicate],
  );
  const billing = await category(
    'Billing',
    {
      groupName: 'Customer service',
      waitingRequiresReopen: true,
      multipleStatuses: true,
      defaultCrmDatabaseId: crm.customersDb,
    },
    [st.refundIssued, st.resolved],
  );
  const intake = await category('Intake', { groupName: 'Back office' }, [st.resolved]);
  for (const [categoryId, access, limit] of [
    [support, true, 5],
    [billing, true, null],
    [intake, false, null],
  ] as const) {
    await db
      .insert(rightsProfileCategories)
      .values({ rightsProfileId: standardAgentRightsId, categoryId, access, distributionLimit: limit })
      .onConflictDoNothing();
  }

  const view = async (
    name: string,
    conditions: { field: string; op: 'is' | 'empty' | 'not_empty' | 'is_not'; value?: string }[],
  ) => {
    const [existing] = await db
      .select()
      .from(ticketViews)
      .where(and(eq(ticketViews.name, name), isNull(ticketViews.ownerUserId)));
    return existing?.id ?? (await db.insert(ticketViews).values({ name, conditions }).returning())[0]!.id;
  };
  const myOpen = await view('My open tickets', [
    { field: 'userId', op: 'is', value: '@me' },
    { field: 'state', op: 'is', value: 'open' },
  ]);
  const unassigned = await view('Unassigned', [
    { field: 'userId', op: 'empty' },
    { field: 'state', op: 'is_not', value: 'archived' },
  ]);

  const [anyTicket] = await db.select({ id: tickets.id }).from(tickets).limit(1);
  if (!anyTicket) {
    const [sam] = await db.select().from(contacts).where(eq(contacts.name, 'Sam Smith'));
    const [agent] = await db.select().from(users).where(eq(users.email, 'agent@relaydesk.local'));
    await db.insert(tickets).values([
      {
        title: 'Printer jams on every second page',
        categoryId: support,
        contactId: sam?.id ?? null,
        userId: agent?.id ?? null,
        priority: 'high',
      },
      { title: 'Invoice 2026-114 charged twice', categoryId: billing, contactId: sam?.id ?? null, priority: 'normal' },
      { title: 'New supplier onboarding form', categoryId: intake, priority: 'low' },
    ]);
  }
  return { statuses: st, categories: { support, billing, intake }, views: { myOpen, unassigned } };
}
