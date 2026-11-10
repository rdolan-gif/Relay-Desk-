import { and, asc, eq, ilike, isNull, or } from 'drizzle-orm';
import { fullAccessProfile } from '@relay-desk/domain';
import { PasswordService } from '../auth/password.service';
import { SlaService } from '../sla/sla.service';
import { createDb, createPool, type Db } from './db';
import {
  DEFAULT_SEED_PASSWORD,
  enquiryTypeField,
  seed,
  seedKb,
  seedMacro,
  seedRoutingRules,
  seedSla,
  seedTimeGroup,
} from './seed';
import type { Address } from '@relay-desk/domain';
import {
  accessProfiles,
  accounts,
  activities,
  categories,
  categoryStatuses,
  contacts,
  crmDatabases,
  rightsProfileCategories,
  rightsProfileMailboxes,
  rightsProfileKbFolders,
  mailboxQueues,
  mailboxQueueCrmDatabases,
  rightsProfileCrmDatabases,
  rightsProfileTicketViews,
  rightsProfiles,
  sidebarItems,
  ticketFollowers,
  ticketStatuses,
  ticketViews,
  tickets,
  users,
} from './schema';

/**
 * The Support team's starting structure (owner answers, 04/11/2026, Q1, Q3):
 * - Enquiries: tickets from the shared Support inbox.
 * - The current Gmail labels as categories: Heather, Thierry, Ryan, Richard,
 *   Accounts & Returns, Resolution Centre.
 * - Personal inbox categories (Ryan's / Thierry's / Heather's Tickets), visible only to
 *   that agent.
 * Everything here can be edited afterwards in Settings. Idempotent.
 */
const SHARED = ['Enquiries', 'Accounts & Returns', 'Resolution Centre'];
const LABELS = ['Heather', 'Thierry', 'Ryan', 'Richard'];
const PERSONAL: Record<string, string> = {
  Ryan: "Ryan's Tickets",
  Thierry: "Thierry's Tickets",
  Heather: "Heather's Tickets",
};
const GROUP = { shared: 'Support inbox', labels: 'Assigned to', personal: 'Personal inboxes' };

