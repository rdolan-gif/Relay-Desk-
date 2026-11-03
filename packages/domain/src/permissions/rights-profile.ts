/**
 * Rights profile: which data a user may see inside the modules their access allows
 * (spec 4, "Rights profile"). Phase 0 covers user visibility and profile editing;
 * categories, views, queues, CRM databases, record types, macros and KB folders are
 * added by the phases that introduce those entities.
 */
export interface RightsProfile {
  /** 'all' = every user; 'selected' = only the listed users (plus yourself). */
  userVisibility: 'all' | 'selected';
  visibleUserIds: readonly string[];
  /** Which access profiles the holder may edit or assign to users. */
  editableAccessProfiles: 'all' | readonly string[];
  /** Which rights profiles the holder may edit or assign to users. */
  editableRightsProfiles: 'all' | readonly string[];
}

export function canSeeUser(rights: RightsProfile, selfId: string, otherId: string): boolean {
  if (selfId === otherId) return true;
  if (rights.userVisibility === 'all') return true;
  return rights.visibleUserIds.includes(otherId);
}

/** Filters a list of users down to those visible under the rights profile. */
export function filterVisibleUsers<T extends { id: string }>(
  rights: RightsProfile,
  selfId: string,
  users: readonly T[],
): T[] {
  return users.filter((u) => canSeeUser(rights, selfId, u.id));
}

/**
 * When an admin edits or assigns an access profile, the system allows it only if
 * that profile is in the admin's editable list (prevents privilege escalation).
 */
export function canManageAccessProfile(rights: RightsProfile, accessProfileId: string): boolean {
  return rights.editableAccessProfiles === 'all' || rights.editableAccessProfiles.includes(accessProfileId);
}

export function canManageRightsProfile(rights: RightsProfile, rightsProfileId: string): boolean {
  return rights.editableRightsProfiles === 'all' || rights.editableRightsProfiles.includes(rightsProfileId);
}

/**
 * When a user without "all" editable profiles creates a profile, they could otherwise
 * never see it again. They can only create profiles if they hold 'all'.
 */
export function canCreateProfiles(rights: RightsProfile, kind: 'access' | 'rights'): boolean {
  return kind === 'access' ? rights.editableAccessProfiles === 'all' : rights.editableRightsProfiles === 'all';
}
