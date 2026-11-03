import { and, eq, isNull } from 'drizzle-orm';
import { fullAccessProfile, normaliseAccessProfile, type AccessProfile, type UserType } from '@relay-desk/domain';
import { PasswordService } from '../auth/password.service';
import { createDb, createPool, type Db } from './db';
import { accessProfiles, rightsProfiles, users } from './schema';

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
    Administrator: { userVisibility: 'all' as const, editAllAccessProfiles: true, editAllRightsProfiles: true },
    'Standard agent': { userVisibility: 'all' as const, editAllAccessProfiles: false, editAllRightsProfiles: false },
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
  return { accessProfiles: ap, rightsProfiles: rp };
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
