import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTotp } from '../src/auth/totp';
import { GoogleSignInService } from '../src/auth/google-signin.service';
import { Client, PASSWORD, createTestContext, loginAs, type TestContext } from './helpers';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const GOOGLE_ENV = {
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_SIGNIN_DOMAIN: 'relaydesk.local',
  PASSWORD_SIGNIN: 'administrators',
  PUBLIC_URL: 'https://support.example.test',
};

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims: object) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;

/** Owner request: staff sign in with their work Google account (one domain only). */
describe('Google sign-in', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext(GOOGLE_ENV);
  });
  afterEach(async () => {
    await ctx.close();
  });

  /** Starts the round trip in a browser-like agent, then has "Google" return the given claims. */
  const signIn = async (claims: (nonce: string) => object, browser = request.agent(ctx.app.getHttpServer())) => {
    const start = await browser.get('/api/auth/google/start');
    expect(start.status).toBe(302);
    const google = new URL(start.headers.location as string);
    const nonce = google.searchParams.get('nonce')!;
    const state = google.searchParams.get('state')!;
    ctx.app.get(GoogleSignInService).http = async () =>
      new Response(JSON.stringify({ id_token: idToken(claims(nonce)) }), { status: 200 });
    const back = await browser.get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`);
    return { start, google, back, browser, state };
  };
  const good = (email: string) => (nonce: string) => ({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 600,
    nonce,
    email,
    email_verified: true,
    hd: 'relaydesk.local',
  });
  const errorOf = (res: request.Response) => new URL(res.headers.location as string).searchParams.get('signin_error');

  it('the sign-in page is told Google is on, for which domain, and that passwords are for administrators only', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/auth/options');
    expect(res.body).toEqual({ google: true, googleDomain: 'relaydesk.local', password: 'administrators' });
  });

  it('sends the browser to Google limited to the Workspace domain, with a nonce and a signed state', async () => {
    const { google, start } = await signIn(good('agent@relaydesk.local'));
    expect(google.origin).toBe('https://accounts.google.com');
    expect(google.searchParams.get('hd')).toBe('relaydesk.local');
    expect(google.searchParams.get('redirect_uri')).toBe('https://support.example.test/api/auth/google/callback');
    expect(google.searchParams.get('scope')).toBe('openid email profile');
    expect(String(start.headers['set-cookie'])).toMatch(/rd_google_signin=.*HttpOnly/);
  });

  it('an existing member of staff on the domain lands signed in, and it is audited as a Google sign-in', async () => {
    const { back, browser } = await signIn(good('Agent@RelayDesk.local'));
    expect(back.status).toBe(302);
    expect(back.headers.location).toBe('https://support.example.test/');
    const me = await browser.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('agent@relaydesk.local');
    const admin = await loginAsAdminWithTotp();
    const log = (await admin.get('/api/settings/audit-log?eventType=auth.login_succeeded')).body as {
      details: { method?: string };
    }[];
    expect(log.some((e) => e.details?.method === 'google')).toBe(true);
  });

  it('Google sign-in never creates an account: someone on the domain without one is turned away', async () => {
    const { back, browser } = await signIn(good('stranger@relaydesk.local'));
    expect(errorOf(back)).toBe('no_account');
    expect((await browser.get('/api/auth/me')).status).toBe(401);
  });

  it('a deactivated person cannot sign in with Google', async () => {
    const admin = await loginAsAdminWithTotp();
    const first = await signIn(good('agent@relaydesk.local'));
    const agentId = (await first.browser.get('/api/auth/me')).body.user.id as string;
    expect((await admin.patch(`/api/settings/users/${agentId}`, { isActive: false })).status).toBe(200);
    const { back } = await signIn(good('agent@relaydesk.local'));
    expect(errorOf(back)).toBe('no_account');
  });

  it('accounts from another domain, or a personal account using the same address text, are refused', async () => {
    const other = await signIn((n) => ({ ...good('agent@elsewhere.example')(n), hd: 'elsewhere.example' }));
    expect(errorOf(other.back)).toBe('wrong_domain');
    const personal = await signIn((n) => {
      const { hd: _hd, ...claims } = good('agent@relaydesk.local')(n);
      return claims;
    });
    expect(errorOf(personal.back)).toBe('wrong_domain');
    const unverified = await signIn((n) => ({ ...good('agent@relaydesk.local')(n), email_verified: false }));
    expect(errorOf(unverified.back)).toBe('email_not_verified');
  });

  it('a token for another app, an expired token or a replayed nonce is refused', async () => {
    const wrongAud = await signIn((n) => ({ ...good('agent@relaydesk.local')(n), aud: 'someone-else' }));
    expect(errorOf(wrongAud.back)).toBe('invalid_token');
    const expired = await signIn((n) => ({ ...good('agent@relaydesk.local')(n), exp: 1 }));
    expect(errorOf(expired.back)).toBe('invalid_token');
    const wrongNonce = await signIn((n) => ({ ...good('agent@relaydesk.local')(n), nonce: `${n}x` }));
    expect(errorOf(wrongNonce.back)).toBe('invalid_token');
  });

  it('a callback from a browser that did not start the sign-in is refused (login CSRF)', async () => {
    const { state } = await signIn(good('agent@relaydesk.local'));
    const other = request.agent(ctx.app.getHttpServer());
    const res = await other.get(`/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(errorOf(res)).toBe('invalid_state');
    expect((await other.get('/api/auth/me')).status).toBe(401);
    const forged = await request(ctx.app.getHttpServer()).get('/api/auth/google/callback?code=x&state=forged.sig');
    expect(errorOf(forged)).toBe('invalid_state');
  });

  it('with passwords limited to administrators, agents must use Google; administrators need two-factor', async () => {
    const agent = await new Client(ctx.app).login('agent@relaydesk.local');
    expect(agent.status).toBe(401);
    expect(agent.body.reason).toBe('use_google_signin');
    const adminNo2fa = await new Client(ctx.app).login('admin@relaydesk.local');
    expect(adminNo2fa.body.reason).toBe('use_google_signin');
    // A wrong password gets the usual answer, so the policy never reveals that an account exists.
    expect((await new Client(ctx.app).login('agent@relaydesk.local', 'wrong-password')).body.reason).toBe(
      'invalid_credentials',
    );
    await loginAsAdminWithTotp();
  });

  /** Signs the admin in with Google, turns on two-factor, then proves the emergency password works. */
  async function loginAsAdminWithTotp(): Promise<Client> {
    const { browser } = await signIn(good('admin@relaydesk.local'));
    const me = await browser.get('/api/auth/me');
    const csrf = me.body.csrfToken as string;
    const setup = await browser.post('/api/auth/totp/setup').set('x-csrf-token', csrf);
    const secret = setup.body.secret as string | undefined;
    if (secret) {
      await browser
        .post('/api/auth/totp/confirm')
        .set('x-csrf-token', csrf)
        .send({ code: generateTotp(secret) });
      (loginAsAdminWithTotp as { secret?: string }).secret = secret;
    }
    const known = (loginAsAdminWithTotp as { secret?: string }).secret!;
    const admin = new Client(ctx.app);
    const res = await admin.login('admin@relaydesk.local', PASSWORD, generateTotp(known));
    expect(res.status).toBe(200);
    return admin;
  }
});

describe('Google sign-in switched off (default)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it('the sign-in page offers passwords only, and the Google routes refuse politely', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/auth/options');
    expect(res.body).toEqual({ google: false, googleDomain: null, password: 'all' });
    const start = await request(ctx.app.getHttpServer()).get('/api/auth/google/start');
    expect(new URL(start.headers.location as string, 'http://x').searchParams.get('signin_error')).toBe('not_enabled');
    expect((await loginAs(ctx.app, 'agent@relaydesk.local')).userId).toBeTruthy();
  });
});
