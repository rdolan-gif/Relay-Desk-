import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { GoogleSignInService } from '../src/auth/google-signin.service';
import { createDb, createPool } from '../src/db/db';
import { InstallRefused, install, parsePerson, type InstallResult } from '../src/db/install';
import { Client, TEST_DATABASE_URL, createTestContext, resetDatabase, type TestContext } from './helpers';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_SIGNIN_DOMAIN: 'ricoman.com',
  PASSWORD_SIGNIN: 'administrators',
  PUBLIC_URL: 'https://support.example.test',
};
const PEOPLE = [
  parsePerson('Richard Example <richard.example@ricoman.com>', 'administrator'),
  parsePerson('Ryan Example <Ryan.Example@ricoman.com>', 'administrator'),
  parsePerson('Thierry Example <thierry.example@ricoman.com>', 'agent'),
  parsePerson('Heather Example <heather.example@ricoman.com>', 'agent'),
];

/** Owner request: a clean live install with no demo data (pnpm db:install). */
describe('first install', () => {
  let ctx: TestContext | null = null;
  afterEach(async () => {
    await ctx?.close();
    ctx = null;
  });

  const installInto = async (people = PEOPLE) => {
    let result: InstallResult | undefined;
    ctx = await createTestContext(GOOGLE_ENV, {
      seed: async (db) => {
        result = await install(db, people, { googleDomain: 'ricoman.com', passwordSignIn: 'administrators' });
      },
    });
    return result!;
  };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const googleSignIn = async (email: string) => {
    const browser = request.agent(ctx!.app.getHttpServer());
    const start = await browser.get('/api/auth/google/start');
    const g = new URL(start.headers.location as string);
    const claims = {
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: g.searchParams.get('nonce'),
      email,
      email_verified: true,
      hd: 'ricoman.com',
    };
    ctx!.app.get(GoogleSignInService).http = async () =>
      new Response(JSON.stringify({ id_token: `${b64({})}.${b64(claims)}.sig` }), { status: 200 });
    await browser.get(`/api/auth/google/callback?code=c&state=${encodeURIComponent(g.searchParams.get('state')!)}`);
    const me = await browser.get('/api/auth/me');
    return { browser, me, csrf: me.body.csrfToken as string };
  };

  it('creates the named staff with the right roles, and no demo data at all', async () => {
    const r = await installInto();
    expect(r.people.map((p) => [p.email, p.role])).toEqual([
      ['richard.example@ricoman.com', 'administrator'],
      ['ryan.example@ricoman.com', 'administrator'],
      ['thierry.example@ricoman.com', 'agent'],
      ['heather.example@ricoman.com', 'agent'],
    ]);
    // Agents sign in with Google only; administrators also get an emergency password.
    expect(r.people.filter((p) => p.temporaryPassword).map((p) => p.role)).toEqual(['administrator', 'administrator']);
    expect(r.linkedPersonViews.sort()).toEqual(['Heather', 'Richard', 'Ryan', 'Thierry']);

    const { browser, me } = await googleSignIn('richard.example@ricoman.com');
    expect(me.body.user.type).toBe('administrator');
    const users = (await browser.get('/api/settings/users')).body as { email: string }[];
    expect(users.map((u) => u.email).sort()).toEqual(PEOPLE.map((p) => p.email).sort());
    expect((await browser.get('/api/tickets?pageSize=200')).body.total).toBe(0);
    expect((await browser.get('/api/crm/contacts')).body.total).toBe(0);
    const categories = ((await browser.get('/api/settings/categories')).body as { title: string }[]).map(
      (c) => c.title,
    );
    expect(categories).toEqual(expect.arrayContaining(['Enquiries', 'Accounts & Returns', 'Resolution Centre']));
    expect(categories).not.toEqual(expect.arrayContaining(['Support', 'Billing', 'Intake']));
    const boxes = (await browser.get('/api/settings/mailboxes')).body.mailboxes as {
      address: string;
      defaultUserId: string | null;
    }[];
    // Personal inboxes take each person's own address and assign new mail to them.
    expect(boxes.map((b) => b.address).sort()).toEqual([
      'heather.example@ricoman.com',
      'ryan.example@ricoman.com',
      'support@ricoman.com',
      'thierry.example@ricoman.com',
    ]);
    expect(boxes.find((b) => b.address === 'support@ricoman.com')!.defaultUserId).toBeNull();
    expect(boxes.filter((b) => b.defaultUserId)).toHaveLength(3);
  });

  it('Ryan is an administrator and sees Unassigned; Thierry is an agent and does not', async () => {
    await installInto();
    const views = async (email: string) => {
      const { browser } = await googleSignIn(email);
      return ((await browser.get('/api/tickets/views')).body.teamViews as { name: string }[]).map((v) => v.name);
    };
    expect(await views('ryan.example@ricoman.com')).toContain('Unassigned');
    expect(await views('thierry.example@ricoman.com')).not.toContain('Unassigned');
    expect((await googleSignIn('ryan.example@ricoman.com')).me.body.user.type).toBe('administrator');
    // Agents have no password at all, so My account offers no password change.
    expect((await googleSignIn('thierry.example@ricoman.com')).me.body.user.hasPassword).toBe(false);
    expect((await googleSignIn('ryan.example@ricoman.com')).me.body.user.hasPassword).toBe(true);
  });

  it('the emergency password only works for an administrator once two-factor is on', async () => {
    const r = await installInto();
    const richard = r.people[0]!;
    const res = await new Client(ctx!.app).login(richard.email, richard.temporaryPassword!);
    expect(res.body.reason).toBe('use_google_signin');
  });

  it('refuses to run on a database that already has accounts (e.g. demo data), and changes nothing', async () => {
    ctx = await createTestContext(); // the demo seed
    const pool = createPool(TEST_DATABASE_URL);
    try {
      await expect(install(createDb(pool), PEOPLE)).rejects.toThrow(/already installed/);
    } finally {
      await pool.end();
    }
  });

  it('checks the list first: someone off the Google domain, a duplicate, no administrator, or a typo in the format', async () => {
    const pool = createPool(TEST_DATABASE_URL);
    const db = createDb(pool);
    try {
      await resetDatabase(db);
      const opts = { googleDomain: 'ricoman.com' };
      await expect(install(db, [parsePerson('Richard X <r@gmail.com>', 'administrator')], opts)).rejects.toThrow(
        /not on ricoman.com/,
      );
      await expect(install(db, [PEOPLE[0]!, PEOPLE[0]!], opts)).rejects.toThrow(/listed twice/);
      await expect(install(db, [PEOPLE[2]!], opts)).rejects.toThrow(/at least one administrator/);
      expect(() => parsePerson('richard@ricoman.com', 'administrator')).toThrow(InstallRefused);
    } finally {
      await pool.end();
    }
  });
});
