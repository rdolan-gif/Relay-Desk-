import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTotp } from '../src/auth/totp';
import { createPool } from '../src/db/db';
import {
  Client,
  PASSWORD,
  TEST_DATABASE_URL,
  STRONG_PASSWORD,
  createTestContext,
  loginAs,
  type TestContext,
} from './helpers';

describe('authentication (spec 4, 18)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it('when credentials are correct, the system sets an httpOnly session cookie and returns a CSRF token', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@relaydesk.local', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toBeTruthy();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/rd_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('when the password is wrong, the system returns 401 and audits the failure', async () => {
    const c = new Client(ctx.app);
    const res = await c.login('admin@relaydesk.local', 'wrong-password-123');
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('invalid_credentials');

    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const log = await admin.get('/api/settings/audit-log?eventType=auth.login_failed');
    expect(log.body).toHaveLength(1);
    expect(log.body[0].actorLabel).toBe('admin@relaydesk.local');
  });

  it('when the email is unknown, the response is identical to a wrong password', async () => {
    const res = await new Client(ctx.app).login('nobody@relaydesk.local', 'whatever-password');
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('invalid_credentials');
  });

  it('when 5 logins fail within 15 minutes, further attempts are refused with 429 even with the right password', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await new Client(ctx.app).login('agent@relaydesk.local', 'bad-password-xyz')).status).toBe(401);
    }
    const res = await new Client(ctx.app).login('agent@relaydesk.local', PASSWORD);
    expect(res.status).toBe(429);
    expect(res.body.reason).toBe('rate_limited');
  });

  it('when a cookie-authenticated request changes state without the CSRF header, the system returns 403', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const res = await admin.agent.post('/api/settings/access-profiles').send({ name: 'No CSRF' });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('csrf');
  });

  it('when a user logs out, their session cookie no longer works', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    expect((await admin.post('/api/auth/logout')).status).toBe(204);
    expect((await admin.get('/api/auth/me')).status).toBe(401);
  });

  it('when TOTP is enabled, login requires a valid code', async () => {
    const agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    const setup = await agent.post('/api/auth/totp/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Relay%20Desk:agent%40relaydesk\.local\?/);
    const secret = setup.body.secret as string;

    expect((await agent.post('/api/auth/totp/confirm', { code: '000000' })).status).toBe(400);
    expect((await agent.post('/api/auth/totp/confirm', { code: generateTotp(secret) })).status).toBe(204);

    const noCode = await new Client(ctx.app).login('agent@relaydesk.local');
    expect(noCode.status).toBe(401);
    expect(noCode.body.reason).toBe('totp_required');

    const badCode = await new Client(ctx.app).login('agent@relaydesk.local', PASSWORD, '123456');
    expect(badCode.status).toBe(401);
    expect(badCode.body.reason).toBe('totp_invalid');

    const ok = await new Client(ctx.app).login('agent@relaydesk.local', PASSWORD, generateTotp(secret));
    expect(ok.status).toBe(200);

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.totpEnabled).toBe(true);

    expect(
      (await agent.post('/api/auth/totp/disable', { password: PASSWORD, code: generateTotp(secret) })).status,
    ).toBe(204);
    expect((await new Client(ctx.app).login('agent@relaydesk.local')).status).toBe(200);
  });

  it('TOTP secrets are stored encrypted, never in plain text', async () => {
    const agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    const { secret } = (await agent.post('/api/auth/totp/setup')).body;
    await agent.post('/api/auth/totp/confirm', { code: generateTotp(secret) });
    const pool = createPool(TEST_DATABASE_URL);
    const { rows } = await pool.query("select totp_secret_enc from users where email = 'agent@relaydesk.local'");
    await pool.end();
    expect(rows[0].totp_secret_enc).toMatch(/^v1\./);
    expect(rows[0].totp_secret_enc).not.toContain(secret);
  });

  it('when a weak new password is chosen, the system rejects it', async () => {
    const agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    const res = await agent.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'password1234' });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('weak_password');
  });

  it('when a user changes their password, their other sessions are logged out but the current one stays', async () => {
    const a = await loginAs(ctx.app, 'agent@relaydesk.local');
    const b = await loginAs(ctx.app, 'agent@relaydesk.local');
    const res = await a.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: STRONG_PASSWORD });
    expect(res.status).toBe(204);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect((await new Client(ctx.app).login('agent@relaydesk.local', STRONG_PASSWORD)).status).toBe(200);
  });

  it('per-user API token authenticates without CSRF and can be revoked', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const token = (await admin.post('/api/auth/api-token')).body.token as string;
    expect(token).toMatch(/^rdk_/);
    const server = ctx.app.getHttpServer();
    const created = await request(server)
      .post('/api/settings/access-profiles')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'Via token' });
    expect(created.status).toBe(201);

    expect((await admin.delete('/api/auth/api-token')).status).toBe(204);
    const after = await request(server).get('/api/auth/me').set('authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it('when a user is deactivated, the system logs them out and revokes their API token', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    const token = (await agent.post('/api/auth/api-token')).body.token as string;

    const res = await admin.patch(`/api/settings/users/${agent.userId}`, { isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);

    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const viaToken = await request(ctx.app.getHttpServer()).get('/api/auth/me').set('authorization', `Bearer ${token}`);
    expect(viaToken.status).toBe(401);
    expect((await new Client(ctx.app).login('agent@relaydesk.local')).status).toBe(401);

    const log = await admin.get('/api/settings/audit-log?eventType=user.deactivated');
    expect(log.body).toHaveLength(1);
  });

  it('when an external user tries to log in to the internal app, the system refuses', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const created = await admin.post('/api/settings/users', {
      email: 'customer@example.com',
      name: 'Customer',
      type: 'external',
      password: STRONG_PASSWORD,
    });
    expect(created.status).toBe(201);
    const res = await new Client(ctx.app).login('customer@example.com', STRONG_PASSWORD);
    expect(res.status).toBe(401);
  });

  it('health endpoints are public', async () => {
    const server = ctx.app.getHttpServer();
    expect((await request(server).get('/api/health/live')).status).toBe(200);
    expect((await request(server).get('/api/health/ready')).body).toEqual({ status: 'ok', database: 'ok' });
  });
});
