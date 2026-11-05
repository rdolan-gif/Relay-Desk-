import { describe, expect, it } from 'vitest';
import {
  checkAccessFlag,
  checkModuleAccess,
  fullAccessProfile,
  normaliseAccessProfile,
  type Principal,
} from './access-profile.js';
import { MODULES, VERBS } from './modules.js';

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'u1',
    type: 'agent',
    isActive: true,
    access: normaliseAccessProfile({
      modules: { tickets: { enabled: true, read: true, update: true } },
    }),
    ...overrides,
  };
}

describe('access checks (spec 4)', () => {
  it('when the module is enabled and the verb granted, the system allows the call', () => {
    expect(checkModuleAccess(principal(), 'tickets', 'read')).toEqual({ allowed: true });
  });

  it('when the module is enabled but the verb is not granted, the system refuses with verb_not_granted', () => {
    expect(checkModuleAccess(principal(), 'tickets', 'delete')).toEqual({
      allowed: false,
      reason: 'verb_not_granted',
    });
  });

  it('when the module is not in the access profile, the system refuses with module_disabled', () => {
    expect(checkModuleAccess(principal(), 'crm_contacts', 'read')).toEqual({
      allowed: false,
      reason: 'module_disabled',
    });
  });

  it('when a module is present but disabled, its verbs are ignored', () => {
    const p = principal({
      access: normaliseAccessProfile({
        modules: { tickets: { enabled: false, read: true, create: true } },
      }),
    });
    expect(checkModuleAccess(p, 'tickets', 'read')).toMatchObject({ reason: 'module_disabled' });
    expect(p.access.modules.tickets?.read).toBe(false);
  });

  it('when a non-administrator calls a Settings module, the system refuses even if the profile grants it', () => {
    const p = principal({ type: 'agent', access: fullAccessProfile() });
    expect(checkModuleAccess(p, 'settings_users', 'read')).toEqual({
      allowed: false,
      reason: 'settings_requires_administrator',
    });
  });

  it('when an administrator has the Settings module granted, the system allows it', () => {
    const p = principal({ type: 'administrator', access: fullAccessProfile() });
    expect(checkModuleAccess(p, 'settings_users', 'create')).toEqual({ allowed: true });
  });

  it('when an administrator lacks a Settings module in their access profile, the system refuses', () => {
    const p = principal({
      type: 'administrator',
      access: normaliseAccessProfile({ modules: { settings_users: { enabled: true, read: true } } }),
    });
    expect(checkModuleAccess(p, 'settings_audit_log', 'read')).toMatchObject({
      reason: 'module_disabled',
    });
    expect(checkModuleAccess(p, 'settings_users', 'create')).toMatchObject({
      reason: 'verb_not_granted',
    });
  });

  it('when an external user calls any internal module, the system refuses', () => {
    const p = principal({ type: 'external', access: fullAccessProfile() });
    for (const m of MODULES) {
      expect(checkModuleAccess(p, m, 'read')).toEqual({ allowed: false, reason: 'external_user' });
    }
  });

  it('when a user is deactivated, every call is refused', () => {
    const p = principal({ isActive: false, type: 'administrator', access: fullAccessProfile() });
    expect(checkModuleAccess(p, 'tickets', 'read')).toEqual({
      allowed: false,
      reason: 'inactive_user',
    });
  });

  it('back-office users can work modules their profile grants', () => {
    const p = principal({ type: 'back_office' });
    expect(checkModuleAccess(p, 'tickets', 'update')).toEqual({ allowed: true });
  });

  it('full access profile grants every module and verb to an administrator', () => {
    const p = principal({ type: 'administrator', access: fullAccessProfile() });
    for (const m of MODULES) for (const v of VERBS) expect(checkModuleAccess(p, m, v).allowed).toBe(true);
  });
});

describe('access flags (spec 4)', () => {
  it('when the flag is set and the related module readable, the system allows it', () => {
    const p = principal({
      access: normaliseAccessProfile({
        modules: { tickets: { enabled: true, read: true } },
        flags: { can_bulk_edit: true },
      }),
    });
    expect(checkAccessFlag(p, 'can_bulk_edit')).toEqual({ allowed: true });
  });

  it('when the flag is not set, the system refuses with flag_not_granted', () => {
    expect(checkAccessFlag(principal(), 'can_merge_tickets')).toEqual({
      allowed: false,
      reason: 'flag_not_granted',
    });
  });

  it('when the flag is set but the related module is disabled, the system refuses', () => {
    const p = principal({
      access: normaliseAccessProfile({ flags: { can_import_crm_data: true } }),
    });
    expect(checkAccessFlag(p, 'can_import_crm_data')).toMatchObject({ reason: 'module_disabled' });
  });
});

describe('normaliseAccessProfile', () => {
  it('drops unknown modules and flags', () => {
    const p = normaliseAccessProfile({
      modules: { nonsense: { enabled: true, read: true } },
      flags: { can_fly: true },
    });
    expect(p).toEqual({ modules: {}, flags: {} });
  });
});

describe('access profile escalation guard (spec 4)', () => {
  it('when an admin grants a module verb they do not hold, the system reports it as excess', async () => {
    const { grantsBeyondActor } = await import('./access-profile.js');
    const actor = normaliseAccessProfile({
      modules: { tickets: { enabled: true, read: true }, settings_users: { enabled: true, read: true, create: true } },
    });
    const proposed = normaliseAccessProfile({
      modules: { tickets: { enabled: true, read: true, delete: true }, reporting: { enabled: true, read: true } },
      flags: { can_export: true },
    });
    expect(grantsBeyondActor(actor, proposed)).toEqual(['tickets.delete', 'reporting', 'can_export']);
  });
  it('when the proposal is within the admin’s own access, nothing is excess', async () => {
    const { grantsBeyondActor } = await import('./access-profile.js');
    expect(grantsBeyondActor(fullAccessProfile(), fullAccessProfile())).toEqual([]);
  });
});
