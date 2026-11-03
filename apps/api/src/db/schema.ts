import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  inet,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigserial,
  integer,
  serial,
} from 'drizzle-orm/pg-core';
import type { FieldChange } from '@relay-desk/domain';
import type {
  AccessFlagMap,
  FieldOption,
  FieldType,
  FilterCondition,
  FormLayout,
  ModuleAccessMap,
  RecordStatusDef,
  RecordStage,
  Priority,
  StatusRequired,
  TicketState,
  UserType,
} from '@relay-desk/domain';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const accessProfiles = pgTable(
  'access_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    modules: jsonb('modules').$type<ModuleAccessMap>().notNull().default({}),
    flags: jsonb('flags').$type<AccessFlagMap>().notNull().default({}),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('access_profiles_name_uq')
      .on(t.name)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const rightsProfiles = pgTable(
  'rights_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    userVisibility: text('user_visibility').$type<'all' | 'selected'>().notNull().default('all'),
    editAllAccessProfiles: boolean('edit_all_access_profiles').notNull().default(false),
    editAllRightsProfiles: boolean('edit_all_rights_profiles').notNull().default(false),
    allCrmDatabases: boolean('all_crm_databases').notNull().default(false),
    allCrmRecordTypes: boolean('all_crm_record_types').notNull().default(false),
    allCategories: boolean('all_categories').notNull().default(false),
    allTicketViews: boolean('all_ticket_views').notNull().default(false),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('rights_profiles_name_uq')
      .on(t.name)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<UserType>().notNull(),
    passwordHash: text('password_hash'),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    totpSecretEnc: text('totp_secret_enc'),
    totpPendingSecretEnc: text('totp_pending_secret_enc'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    accessProfileId: uuid('access_profile_id').references(() => accessProfiles.id),
    rightsProfileId: uuid('rights_profile_id').references(() => rightsProfiles.id),
    isActive: boolean('is_active').notNull().default(true),
    apiTokenHash: text('api_token_hash'),
    apiTokenCreatedAt: timestamp('api_token_created_at', { withTimezone: true }),
    timezone: text('timezone').notNull().default('Europe/London'),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_uq')
      .on(t.email)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex('users_api_token_hash_uq').on(t.apiTokenHash),
  ],
);

export const rightsProfileVisibleUsers = pgTable(
  'rights_profile_visible_users',
  {
    rightsProfileId: uuid('rights_profile_id')
      .notNull()
      .references(() => rightsProfiles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rightsProfileId, t.userId] })],
);

export const rightsProfileEditableAccessProfiles = pgTable(
  'rights_profile_editable_access_profiles',
  {
    rightsProfileId: uuid('rights_profile_id')
      .notNull()
      .references(() => rightsProfiles.id, { onDelete: 'cascade' }),
    accessProfileId: uuid('access_profile_id')
      .notNull()
      .references(() => accessProfiles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rightsProfileId, t.accessProfileId] })],
);

export const rightsProfileEditableRightsProfiles = pgTable(
  'rights_profile_editable_rights_profiles',
  {
    rightsProfileId: uuid('rights_profile_id')
      .notNull()
      .references(() => rightsProfiles.id, { onDelete: 'cascade' }),
    editableRightsProfileId: uuid('editable_rights_profile_id')
      .notNull()
      .references(() => rightsProfiles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rightsProfileId, t.editableRightsProfileId] })],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 of the cookie token; the raw token is never stored. */
    tokenHash: text('token_hash').notNull(),
    csrfToken: text('csrf_token').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('sessions_token_hash_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    email: text('email').notNull(),
    ip: inet('ip'),
    succeeded: boolean('succeeded').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_attempts_email_idx').on(t.email, t.createdAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventType: text('event_type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Free-text actor label kept even if the user is later removed (e.g. attempted email). */
    actorLabel: text('actor_label'),
    ip: inet('ip'),
    targetType: text('target_type'),
    targetId: text('target_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt), index('audit_log_event_idx').on(t.eventType, t.createdAt)],
);

// ---------------------------------------------------------------- CRM (Phase 1)

/** Shared custom field pool for ticket, contact, account and record forms (spec 7.3). */
export const customFields = pgTable(
  'custom_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<FieldType>().notNull(),
    options: jsonb('options').$type<FieldOption[]>().notNull().default([]),
    defaultValue: jsonb('default_value').$type<unknown>(),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('custom_fields_key_uq').on(t.key)],
);

