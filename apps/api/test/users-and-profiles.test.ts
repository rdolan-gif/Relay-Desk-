import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STRONG_PASSWORD, createTestContext, loginAs, type TestContext } from './helpers';

describe('users, access and rights profiles (spec 4)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  async function adminAndAgentId() {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const list = await admin.get('/api/settings/users');
    const agentId = list.body.find((u: { email: string }) => u.email === 'agent@relaydesk.local').id as string;
    return { admin, agentId };
  }

  it("when an admin changes a user's type while that user is logged in, the system returns 409", async () => {
    const { admin, agentId } = await adminAndAgentId();
    const agent = await loginAs(ctx.app, 'agent@relaydesk.local');
    const res = await admin.patch(`/api/settings/users/${agentId}`, { type: 'back_office' });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('type_change_while_logged_in');

    await agent.post('/api/auth/logout');
    const ok = await admin.patch(`/api/settings/users/${agentId}`, { type: 'back_office' });
    expect(ok.status).toBe(200);
    expect(ok.body.type).toBe('back_office');
  });

  it('when an admin tries to deactivate themselves, the system returns 409', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const res = await admin.patch(`/api/settings/users/${admin.userId}`, { isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('self_lockout');
  });

  it('when an internal user is created without profiles, the system returns 400', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const res = await admin.post('/api/settings/users', {
      email: 'new@relaydesk.local',
      name: 'New',
      type: 'agent',
      password: STRONG_PASSWORD,
    });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('profiles_required');
  });

  it('when an email is already in use (case-insensitively), the system returns 409', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const res = await admin.post('/api/settings/users', {
      email: 'AGENT@relaydesk.local',
      name: 'Dup',
      type: 'agent',
      password: STRONG_PASSWORD,
      accessProfileId: ctx.ids.accessProfiles.Agent,
      rightsProfileId: ctx.ids.rightsProfiles['Standard agent'],
    });
    expect(res.status).toBe(409);
  });

  it('when a user is created, the audit log records it with field changes and no password', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const created = await admin.post('/api/settings/users', {
      email: 'audited@relaydesk.local',
      name: 'Audited',
      type: 'agent',
      password: STRONG_PASSWORD,
      accessProfileId: ctx.ids.accessProfiles.Agent,
      rightsProfileId: ctx.ids.rightsProfiles['Standard agent'],
    });
    const log = await admin.get('/api/settings/audit-log?eventType=user.created');
    expect(log.body).toHaveLength(1);
    expect(log.body[0]).toMatchObject({ actorUserId: admin.userId, targetType: 'user', targetId: created.body.id });
    const fields = log.body[0].details.changes.map((c: { field: string }) => c.field);
    expect(fields).toContain('email');
    expect(JSON.stringify(log.body[0])).not.toContain(STRONG_PASSWORD);
  });

  it('when a profile is updated, the audit log stores the diff', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const ap = await admin.post('/api/settings/access-profiles', { name: 'Diffed' });
    await admin.put(`/api/settings/access-profiles/${ap.body.id}`, {
      name: 'Diffed',
      modules: { reporting: { enabled: true, read: true } },
    });
    const log = await admin.get('/api/settings/audit-log?eventType=access_profile.updated');
    expect(log.body[0].details.changes).toEqual([
      {
        field: 'modules',
        old: {},
        new: { reporting: { enabled: true, create: false, read: true, update: false, delete: false } },
      },
    ]);
  });

  describe('privilege escalation guard', () => {
    /** A delegated admin who may only manage the Agent access profile and Standard agent rights. */
    async function delegatedAdmin() {
      const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
      const ap = await admin.post('/api/settings/access-profiles', {
        name: 'Delegated admin',
        modules: {
          settings_users: { enabled: true, create: true, read: true, update: true },
          settings_access_profiles: { enabled: true, create: true, read: true, update: true },
          settings_rights_profiles: { enabled: true, create: true, read: true, update: true },
          tickets: { enabled: true, read: true },
        },
      });
      const rp = await admin.post('/api/settings/rights-profiles', {
        name: 'Delegated admin rights',
        editableAccessProfiles: [ctx.ids.accessProfiles.Agent],
        editableRightsProfiles: [ctx.ids.rightsProfiles['Standard agent']],
      });
      const created = await admin.post('/api/settings/users', {
        email: 'delegate@relaydesk.local',
        name: 'Del Egate',
        type: 'administrator',
        password: STRONG_PASSWORD,
        accessProfileId: ap.body.id,
        rightsProfileId: rp.body.id,
      });
      expect(created.status).toBe(201);
      return {
        admin,
        delegate: await loginAs(ctx.app, 'delegate@relaydesk.local', STRONG_PASSWORD),
        apId: ap.body.id as string,
      };
    }

    it('when a delegated admin assigns an access profile outside their list, the system returns 403', async () => {
      const { delegate } = await delegatedAdmin();
      const res = await delegate.post('/api/settings/users', {
        email: 'sneaky@relaydesk.local',
        name: 'Sneaky',
        type: 'administrator',
        password: STRONG_PASSWORD,
        accessProfileId: ctx.ids.accessProfiles.Administrator,
        rightsProfileId: ctx.ids.rightsProfiles['Standard agent'],
      });
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('profile_not_editable');
    });

    it('when a delegated admin assigns profiles inside their list, the system allows it', async () => {
      const { delegate } = await delegatedAdmin();
      const res = await delegate.post('/api/settings/users', {
        email: 'fine@relaydesk.local',
        name: 'Fine',
        type: 'agent',
        password: STRONG_PASSWORD,
        accessProfileId: ctx.ids.accessProfiles.Agent,
        rightsProfileId: ctx.ids.rightsProfiles['Standard agent'],
      });
      expect(res.status).toBe(201);
    });

    it('a delegated admin only sees profiles they may edit, and cannot create new ones', async () => {
      const { delegate } = await delegatedAdmin();
      const list = await delegate.get('/api/settings/access-profiles');
      expect(list.body.map((p: { name: string }) => p.name)).toEqual(['Agent']);
      expect((await delegate.get(`/api/settings/access-profiles/${ctx.ids.accessProfiles.Administrator}`)).status).toBe(
        404,
      );
      const res = await delegate.post('/api/settings/access-profiles', { name: 'Mine' });
      expect(res.status).toBe(403);
    });

    it('when a delegated admin edits a profile to grant access they do not hold, the system returns 403', async () => {
      const { delegate } = await delegatedAdmin();
      const res = await delegate.put(`/api/settings/access-profiles/${ctx.ids.accessProfiles.Agent}`, {
        name: 'Agent',
        modules: { settings_audit_log: { enabled: true, read: true }, tickets: { enabled: true, read: true } },
      });
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('privilege_escalation');
      expect(res.body.excess).toEqual(['settings_audit_log']);
    });

    it('when a delegated admin edits their own rights to edit all profiles, the system refuses', async () => {
      const { delegate, admin } = await delegatedAdmin();
      // They cannot even see their own rights profile, since it is not in their editable list.
      const me = await delegate.get('/api/auth/me');
      expect(me.body.rights.editableRightsProfiles).toEqual([ctx.ids.rightsProfiles['Standard agent']]);
      const res = await delegate.put(`/api/settings/rights-profiles/${ctx.ids.rightsProfiles['Standard agent']}`, {
        name: 'Standard agent',
        editableAccessProfiles: 'all',
      });
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('privilege_escalation');
      void admin;
    });

    it('a delegated admin cannot edit a user who holds a profile outside their list', async () => {
      const { delegate } = await delegatedAdmin();
      const list = await delegate.get('/api/settings/users');
      const adminRow = list.body.find((u: { email: string }) => u.email === 'admin@relaydesk.local');
      const res = await delegate.patch(`/api/settings/users/${adminRow.id}`, { name: 'Renamed' });
      expect(res.status).toBe(403);
    });
  });

  it('when a profile is assigned to users, deleting it returns 409', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const res = await admin.delete(`/api/settings/access-profiles/${ctx.ids.accessProfiles.Agent}`);
    expect(res.status).toBe(409);
    const unused = await admin.post('/api/settings/access-profiles', { name: 'Unused' });
    expect((await admin.delete(`/api/settings/access-profiles/${unused.body.id}`)).status).toBe(204);
    expect((await admin.get(`/api/settings/access-profiles/${unused.body.id}`)).status).toBe(404);
  });

  it('when a request body is invalid, the system returns 400 with issues', async () => {
    const admin = await loginAs(ctx.app, 'admin@relaydesk.local');
    const res = await admin.post('/api/settings/users', { email: 'not-an-email', name: '', type: 'wizard' });
    expect(res.status).toBe(400);
    expect(res.body.issues.length).toBeGreaterThanOrEqual(3);
  });
});
