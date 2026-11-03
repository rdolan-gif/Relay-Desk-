import { describe, expect, it } from 'vitest';
import {
  canSeeCrmDatabase,
  canSeeRecordType,
  crmDatabaseScope,
  canCreateProfiles,
  canManageAccessProfile,
  canManageRightsProfile,
  canSeeUser,
  filterVisibleUsers,
  type RightsProfile,
} from './rights-profile.js';

const restricted: RightsProfile = {
  userVisibility: 'selected',
  visibleUserIds: ['b'],
  editableAccessProfiles: ['ap-agent'],
  editableRightsProfiles: ['rp-agent'],
  crmDatabases: ['db-1'],
  crmRecordTypes: [],
};
const full: RightsProfile = {
  userVisibility: 'all',
  visibleUserIds: [],
  editableAccessProfiles: 'all',
  editableRightsProfiles: 'all',
  crmDatabases: 'all',
  crmRecordTypes: 'all',
};

describe('rights: user visibility (spec 4)', () => {
  it('a user can always see themselves', () => {
    expect(canSeeUser(restricted, 'a', 'a')).toBe(true);
  });
  it('when visibility is selected, only listed users are visible', () => {
    expect(canSeeUser(restricted, 'a', 'b')).toBe(true);
    expect(canSeeUser(restricted, 'a', 'c')).toBe(false);
  });
  it('when visibility is all, every user is visible', () => {
    expect(canSeeUser(full, 'a', 'z')).toBe(true);
  });
  it('filterVisibleUsers returns only visible rows', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(filterVisibleUsers(restricted, 'a', rows).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('rights: profile editing prevents privilege escalation (spec 4)', () => {
  it('when an admin assigns an access profile outside their editable list, the system refuses', () => {
    expect(canManageAccessProfile(restricted, 'ap-admin')).toBe(false);
    expect(canManageAccessProfile(restricted, 'ap-agent')).toBe(true);
  });
  it('when an admin assigns a rights profile outside their editable list, the system refuses', () => {
    expect(canManageRightsProfile(restricted, 'rp-admin')).toBe(false);
    expect(canManageRightsProfile(restricted, 'rp-agent')).toBe(true);
  });
  it('an admin with "all" editable profiles can manage any profile', () => {
    expect(canManageAccessProfile(full, 'anything')).toBe(true);
    expect(canManageRightsProfile(full, 'anything')).toBe(true);
  });
  it('only admins with "all" editable profiles can create new profiles', () => {
    expect(canCreateProfiles(restricted, 'access')).toBe(false);
    expect(canCreateProfiles(full, 'rights')).toBe(true);
  });
});

describe('rights: CRM databases and record types (spec 4, 12)', () => {
  it('when a CRM database is not in the rights, the user cannot see it', () => {
    expect(canSeeCrmDatabase(restricted, 'db-1')).toBe(true);
    expect(canSeeCrmDatabase(restricted, 'db-2')).toBe(false);
    expect(crmDatabaseScope(restricted)).toEqual({ all: false, ids: ['db-1'] });
  });
  it('when rights grant all CRM databases, every database is visible', () => {
    expect(canSeeCrmDatabase(full, 'anything')).toBe(true);
    expect(crmDatabaseScope(full)).toEqual({ all: true });
  });
  it('when a record type is not in the rights, its records are not visible', () => {
    expect(canSeeRecordType(restricted, 'deal')).toBe(false);
    expect(canSeeRecordType(full, 'deal')).toBe(true);
  });
});