export const crmDatabases = pgTable(
  'crm_databases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    contactFormLayout: jsonb('contact_form_layout').$type<FormLayout>().notNull().default({ sections: [] }),
    accountFormLayout: jsonb('account_form_layout').$type<FormLayout>().notNull().default({ sections: [] }),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('crm_databases_default_uq')
      .on(t.isDefault)
      .where(sql`is_default AND deleted_at IS NULL`),
  ],
);

export const crmRecordTypes = pgTable('crm_record_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  statuses: jsonb('statuses').$type<RecordStatusDef[]>().notNull().default([]),
  formLayout: jsonb('form_layout').$type<FormLayout>().notNull().default({ sections: [] }),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const rightsProfileCrmDatabases = pgTable(
  'rights_profile_crm_databases',
  {
    rightsProfileId: uuid('rights_profile_id')
      .notNull()
      .references(() => rightsProfiles.id, { onDelete: 'cascade' }),
    crmDatabaseId: uuid('crm_database_id')
      .notNull()
      .references(() => crmDatabases.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rightsProfileId, t.crmDatabaseId] })],
);

export const rightsProfileCrmRecordTypes = pgTable(
  'rights_profile_crm_record_types',
  {
    rightsProfileId: uuid('rights_profile_id')
      .notNull()
      .references(() => rightsProfiles.id, { onDelete: 'cascade' }),
    crmRecordTypeId: uuid('crm_record_type_id')
      .notNull()
      .references(() => crmRecordTypes.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rightsProfileId, t.crmRecordTypeId] })],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    databaseId: uuid('database_id')
      .notNull()
      .references(() => crmDatabases.id),
    name: text('name').notNull(),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('accounts_database_idx').on(t.databaseId), index('accounts_name_idx').on(t.name)],
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    databaseId: uuid('database_id')
      .notNull()
      .references(() => crmDatabases.id),
    accountId: uuid('account_id').references(() => accounts.id),
    name: text('name').notNull(),
    /** Lower-cased, trimmed (spec 12.3). */
    emails: text('emails')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** E.164 (spec 12.3). */
    phones: text('phones')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('contacts_database_idx').on(t.databaseId),
    index('contacts_account_idx').on(t.accountId),
    index('contacts_name_idx').on(t.name),
    index('contacts_emails_gin').using('gin', t.emails),
    index('contacts_phones_gin').using('gin', t.phones),
  ],
);

export const crmRecords = pgTable(
  'crm_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordTypeId: uuid('record_type_id')
      .notNull()
      .references(() => crmRecordTypes.id),
    title: text('title').notNull(),
    status: text('status'),
    stage: text('stage').$type<RecordStage>().notNull().default('open'),
    contactId: uuid('contact_id').references(() => contacts.id),
    accountId: uuid('account_id').references(() => accounts.id),
    userId: uuid('user_id').references(() => users.id),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('crm_records_type_idx').on(t.recordTypeId),
    index('crm_records_contact_idx').on(t.contactId),
    index('crm_records_account_idx').on(t.accountId),
  ],
);

/** Entity history (spec 17): append-only, written in the same transaction as the change. */
export const historyEntries = pgTable(
  'history_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    entityType: text('entity_type').notNull(),
    /** uuid for CRM entities, the ticket number for tickets. */
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id'),
    changes: jsonb('changes').$type<FieldChange[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('history_entity_idx').on(t.entityType, t.entityId, t.createdAt)],
);

/** A user's saved filter on a list (spec 3, "Filter scheme"). Private to the user. */
export const filterSchemes = pgTable(
  'filter_schemes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    list: text('list').notNull(),
    name: text('name').notNull(),
    conditions: jsonb('conditions').$type<FilterCondition[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex('filter_schemes_user_list_name_uq').on(t.userId, t.list, t.name)],
);

/** Per-user list settings such as chosen columns. */
export const listPreferences = pgTable(
  'list_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    list: text('list').notNull(),
    columns: jsonb('columns').$type<string[]>().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.list] })],
);

// ---------------------------------------------------------------- Tickets (Phase 2)

