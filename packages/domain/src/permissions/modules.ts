/**
 * Modules a user can be granted in an access profile (spec 4, "Access profile").
 * Settings pages are modules in their own right; only Administrators may open them.
 */
export const WORK_MODULES = [
  'tickets',
  'crm_contacts',
  'crm_accounts',
  'crm_records',
  'knowledge_base',
  'reporting',
] as const;

/**
 * One entry per Settings page. Pages for later phases are listed now so access
 * profiles can be configured ahead of time; their endpoints arrive with the phase.
 */
export const SETTINGS_MODULES = [
  'settings_users',
  'settings_access_profiles',
  'settings_rights_profiles',
  'settings_audit_log',
  'settings_categories',
  'settings_statuses',
  'settings_custom_fields',
  'settings_sla',
  'settings_time_groups',
  'settings_mailbox_queues',
  'settings_email_routing',
  'settings_templates',
  'settings_macros',
  'settings_crm_databases',
  'settings_crm_record_types',
  'settings_ticket_views',
  'settings_external_users',
] as const;

export const MODULES = [...WORK_MODULES, ...SETTINGS_MODULES] as const;

export type WorkModule = (typeof WORK_MODULES)[number];
export type SettingsModule = (typeof SETTINGS_MODULES)[number];
export type ModuleKey = (typeof MODULES)[number];

export const VERBS = ['create', 'read', 'update', 'delete'] as const;
export type Verb = (typeof VERBS)[number];

/** Extra access flags (spec 4, "Access profile"). */
export const ACCESS_FLAGS = [
  'can_create_own_ticket_views',
  'can_bulk_edit',
  'can_merge_tickets',
  'can_delete_tickets',
  'can_anonymise',
  'can_export',
  'can_move_activities',
  'can_import_crm_data',
] as const;
export type AccessFlag = (typeof ACCESS_FLAGS)[number];

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULES as readonly string[]).includes(value);
}

export function isSettingsModule(module: ModuleKey): module is SettingsModule {
  return (SETTINGS_MODULES as readonly string[]).includes(module);
}