export async function setupSupportTeam(db: Db, opts: { demo?: boolean; password?: string } = {}) {
  const status = async (title: string, color: string) => {
    const [row] = await db
      .select()
      .from(ticketStatuses)
      .where(and(eq(ticketStatuses.title, title), isNull(ticketStatuses.deletedAt)));
    return row?.id ?? (await db.insert(ticketStatuses).values({ title, color }).returning())[0]!.id;
  };
  const statusIds = [
    await status('Awaiting customer reply', 'yellow'),
    await status('Awaiting supplier', 'orange'),
    await status('Quote sent', 'blue'),
    await status('Resolved', 'green'),
    await status('FYI – no reply needed', 'gray'),
  ];
  const enquiryType = await enquiryTypeField(db);
  const enquiryLayout = {
    sections: [
      {
        id: 'enquiry',
        title: 'Enquiry',
        fields: [
          {
            fieldId: enquiryType,
            tooltip: 'Sets the reply target: purchase order 2 h, quote 4 h, other 8 h (working hours).',
          },
        ],
      },
    ],
  };

  const [customers] = await db
    .select()
    .from(crmDatabases)
    .where(and(eq(crmDatabases.isDefault, true), isNull(crmDatabases.deletedAt)));
  const category = async (title: string, groupName: string) => {
    const [row] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.title, title), isNull(categories.deletedAt)));
    if (row) {
      // Earlier runs created categories without the enquiry type on the form.
      if (!row.formLayout.sections.length) {
        await db.update(categories).set({ formLayout: enquiryLayout }).where(eq(categories.id, row.id));
      }
      return row.id;
    }
    const [c] = await db
      .insert(categories)
      .values({
        title,
        groupName,
        defaultCrmDatabaseId: customers?.id ?? null,
        autoArchiveDays: 30,
        formLayout: enquiryLayout,
      })
      .returning();
    await db.insert(categoryStatuses).values(statusIds.map((statusId) => ({ categoryId: c!.id, statusId })));
    return c!.id;
  };
  const cat: Record<string, string> = {};
  for (const t of SHARED) cat[t] = await category(t, GROUP.shared);
  for (const t of LABELS) cat[t] = await category(t, GROUP.labels);
  for (const t of Object.values(PERSONAL)) cat[t] = await category(t, GROUP.personal);

  // Reply targets (owner O-8, O-11): purchase orders 2 h, quotation requests 4 h, anything
  // else 8 h, counted in office hours with England and Wales bank holidays. The solution
  // target (5 working days) is a placeholder the team can change (open question Q-P4-1).
  const officeHours = await seedTimeGroup(db, 'Ricoman office hours', {
    week: [
      ...Array.from({ length: 4 }, () => [{ start: '08:30', end: '17:00' }]),
      [{ start: '08:30', end: '16:00' }],
      [],
      [],
    ],
  });
  const replyTargets = await seedSla(db, 'Reply targets', {
    unit: 'hours',
    basisFieldId: enquiryType,
    targets: {
      purchase_order: { response: 2, solution: 40 },
      quotation: { response: 4, solution: 40 },
      general: { response: 8, solution: 40 },
      _other: { response: 8, solution: 40 },
    },
  });
  for (const id of Object.values(cat)) {
    const attached = await db
      .update(categories)
      .set({ slaId: replyTargets, timeGroupId: officeHours })
      .where(and(eq(categories.id, id), isNull(categories.slaId)))
      .returning({ id: categories.id });
    if (attached.length) await new SlaService(db).refreshCategory(id);
  }

  const view = async (name: string, categoryId: string) => {
    const [row] = await db
      .select()
      .from(ticketViews)
      .where(and(eq(ticketViews.name, name), isNull(ticketViews.ownerUserId), isNull(ticketViews.deletedAt)));
    return (
      row?.id ??
      (
        await db
          .insert(ticketViews)
          .values({
            name,
            conditions: [
              { field: 'categoryId', op: 'is', value: categoryId },
              { field: 'state', op: 'is_not', value: 'archived' },
            ],
          })
          .returning()
      )[0]!.id
    );
  };
  const views: Record<string, string> = {};
  for (const t of [...SHARED, ...LABELS, ...Object.values(PERSONAL)]) views[t] = await view(t, cat[t]!);

  /** One rights profile per person: shared + label categories, plus their own personal inbox. */
  const rights = async (name: string, personal: string | null, admin: boolean) => {
    const [row] = await db
      .select()
      .from(rightsProfiles)
      .where(and(eq(rightsProfiles.name, name), isNull(rightsProfiles.deletedAt)));
    if (row) return row.id;
    const [rp] = await db
      .insert(rightsProfiles)
      .values({
        name,
        description: personal ? `Support team, plus ${personal}` : 'Support team line manager',
        userVisibility: 'all',
        editAllAccessProfiles: admin,
        editAllRightsProfiles: admin,
        allCrmDatabases: true,
        allCrmRecordTypes: true,
        allMacros: true,
      })
      .returning();
    const visible = [...SHARED, ...LABELS, ...(personal ? [personal] : [])];
    await db.insert(rightsProfileCategories).values(
      visible.map((t) => ({
        rightsProfileId: rp!.id,
        categoryId: cat[t]!,
        access: true,
        // Enquiries are shared out automatically to whoever has the fewest open, with no
        // cap (owner O-16). Agents then merge or reassign them.
        distribute: t === 'Enquiries',
      })),
    );
    await db
      .insert(rightsProfileTicketViews)
      .values(visible.map((t) => ({ rightsProfileId: rp!.id, viewId: views[t]! })));
    if (customers)
      await db
        .insert(rightsProfileCrmDatabases)
        .values({ rightsProfileId: rp!.id, crmDatabaseId: customers.id })
        .onConflictDoNothing();
    return rp!.id;
  };
  // Richard and Ryan are the administrators (owner O-23).
  const rp = {
    Richard: await rights('Support – Richard (line manager)', null, true),
    Ryan: await rights('Support – Ryan', PERSONAL.Ryan!, true),
    Thierry: await rights('Support – Thierry', PERSONAL.Thierry!, false),
    Heather: await rights('Support – Heather', PERSONAL.Heather!, false),
  };

  // "Unassigned" (owner O-22): open or waiting tickets nobody owns, in the shared and label
  // categories, so nothing is missed. Personal-inbox tickets are left out (they arrive without
  // an owner but belong to that person). Only the administrators have it.
  const unassignedConditions = [
    { field: 'userId', op: 'empty' as const },
    { field: 'state', op: 'is_not' as const, value: 'closed' },
    { field: 'state', op: 'is_not' as const, value: 'archived' },
    ...Object.values(PERSONAL).map((t) => ({ field: 'categoryId', op: 'is_not' as const, value: cat[t]! })),
  ];
  const [unassignedRow] = await db
    .select()
    .from(ticketViews)
    .where(and(eq(ticketViews.name, 'Unassigned'), isNull(ticketViews.ownerUserId), isNull(ticketViews.deletedAt)));
  // An existing "Unassigned" (e.g. from the demo seed) takes these conditions.
  const unassigned = unassignedRow
    ? (
        await db
          .update(ticketViews)
          .set({ conditions: unassignedConditions })
          .where(eq(ticketViews.id, unassignedRow.id))
          .returning()
      )[0]!.id
    : (await db.insert(ticketViews).values({ name: 'Unassigned', conditions: unassignedConditions }).returning())[0]!
        .id;
  views.Unassigned = unassigned;
  for (const profileId of [rp.Richard, rp.Ryan])
    await db
      .insert(rightsProfileTicketViews)
      .values({ rightsProfileId: profileId, viewId: unassigned })
      .onConflictDoNothing();

  // The four Gmail inboxes (owner O-1, O-10). Addresses can be corrected in Settings > Mailboxes;
  // each is connected with "Connect Gmail" once Google sign-in is set up.
  const mailbox = async (title: string, address: string, categoryTitle: string, senderName: string) => {
    const [row] = await db
      .select()
      .from(mailboxQueues)
      // By name too: an address corrected later (e.g. by the first install) is still the same inbox.
      .where(
        and(or(eq(mailboxQueues.address, address), eq(mailboxQueues.title, title)), isNull(mailboxQueues.deletedAt)),
      );
    if (row) return row.id;
    const [m] = await db
      .insert(mailboxQueues)
      .values({ title, address, senderName, provider: 'gmail', defaultCategoryId: cat[categoryTitle]! })
      .returning();
    if (customers) await db.insert(mailboxQueueCrmDatabases).values({ queueId: m!.id, crmDatabaseId: customers.id });
    return m!.id;
  };
  const boxes = {
    support: await mailbox('Support inbox', 'support@ricoman.com', 'Enquiries', 'Ricoman Support'),
    Ryan: await mailbox("Ryan's inbox", 'ryan@ricoman.com', PERSONAL.Ryan!, 'Ryan – Ricoman'),
    Thierry: await mailbox("Thierry's inbox", 'thierry@ricoman.com', PERSONAL.Thierry!, 'Thierry – Ricoman'),
    Heather: await mailbox("Heather's inbox", 'heather@ricoman.com', PERSONAL.Heather!, 'Heather – Ricoman'),
  };
  // Everyone can reply from Support; each person also from their own inbox.
  for (const [key, profileId] of Object.entries(rp)) {
    const allowed = [boxes.support, ...(key in boxes ? [boxes[key as keyof typeof boxes]] : [])];
    for (const queueId of allowed)
      await db.insert(rightsProfileMailboxes).values({ rightsProfileId: profileId, queueId }).onConflictDoNothing();
  }
  // Enquiry type from the subject/body (owner O-11). No automatic filtering (owner O-12).
  await seedRoutingRules(db, { enquiryType, includeNoReply: false });
  // Starter knowledge-base folders (spec 15): the team can read and write in all three.
  const kbIds = await seedKb(db, {
    Products: [],
    Processes: [],
    'Customer FAQs': [],
  });
  for (const profileId of Object.values(rp))
    for (const folderId of Object.values(kbIds))
      await db
        .insert(rightsProfileKbFolders)
        .values({ rightsProfileId: profileId, folderId, view: true, create: true, update: true })
        .onConflictDoNothing();
  // The Agent access profile may write articles (folder rights still decide where).
  const [agentProfile] = await db.select().from(accessProfiles).where(eq(accessProfiles.name, 'Agent'));
  if (agentProfile) {
    const modules = {
      ...agentProfile.modules,
      knowledge_base: { enabled: true, create: true, read: true, update: true, delete: false },
    };
    await db.update(accessProfiles).set({ modules }).where(eq(accessProfiles.id, agentProfile.id));
  }
  // A starter macro (spec 10); admins can change or add more in Settings › Macros.
  await seedMacro(
    db,
    'Waiting for customer (2 working days)',
    Object.values(cat),
    [
      { type: 'set_state', state: 'waiting' },
      { type: 'set_reopen', mode: 'relative', amount: 2, unit: 'working_days' },
      { type: 'back' },
    ],
    {
      description: 'Puts the ticket in Waiting, re-opens it in 2 working days, and goes back to the list.',
      colour: 'amber',
    },
  );

  if (opts.demo) await demoData(db, rp, cat, views, opts.password ?? DEFAULT_SEED_PASSWORD, enquiryType);
  const linked = await linkPersonViews(db, views, cat, boxes);
  return { categories: cat, views, rightsProfiles: rp, mailboxes: boxes, linkedPersonViews: linked };
}

