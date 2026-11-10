import { and, count, eq, isNull } from 'drizzle-orm';
import { normaliseEmail } from '@relay-desk/domain';
import { randomBytes } from 'node:crypto';
import { PasswordService } from '../auth/password.service';
import { loadConfig } from '../config/config';
import { createDb, createPool, type Db } from './db';
import { SEED_ACCESS_PROFILES } from './seed';
import { accessProfiles, crmDatabases, mailboxQueues, users } from './schema';
import { setupSupportTeam } from './setup-support-team';

/** The people the Ricoman setup has a rights profile and views for (first names). */
export const KNOWN_PEOPLE = ['Richard', 'Ryan', 'Thierry', 'Heather'] as const;
type Known = (typeof KNOWN_PEOPLE)[number];

export interface InstallPerson {
  name: string;
  email: string;
  role: 'administrator' | 'agent';
}

export interface InstallResult {
  people: { name: string; email: string; role: string; temporaryPassword: string | null }[];
  linkedPersonViews: string[];
}

export class InstallRefused extends Error {}

/** "Richard Smith <richard@ricoman.com>" → name and email. */
export function parsePerson(spec: string, role: InstallPerson['role']): InstallPerson {
  const m = /^\s*(.+?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(spec);
  if (!m)
    throw new InstallRefused(
      `Write each person as "Full Name <email>", e.g. "Richard Smith <richard@ricoman.com>". Got: ${spec}`,
    );
  return { name: m[1]!, email: normaliseEmail(m[2]!), role };
}

/**
 * First install on an empty database, with no demo data: the starter access profiles, the
 * Customers database, the Ricoman Support structure (categories, rights, views, inboxes,
 * working hours, reply targets) and the named staff accounts. Refuses if any account exists.
 *
 * With Google sign-in on (GOOGLE_SIGNIN_DOMAIN), staff have no password; administrators get a
 * one-time emergency password, which only works once they turn on two-factor. Without it,
 * everyone gets a temporary password to change at first sign-in.
 */
export async function install(
  db: Db,
  people: InstallPerson[],
  opts: { googleDomain?: string; passwordSignIn?: 'all' | 'administrators' | 'none' } = {},
): Promise<InstallResult> {
  const [{ n }] = (await db.select({ n: count() }).from(users)) as [{ n: number }];
  if (n > 0) {
    throw new InstallRefused(
      `Relay Desk is already installed here (${n} account${n === 1 ? '' : 's'}). Add people in Settings › Users. ` +
        'If this database holds demo data from pnpm db:seed, start again on an empty database.',
    );
  }
  if (!people.some((p) => p.role === 'administrator')) throw new InstallRefused('Name at least one administrator.');
  const seen = new Set<string>();
  for (const p of people) {
    if (seen.has(p.email)) throw new InstallRefused(`${p.email} is listed twice.`);
    seen.add(p.email);
    if (opts.googleDomain && !p.email.endsWith(`@${opts.googleDomain}`)) {
      throw new InstallRefused(`${p.email} is not on ${opts.googleDomain}, so they could not sign in with Google.`);
    }
    if (!keyOf(p)) {
      throw new InstallRefused(
        `${p.name}: the Ricoman setup has views and rights for ${KNOWN_PEOPLE.join(', ')}. ` +
          'Install with those first; add anyone else afterwards in Settings › Users.',
      );
    }
  }

  // Access profiles (what each kind of user can do) and the default CRM database.
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
          .values({ name, description: `${name} profile`, ...profile })
          .returning()
      )[0]!.id;
  }
  const [defaultDb] = await db
    .select({ id: crmDatabases.id })
    .from(crmDatabases)
    .where(and(eq(crmDatabases.isDefault, true), isNull(crmDatabases.deletedAt)));
  if (!defaultDb) await db.insert(crmDatabases).values({ title: 'Customers', isDefault: true });

  // Categories, rights profiles, views, inboxes, working hours and reply targets.
  const setup = await setupSupportTeam(db);

  const passwords = new PasswordService();
  const created: InstallResult['people'] = [];
  for (const p of people) {
    const key = keyOf(p)!;
    const admin = p.role === 'administrator';
    // Staff on Google sign-in have no password at all; administrators keep an emergency one.
    const needsPassword = !opts.googleDomain || admin || opts.passwordSignIn === 'all';
    const temporaryPassword = needsPassword ? tempPassword() : null;
    await db.insert(users).values({
      email: p.email,
      name: p.name,
      type: admin ? 'administrator' : 'agent',
      passwordHash: temporaryPassword ? await passwords.hash(temporaryPassword) : null,
      passwordChangedAt: temporaryPassword ? new Date() : null,
      accessProfileId: ap[admin ? 'Administrator' : 'Agent']!,
      rightsProfileId: setup.rightsProfiles[key]!,
    });
    // A personal inbox is that person's own Gmail address.
    const box = (setup.mailboxes as Record<string, string>)[key];
    if (box) await db.update(mailboxQueues).set({ address: p.email }).where(eq(mailboxQueues.id, box));
    created.push({ name: p.name, email: p.email, role: p.role, temporaryPassword });
  }

  // Run again now the accounts exist: links person views and personal inboxes to them.
  const linked = await setupSupportTeam(db);
  return { people: created, linkedPersonViews: linked.linkedPersonViews };
}

function keyOf(p: InstallPerson): Known | undefined {
  const first = p.name.trim().split(/\s+/)[0]!.toLowerCase();
  const local = p.email.split('@')[0]!.toLowerCase();
  return KNOWN_PEOPLE.find((k) => k.toLowerCase() === first || k.toLowerCase() === local);
}

function tempPassword(): string {
  // 18 random bytes as base64url: 24 characters, well past the password policy.
  return randomBytes(18).toString('base64url');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const people: InstallPerson[] = [];
  try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '--admin' || a === '--agent') {
        const spec = args[++i];
        if (!spec) throw new InstallRefused(`${a} needs "Full Name <email>"`);
        people.push(parsePerson(spec, a === '--admin' ? 'administrator' : 'agent'));
      } else if (a !== '--')
        throw new InstallRefused(`Unknown option ${a}. Use --admin "Name <email>" and --agent "Name <email>".`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  install(createDb(pool), people, {
    googleDomain: config.GOOGLE_SIGNIN_DOMAIN || undefined,
    passwordSignIn: config.PASSWORD_SIGNIN,
  })
    .then((r) => {
      console.log('Relay Desk is installed (no demo data).\n');
      for (const p of r.people) {
        const sign = p.temporaryPassword
          ? config.GOOGLE_SIGNIN_DOMAIN
            ? `Google sign-in; emergency password ${p.temporaryPassword} (works once two-factor is on)`
            : `temporary password ${p.temporaryPassword} (change it at first sign-in)`
          : 'Google sign-in';
        console.log(`  ${p.role.padEnd(13)} ${p.name} <${p.email}>: ${sign}`);
      }
      console.log('\nThese passwords are shown once. Keep them somewhere safe, then sign in at', config.PUBLIC_URL);
      const waiting = KNOWN_PEOPLE.filter((k) => !r.linkedPersonViews.includes(k));
      if (waiting.length) console.log(`Views waiting for an account: ${waiting.join(', ')}.`);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