/** Admin-defined status labels, managed globally and enabled per category (spec 7.2). */
export const ticketStatuses = pgTable('ticket_statuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  color: text('color').notNull().default('gray'),
  description: text('description').notNull().default(''),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** The home of a ticket; nearly every ticket behaviour is set here (spec 7.1). */
export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  /** Group label for organising categories in pickers. */
  groupName: text('group_name').notNull().default(''),
  statusRequired: text('status_required').$type<StatusRequired>().notNull().default('never'),
  multipleStatuses: boolean('multiple_statuses').notNull().default(false),
  checkChildOnClose: boolean('check_child_on_close').notNull().default(false),
  autoArchiveDays: integer('auto_archive_days'),
  allowExternalComments: boolean('allow_external_comments').notNull().default(false),
  waitingRequiresReopen: boolean('waiting_requires_reopen').notNull().default(false),
  defaultCrmDatabaseId: uuid('default_crm_database_id').references(() => crmDatabases.id),
  formLayout: jsonb('form_layout').$type<FormLayout>().notNull().default({ sections: [] }),
  autofocusTab: text('autofocus_tab').notNull().default('form'),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const categoryStatuses = pgTable(
  'category_statuses',
  {
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    statusId: uuid('status_id')
      .notNull()
      .references(() => ticketStatuses.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.statusId] })],
);

/** Category rights: Access and Distribution limit per rights profile (spec 4, 9). */
export const rightsProfileCategories = pgTable(
  'rights_profile_categories',
  {
    rightsProfileId: uuid('rights_profile_id')
      .notNull()
      .references(() => rightsProfiles.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    access: boolean('access').notNull().default(true),
    distributionLimit: integer('distribution_limit'),
  },
  (t) => [primaryKey({ columns: [t.rightsProfileId, t.categoryId] })],
);

export const tickets = pgTable(
  'tickets',
  {
    /** Sequential, shown as #number. */
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    state: text('state').$type<TicketState>().notNull().default('open'),
    statusIds: text('status_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    priority: text('priority').$type<Priority>().notNull().default('normal'),
    userId: uuid('user_id').references(() => users.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    parentId: integer('parent_id'),
    mergedIntoId: integer('merged_into_id'),
    /** The activity this child ticket was created from (spec 6.4). */
    sourceActivityId: uuid('source_activity_id'),
    /** Manual deadline (spec 7.1: kept when the category has no SLA, never recalculated). */
    deadline: timestamp('deadline', { withTimezone: true }),
    reopenAt: timestamp('reopen_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    createdById: uuid('created_by_id').references(() => users.id),
    /** Incremented on every save (optimistic locking, spec 13). */
    version: integer('version').notNull().default(1),
    ...timestamps,
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    isAnonymised: boolean('is_anonymised').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('tickets_category_idx').on(t.categoryId, t.state),
    index('tickets_user_idx').on(t.userId, t.state),
    index('tickets_contact_idx').on(t.contactId),
    index('tickets_parent_idx').on(t.parentId),
    index('tickets_reopen_idx').on(t.reopenAt),
  ],
);

export const ticketFollowers = pgTable(
  'ticket_followers',
  {
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.userId] }), index('ticket_followers_user_idx').on(t.userId)],
);

export const ticketFavourites = pgTable(
  'ticket_favourites',
  {
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.userId] })],
);

/**
 * One communication item (spec 3, 5). Phase 2 has internal comments only; emails,
 * calls and chats become further `type`/`channel` values attached the same way.
 */
export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: integer('ticket_id').references(() => tickets.id),
    type: text('type').$type<'comment' | 'email'>().notNull(),
    channel: text('channel').notNull().default('internal'),
    direction: text('direction').$type<'in' | 'out' | 'internal'>().notNull().default('internal'),
    status: text('status').notNull().default('sent'),
    userId: uuid('user_id').references(() => users.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    /** Comments flagged external are visible to external users in the portal. */
    isExternal: boolean('is_external').notNull().default(false),
    bodyHtml: text('body_html').notNull().default(''),
    mentionUserIds: uuid('mention_user_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    repliedToActivityId: uuid('replied_to_activity_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('activities_ticket_idx').on(t.ticketId, t.createdAt)],
);

/** Saved ticket filters shown in the sidebar: team views (no owner) or personal "my" views. */
export const ticketViews = pgTable('ticket_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  conditions: jsonb('conditions').$type<FilterCondition[]>().notNull().default([]),
  columns: jsonb('columns').$type<string[]>(),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const rightsProfileTicketViews = pgTable(
  'rights_profile_ticket_views',
  {
    rightsProfileId: uuid('rights_profile_id')
      .notNull()
      .references(() => rightsProfiles.id, { onDelete: 'cascade' }),
    viewId: uuid('view_id')
      .notNull()
      .references(() => ticketViews.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rightsProfileId, t.viewId] })],
);

/** The user's "My views" sidebar: own views plus pinned team views, ordered, optionally nested or in folders. */
export const sidebarItems = pgTable(
  'sidebar_items',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    viewId: uuid('view_id')
      .notNull()
      .references(() => ticketViews.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    folder: text('folder'),
    parentViewId: uuid('parent_view_id'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.viewId] })],
);