/**
 * The Heather / Thierry / Ryan / Richard views show the tickets assigned to that person
 * (owner O-24), not the old Gmail-label category of the same name. Each view is linked to the
 * person's account, found by email (`ryan@…`) or first name; run the setup again after creating
 * the accounts at go-live. Views whose person has no account yet are left as they are. The same
 * link makes each personal inbox assign its new tickets to its owner (O-25).
 */
async function linkPersonViews(
  db: Db,
  views: Record<string, string>,
  cat: Record<string, string>,
  boxes: Record<string, string>,
): Promise<string[]> {
  const linked: string[] = [];
  for (const key of LABELS) {
    const k = key.toLowerCase();
    const [person] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.isActive, true),
          or(ilike(users.email, `${k}@%`), ilike(users.name, k), ilike(users.name, `${k} %`)),
        ),
      )
      .orderBy(asc(users.createdAt))
      .limit(1);
    if (!person) continue;
    await db
      .update(ticketViews)
      .set({
        conditions: [
          { field: 'userId', op: 'is', value: person.id },
          { field: 'state', op: 'is_not', value: 'archived' },
          // Personal-inbox tickets show only in that person's "… Tickets" view (O-25).
          ...Object.values(PERSONAL).map((t) => ({ field: 'categoryId', op: 'is_not' as const, value: cat[t]! })),
        ],
      })
      .where(eq(ticketViews.id, views[key]!));
    // Mail to a personal inbox is assigned to its owner as it arrives (O-25).
    if (key in PERSONAL && boxes[key])
      await db.update(mailboxQueues).set({ defaultUserId: person.id }).where(eq(mailboxQueues.id, boxes[key]!));
    linked.push(key);
  }
  return linked;
}

