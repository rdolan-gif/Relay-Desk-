import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STRONG_PASSWORD, createTestContext, loginAs, type TestContext } from './helpers';

/**
 * Phase 0 done-when (spec 20): "an admin can create a user with a restricted rights
 * profile, and that user's API calls to a forbidden module return 403."
 */
describe('Phase 0 acceptance', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("when an admin creates a user with restricted profiles, that user's calls to a forbidden module return 403", async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');

    // A team-leader style profile: may read the Users settings page and nothing else.
    const access = await admin.post('/api/settings/access-profiles', {
      name: 'Team leader (users read-only)',
      modules: { settings_users: { enabled: true, read: true } },
    });
    expect(access.status).toBe(201);

    const users = await admin.get('/api/settings/users');
    const agentId = users.body.find((u: { email: string }) => u.email === 'agent@relaydesk.local').id;

    const rights = await admin.post('/api/settings/rights-profiles', {
      name: 'Restricted',
      userVisibility: 'selected',
      visibleUserIds: [agentId],
    });
    expect(rights.status).toBe(201);

    const created = await admin.post('/api/settings/users', {
      email: 'Lead@RelayDesk.local',
      name: 'Lee Lead',
      type: 'administrator',
      password: STRONG_PASSWORD,
      accessProfileId: access.body.id,
      rightsProfileId: rights.body.id,
    });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('lead@relaydesk.local');

    const lead = await loginAs(ctx.app, 'lead@relaydesk.local', STRONG_PASSWORD);

    // Allowed module: sees only themselves and the one visible user.
    const visible = await lead.get('/api/settings/users');
    expect(visible.status).toBe(200);
    expect(visible.body.map((u: { email: string }) => u.email).sort()).toEqual([
      'agent@relaydesk.local',
      'lead@relaydesk.local',
    ]);

    // Forbidden modules.
    for (const url of ['/api/settings/audit-log', '/api/settings/access-profiles', '/api/settings/rights-profiles']) {
      const res = await lead.get(url);
      expect(res.status, url).toBe(403);
      expect(res.body.reason).toBe('module_disabled');
    }
    // Allowed module, forbidden verb.
    const create = await lead.post('/api/settings/users', {
      email: 'x@relaydesk.local',
      name: 'X',
      type: 'agent',
      password: STRONG_PASSWORD,
    });
    expect(create.status).toBe(403);
    expect(create.body.reason).toBe('verb_not_granted');

    // The same rules apply to the API token path.
    const token = (await lead.post('/api/auth/api-token')).body.token as string;
    const viaToken = await request(ctx.app.getHttpServer())
      .get('/api/settings/audit-log')
      .set('authorization', `Bearer ${token}`);
    expect(viaToken.status).toBe(403);
    const allowedViaToken = await request(ctx.app.getHttpServer())
      .get('/api/settings/users')
      .set('authorization', `Bearer ${token}`);
    expect(allowedViaToken.status).toBe(200);
  });

  it('when an agent-type user calls a Settings module, the system returns 403 regardless of profile', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const created = await admin.post('/api/settings/users', {
      email: 'agent2@relaydesk.local',
      name: 'Agent Two',
      type: 'agent',
      password: STRONG_PASSWORD,
      accessProfileId: ctx.ids.accessProfiles.Administrator,
      rightsProfileId: ctx.ids.rightsProfiles['Standard agent'],
    });
    expect(created.status).toBe(201);
    const agent = await loginAs(ctx.app, 'agent2@relaydesk.local', STRONG_PASSWORD);
    const res = await agent.get('/api/settings/users');
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('settings_requires_administrator');
  });

  it('when an unauthenticated client calls a protected module, the system returns 401', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/settings/users');
    expect(res.status).toBe(401);
  });

  it("when an admin changes a user's access profile, it takes effect on the user's next request", async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const limited = await admin.post('/api/settings/access-profiles', {
      name: 'Users only',
      modules: { settings_users: { enabled: true, read: true } },
    });
    const created = await admin.post('/api/settings/users', {
      email: 'second-admin@relaydesk.local',
      name: 'Second Admin',
      type: 'administrator',
      password: STRONG_PASSWORD,
      accessProfileId: ctx.ids.accessProfiles.Administrator,
      rightsProfileId: ctx.ids.rightsProfiles.Administrator,
    });
    const second = await loginAs(ctx.app, 'second-admin@relaydesk.local', STRONG_PASSWORD);
    expect((await second.get('/api/settings/audit-log')).status).toBe(200);

    const patched = await admin.patch(`/api/settings/users/${created.body.id}`, { accessProfileId: limited.body.id });
    expect(patched.status).toBe(200);
    expect((await second.get('/api/settings/audit-log')).status).toBe(403);
    expect((await second.get('/api/settings/users')).status).toBe(200);
  });
});
