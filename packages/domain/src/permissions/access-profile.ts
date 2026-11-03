import {
  ACCESS_FLAGS,
  MODULES,
  VERBS,
  isSettingsModule,
  type AccessFlag,
  type ModuleKey,
  type Verb,
} from './modules.js';
import { userTypeCanUseInternalApp, userTypeCanUseSettings, type UserType } from '../users/user-type.js';

export interface ModuleAccess {
  enabled: boolean;
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
}

export type ModuleAccessMap = Partial<Record<ModuleKey, ModuleAccess>>;
export type AccessFlagMap = Partial<Record<AccessFlag, boolean>>;

export interface AccessProfile {
  modules: ModuleAccessMap;
  flags: AccessFlagMap;
}

/** The subject of a permission check: who is asking. */
export interface Principal {
  userId: string;
  type: UserType;
  isActive: boolean;
  access: AccessProfile;
}

export type AccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | 'inactive_user'
        | 'external_user'
        | 'settings_requires_administrator'
        | 'module_disabled'
        | 'verb_not_granted'
        | 'flag_not_granted';
    };

const ALLOW: AccessDecision = { allowed: true };

/**
 * When a user calls any module, the system allows it only if the user is active,
 * their type may use that area, the module is enabled in their access profile and
 * the verb is granted (spec 4, "Rules").
 */
export function checkModuleAccess(principal: Principal, module: ModuleKey, verb: Verb): AccessDecision {
  if (!principal.isActive) return { allowed: false, reason: 'inactive_user' };
  if (!userTypeCanUseInternalApp(principal.type)) {
    return { allowed: false, reason: 'external_user' };
  }
  if (isSettingsModule(module) && !userTypeCanUseSettings(principal.type)) {
    return { allowed: false, reason: 'settings_requires_administrator' };
  }
  const grant = principal.access.modules[module];
  if (!grant?.enabled) return { allowed: false, reason: 'module_disabled' };
  if (!grant[verb]) return { allowed: false, reason: 'verb_not_granted' };
  return ALLOW;
}

/** Access flags additionally require Read on the module they relate to. */
const FLAG_MODULE: Record<AccessFlag, ModuleKey> = {
  can_create_own_ticket_views: 'tickets',
  can_bulk_edit: 'tickets',
  can_merge_tickets: 'tickets',
  can_delete_tickets: 'tickets',
  can_anonymise: 'tickets',
  can_export: 'tickets',
  can_move_activities: 'tickets',
  can_import_crm_data: 'crm_contacts',
};

export function checkAccessFlag(principal: Principal, flag: AccessFlag): AccessDecision {
  const base = checkModuleAccess(principal, FLAG_MODULE[flag], 'read');
  if (!base.allowed) return base;
  return principal.access.flags[flag] ? ALLOW : { allowed: false, reason: 'flag_not_granted' };
}

/** Normalises arbitrary input into a complete, closed access profile (unknown keys dropped). */
export function normaliseAccessProfile(input: {
  modules?: Record<string, Partial<ModuleAccess> | undefined>;
  flags?: Record<string, boolean | undefined>;
}): AccessProfile {
  const modules: ModuleAccessMap = {};
  for (const key of MODULES) {
    const raw = input.modules?.[key];
    if (!raw) continue;
    const enabled = raw.enabled === true;
    const entry: ModuleAccess = { enabled, create: false, read: false, update: false, delete: false };
    for (const verb of VERBS) entry[verb] = enabled && raw[verb] === true;
    modules[key] = entry;
  }
  const flags: AccessFlagMap = {};
  for (const flag of ACCESS_FLAGS) {
    if (input.flags?.[flag] === true) flags[flag] = true;
  }
  return { modules, flags };
}

/** A profile granting every module, verb and flag. Used by the seed for the first administrator. */
export function fullAccessProfile(): AccessProfile {
  const modules: ModuleAccessMap = {};
  for (const key of MODULES) {
    modules[key] = { enabled: true, create: true, read: true, update: true, delete: true };
  }
  const flags: AccessFlagMap = {};
  for (const flag of ACCESS_FLAGS) flags[flag] = true;
  return { modules, flags };
}

/**
 * When an admin edits an access profile, the system refuses to grant any module verb
 * or flag the admin does not hold themselves, so a limited admin cannot mint a more
 * powerful profile (spec 4, "prevents privilege escalation"). Returns the excess grants.
 */
export function grantsBeyondActor(actor: AccessProfile, proposed: AccessProfile): string[] {
  const excess: string[] = [];
  for (const key of MODULES) {
    const want = proposed.modules[key];
    if (!want?.enabled) continue;
    const have = actor.modules[key];
    if (!have?.enabled) {
      excess.push(key);
      continue;
    }
    for (const verb of VERBS) if (want[verb] && !have[verb]) excess.push(`${key}.${verb}`);
  }
  for (const flag of ACCESS_FLAGS) {
    if (proposed.flags[flag] && !actor.flags[flag]) excess.push(flag);
  }
  return excess;
}