/** Demo people and tickets for showing the trial (development only; fictitious customers). */
async function demoData(
  db: Db,
  rp: Record<string, string>,
  cat: Record<string, string>,
  views: Record<string, string>,
  password: string,
  enquiryType: string,
) {
  const [agentAp] = await db.select().from(accessProfiles).where(eq(accessProfiles.name, 'Agent'));
  let [adminAp] = await db.select().from(accessProfiles).where(eq(accessProfiles.name, 'Administrator'));
  adminAp ??= (
    await db
      .insert(accessProfiles)
      .values({ name: 'Administrator', ...fullAccessProfile() })
      .returning()
  )[0]!;
  const hash = await new PasswordService().hash(password);
  const person = async (key: string, name: string, admin: boolean) => {
    const email = `${key.toLowerCase()}@relaydesk.local`;
    const [row] = await db.select().from(users).where(eq(users.email, email));
    if (row) return row.id;
    return (
      await db
        .insert(users)
        .values({
          email,
          name,
          type: admin ? 'administrator' : 'agent',
          passwordHash: hash,
          passwordChangedAt: new Date(),
          accessProfileId: admin ? adminAp!.id : agentAp!.id,
          rightsProfileId: rp[key]!,
        })
        .returning()
    )[0]!.id;
  };
  const u = {
    Richard: await person('Richard', 'Richard (Line Manager)', true),
    Ryan: await person('Ryan', 'Ryan', true),
    Thierry: await person('Thierry', 'Thierry', false),
    Heather: await person('Heather', 'Heather', false),
  };

  // My views: Enquiries and the person's own inbox first, then the shared queues and their label.
  for (const [key, id] of Object.entries(u)) {
    const order = ['Enquiries', PERSONAL[key], 'Accounts & Returns', 'Resolution Centre', key].filter(
      (x): x is string => !!x && !!views[x],
    );
    for (const [position, name] of order.entries()) {
      await db.insert(sidebarItems).values({ userId: id, viewId: views[name]!, position }).onConflictDoNothing();
    }
  }

  const [existing] = await db.select().from(tickets).where(eq(tickets.categoryId, cat.Enquiries!)).limit(1);
  if (existing) return;

  // A fictitious customer with branches: Company › Branch › Branch number (owner Q2).
  const [customersDb] = await db.select().from(crmDatabases).where(eq(crmDatabases.isDefault, true));
  const [northgate] = await db
    .insert(accounts)
    .values({ databaseId: customersDb!.id, name: 'Northgate Electrical', phones: ['+441619460000'] })
    .returning();
  const branch = async (name: string, code: string, phone: string, email: string, address: Address) =>
    (
      await db
        .insert(accounts)
        .values({
          databaseId: customersDb!.id,
          name,
          parentId: northgate!.id,
          branchCode: code,
          phones: [phone],
          emails: [email],
          addresses: [address],
        })
        .returning()
    )[0]!;
  const leeds = await branch('Leeds', '0345', '+441134960321', 'leeds@northgate-electrical.example', {
    label: 'Goods in',
    line1: 'Unit 4, Kirkstall Trade Park',
    town: 'Leeds',
    postcode: 'LS5 3BT',
    country: 'GB',
    isDelivery: true,
  });
  await branch('Sheffield', '0412', '+441144960555', 'sheffield@northgate-electrical.example', {
    label: 'Trade counter',
    line1: '17 Attercliffe Road',
    town: 'Sheffield',
    postcode: 'S4 7WZ',
    country: 'GB',
    isDelivery: true,
  });
  const [dana] = await db
    .insert(contacts)
    .values({
      databaseId: customersDb!.id,
      name: 'Dana Whitfield',
      emails: ['dana.whitfield@northgate-electrical.example'],
      phones: ['+447911654456'],
      accountId: leeds.id,
    })
    .returning();
  const sam = dana;
  const [priya] = await db.select().from(contacts).where(eq(contacts.name, 'Priya Patel'));
  const hours = (h: number) => new Date(Date.now() - h * 3_600_000);
  const demo: {
    title: string;
    cat: string;
    user?: string;
    contact?: string | null;
    priority?: 'low' | 'normal' | 'high';
    state?: 'open' | 'waiting' | 'closed';
    ago: number;
    comments?: [string, string][];
  }[] = [
    {
      title: 'Quote request: 40 x LED panel 600x600, delivery to Leeds branch',
      cat: 'Enquiries',
      contact: sam?.id,
      priority: 'high',
      ago: 2,
      comments: [['Ryan', '<p>Checked stock with Production – 40 available, lead time 3 days.</p>']],
    },
    {
      title: 'Missing driver in last week’s delivery (order 51873)',
      cat: 'Enquiries',
      user: 'Heather',
      contact: priya?.id,
      ago: 5,
    },
    {
      title: 'Emergency lighting test certificate needed for site handover',
      cat: 'Enquiries',
      ago: 7,
      priority: 'high',
    },
    {
      title: 'Credit note for returned downlights (RMA 2231)',
      cat: 'Accounts & Returns',
      user: 'Thierry',
      contact: sam?.id,
      state: 'waiting',
      ago: 26,
      comments: [['Thierry', '<p>Returns received in good condition. Waiting on accounts to raise the credit.</p>']],
    },
    { title: 'Invoice query: delivery charged twice', cat: 'Accounts & Returns', ago: 30 },
    {
      title: 'Flickering track spots – customer complaint',
      cat: 'Resolution Centre',
      user: 'Richard',
      priority: 'high',
      ago: 50,
      comments: [['Richard', '<p>Asked Technical for a site visit slot next week.</p>']],
    },
    { title: 'Follow up: pricing for the hospital refurbishment', cat: 'Ryan', user: 'Ryan', ago: 20 },
    { title: 'Sample request – linear profile 2m', cat: 'Heather', user: 'Heather', ago: 12, state: 'closed' },
    { title: 'Supplier: revised lead times for December', cat: "Ryan's Tickets", user: 'Ryan', ago: 3 },
    { title: 'Customer thank-you and repeat order enquiry', cat: "Thierry's Tickets", user: 'Thierry', ago: 9 },
    { title: 'Branch opening hours over Christmas', cat: "Heather's Tickets", user: 'Heather', ago: 4 },
  ];
  for (const d of demo) {
    const userId = d.user ? u[d.user as keyof typeof u] : null;
    const [t] = await db
      .insert(tickets)
      .values({
        title: d.title,
        categoryId: cat[d.cat]!,
        userId,
        contactId: d.contact ?? null,
        priority: d.priority ?? 'normal',
        state: d.state ?? 'open',
        reopenAt: d.state === 'waiting' ? new Date(Date.now() + 2 * 86_400_000) : null,
        closedAt: d.state === 'closed' ? hours(1) : null,
        createdAt: hours(d.ago),
        updatedAt: hours(d.ago / 2),
        lastActivityAt: hours(d.ago / 2),
        createdById: u.Richard,
        // What the routing rules would have set (owner O-11), so reply targets show.
        customFields: {
          [enquiryType]: /\bquot(e|ation)\b/i.test(d.title)
            ? 'quotation'
            : /\b(PO|purchase order)\b/i.test(d.title)
              ? 'purchase_order'
              : 'general',
        },
      })
      .returning();
    await new SlaService(db).refresh(db, [t!.id]);
    for (const [who, body] of d.comments ?? []) {
      await db.insert(activities).values({
        ticketId: t!.id,
        type: 'comment',
        userId: u[who as keyof typeof u],
        bodyHtml: body,
        createdAt: hours(d.ago / 2),
      });
      await db
        .insert(ticketFollowers)
        .values({ ticketId: t!.id, userId: u[who as keyof typeof u] })
        .onConflictDoNothing();
    }
  }
}

if (require.main === module) {
  const demo = process.argv.includes('--demo');
  if (demo && process.env.NODE_ENV === 'production') {
    console.error('Demo data is for development only.');
    process.exit(1);
  }
  const pool = createPool(process.env.DATABASE_URL ?? 'postgres://relay:relay@localhost:5432/relay_desk');
  const db = createDb(pool);
  (demo ? seed(db) : Promise.resolve())
    .then(() => setupSupportTeam(db, { demo }))
    .then(({ linkedPersonViews }) => {
      console.log(
        `Support team structure ready${demo ? ' (with demo users: richard@, ryan@, thierry@, heather@relaydesk.local)' : ''}.`,
      );
      const waiting = ['Heather', 'Thierry', 'Ryan', 'Richard'].filter((k) => !linkedPersonViews.includes(k));
      if (waiting.length)
        console.log(`No account yet for: ${waiting.join(', ')}. Create them, then run this again to link their views.`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
