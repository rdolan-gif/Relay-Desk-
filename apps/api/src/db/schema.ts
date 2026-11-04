import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';
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
  Address,
  FieldOption,
  FieldType,
  FilterCondition,
  FormLayout,
  ModuleAccessMap,
  RecordStatusDef,
  RecordStage,
  RoutingActions,
  RoutingCondition,
  Priority,
  StatusRequired,
  MacroAction,
  MacroPosition,
  SlaTarget,
  SlaUnit,
  TicketState,
  Interval,
  TimeException,
  UserType,
} from '@relay-desk/domain';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

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
    allMailboxes: boolean('all_mailboxes').notNull().default(false),
    allMacros: boolean('all_macros').notNull().default(false),
    /** Every knowledge-base folder with full rights (spec 15). */
    allKbFolders: boolean('all_kb_folders').notNull().default(false),
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
    /** Email sign-off, e.g. "Kind regards,\nRyan" (owner answer Q13). Null = default. */
    signature: text('signature'),
    /** When distribution last gave this user a ticket (spec 9 tie-break). */
    lastDistributedAt: timestamp('last_distributed_at', { withTimezone: true }),
    /** Where notification emails go (spec 13); null = their sign-in email. */
    notificationEmail: text('notification_email'),
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
    /** Company › Branch (owner answer Q2): a branch points at its company. */
    parentId: uuid('parent_id'),
    branchCode: text('branch_code'),
    emails: text('emails')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    phones: text('phones')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    addresses: jsonb('addresses').$type<Address[]>().notNull().default([]),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    /** Overrides the category's SLA for this account's contacts (spec 8). */
    slaId: uuid('sla_id').references(() => slaDefinitions.id),
    mergedIntoId: uuid('merged_into_id'),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('accounts_database_idx').on(t.databaseId),
    index('accounts_name_idx').on(t.name),
    index('accounts_parent_idx').on(t.parentId),
  ],
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
    /** Merged into this contact (spec 12.4); the row is soft-deleted. */
    mergedIntoId: uuid('merged_into_id'),
    /** Right to erasure (spec 14): personal data replaced; the row stays for reports. */
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
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
  /** SLA (spec 7.1): none = no automatic deadline. */
  slaId: uuid('sla_id').references(() => slaDefinitions.id),
  /** Working hours for SLA maths; none = the clock runs 24/7. */
  timeGroupId: uuid('time_group_id').references(() => timeGroups.id),
  /** Retention (spec 14 [SHOULD]): anonymise or delete tickets N days after archiving. */
  retentionAction: text('retention_action').$type<'none' | 'anonymise' | 'delete'>().notNull().default('none'),
  retentionDays: integer('retention_days'),
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
    /** Automatic distribution on (spec 9); the limit is optional (owner O-16: no cap). */
    distribute: boolean('distribute').notNull().default(false),
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
    /** First qualifying reply to the customer (spec 8, "What counts as a response"). */
    firstAnswerAt: timestamp('first_answer_at', { withTimezone: true }),
    /** Closed as "FYI – no reply needed" (owner O-12): no reply target applies. */
    noReplyNeeded: boolean('no_reply_needed').notNull().default(false),
    /** SLA (spec 8). The deadline column above is the solution deadline. */
    firstAnswerDeadline: timestamp('first_answer_deadline', { withTimezone: true }),
    deadlineManual: boolean('deadline_manual').notNull().default(false),
    waitingSince: timestamp('waiting_since', { withTimezone: true }),
    slaPausedSeconds: integer('sla_paused_seconds').notNull().default(0),
    firstAnswerMet: boolean('first_answer_met'),
    solutionMet: boolean('solution_met'),
    /** Created through a mailbox queue with no User: eligible for distribution (spec 9). */
    distributable: boolean('distributable').notNull().default(false),
    isAnonymised: boolean('is_anonymised').notNull().default(false),
    /** When the ticket was last archived (retention, spec 14). */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('tickets_category_idx').on(t.categoryId, t.state),
    index('tickets_user_idx').on(t.userId, t.state),
    index('tickets_contact_idx').on(t.contactId),
    index('tickets_parent_idx').on(t.parentId),
    index('tickets_reopen_idx').on(t.reopenAt),
    index('tickets_backlog_idx')
      .on(t.categoryId, t.createdAt)
      .where(sql`distributable AND user_id IS NULL AND state = 'open' AND deleted_at IS NULL`),
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
    /** Other tickets this inbound email's headers also matched (spec 6.2 suggested-ticket banner). */
    suggestedTicketIds: integer('suggested_ticket_ids')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    /** Sent automatically (auto-response): never counts as a reply (spec 8). */
    isAutomatic: boolean('is_automatic').notNull().default(false),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Full-text search over the body (spec 14), maintained by PostgreSQL. */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('simple', regexp_replace(coalesce(body_html, ''), '<[^>]+>', ' ', 'g'))`,
    ),
  },
  (t) => [
    index('activities_ticket_idx').on(t.ticketId, t.createdAt),
    index('activities_search_gin').using('gin', t.searchVector),
    index('activities_contact_idx').on(t.contactId),
  ],
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

/**
 * A merge, kept so it can be undone (owner answer Q4): which activities and followers
 * moved from the merged ticket into the survivor.
 */
export const ticketMerges = pgTable(
  'ticket_merges',
  {
    id: serial('id').primaryKey(),
    survivorId: integer('survivor_id')
      .notNull()
      .references(() => tickets.id),
    mergedId: integer('merged_id')
      .notNull()
      .references(() => tickets.id),
    activityIds: uuid('activity_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    addedFollowerIds: uuid('added_follower_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    undoneById: uuid('undone_by_id').references(() => users.id),
  },
  (t) => [index('ticket_merges_survivor_idx').on(t.survivorId)],
);

// ---------------------------------------------------------------- Email (Phase 3)

/** A connected mailbox (spec 11.1). Credentials are encrypted with SecretBox. */
export const mailboxQueues = pgTable(
  'mailbox_queues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    /** Lower-cased mailbox address, e.g. support@ricoman.com. */
    address: text('address').notNull(),
    senderName: text('sender_name').notNull().default(''),
    provider: text('provider').$type<'gmail' | 'fake'>().notNull().default('gmail'),
    defaultCategoryId: uuid('default_category_id')
      .notNull()
      .references(() => categories.id),
    headerThreading: boolean('header_threading').notNull().default(true),
    active: boolean('active').notNull().default(true),
    /** Staff notification emails are sent from this mailbox (spec 13). */
    sendsNotifications: boolean('sends_notifications').notNull().default(false),
    autoResponseEnabled: boolean('auto_response_enabled').notNull().default(false),
    autoResponseNewOnly: boolean('auto_response_new_only').notNull().default(true),
    autoResponseTemplateId: uuid('auto_response_template_id'),
    defaultBodyTemplateId: uuid('default_body_template_id'),
    credentialsEnc: text('credentials_enc'),
    connectedAs: text('connected_as'),
    syncCursor: text('sync_cursor'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('mailbox_queues_address_uq')
      .on(t.address)
      .where(sql`deleted_at IS NULL`),
  ],
);

/** CRM databases searched for the sender of mail arriving in a mailbox (spec 11.1, 12.3). */
export const mailboxQueueCrmDatabases = pgTable(
  'mailbox_queue_crm_databases',
  {
    queueId: uuid('queue_id')
      .notNull()
      .references(() => mailboxQueues.id, { onDelete: 'cascade' }),
    crmDatabaseId: uuid('crm_database_id')
      .notNull()
      .references(() => crmDatabases.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.queueId, t.crmDatabaseId] })],
);

/** Mailboxes a rights profile may send from (spec 4). */
export const rightsProfileMailboxes = pgTable(
  'rights_profile_mailboxes',
  {
    rightsProfileId: uuid('rights_profile_id')
      .notNull()
      .references(() => rightsProfiles.id, { onDelete: 'cascade' }),
    queueId: uuid('queue_id')
      .notNull()
      .references(() => mailboxQueues.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rightsProfileId, t.queueId] })],
);

export interface MailAddressJson {
  name?: string;
  address: string;
}

/** The email part of an email activity (spec 5). */
export const emailMessages = pgTable(
  'email_messages',
  {
    activityId: uuid('activity_id')
      .primaryKey()
      .references(() => activities.id, { onDelete: 'cascade' }),
    queueId: uuid('queue_id').references(() => mailboxQueues.id),
    providerMessageId: text('provider_message_id'),
    providerThreadId: text('provider_thread_id'),
    messageId: text('message_id'),
    inReplyTo: text('in_reply_to'),
    references: text('references')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    from: jsonb('from').$type<MailAddressJson>().notNull(),
    to: jsonb('to').$type<MailAddressJson[]>().notNull().default([]),
    cc: jsonb('cc').$type<MailAddressJson[]>().notNull().default([]),
    bcc: jsonb('bcc').$type<MailAddressJson[]>().notNull().default([]),
    replyTo: jsonb('reply_to').$type<MailAddressJson[]>().notNull().default([]),
    subject: text('subject').notNull().default(''),
    bodyText: text('body_text').notNull().default(''),
    classification: text('classification').notNull().default('normal'),
    rawStorageKey: text('raw_storage_key'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(body_text, ''))`,
    ),
  },
  (t) => [
    index('email_messages_message_id_idx').on(t.messageId),
    index('email_messages_queue_idx').on(t.queueId),
    index('email_messages_search_gin').using('gin', t.searchVector),
  ],
);

/** Every message fetched from a mailbox, so restarts never duplicate or skip mail (spec 11.1). */
export const inboundLog = pgTable(
  'inbound_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    queueId: uuid('queue_id')
      .notNull()
      .references(() => mailboxQueues.id),
    providerMessageId: text('provider_message_id').notNull(),
    outcome: text('outcome').notNull(),
    ticketId: integer('ticket_id'),
    activityId: uuid('activity_id'),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('inbound_log_queue_msg_uq').on(t.queueId, t.providerMessageId)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'activity' once attached; 'upload' while waiting to be sent with an email. */
    ownerType: text('owner_type').$type<'activity' | 'upload' | 'kb_article'>().notNull(),
    ownerId: text('owner_id').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
    checksum: text('checksum').notNull(),
    contentId: text('content_id'),
    inline: boolean('inline').notNull().default(false),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('attachments_owner_idx').on(t.ownerType, t.ownerId)],
);

/** Ordered email routing rules (spec 11.3); all matching rules apply in order (owner S-3). */
export const routingRules = pgTable('routing_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  direction: text('direction').$type<'incoming' | 'outgoing' | 'both'>().notNull().default('incoming'),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  allConditions: jsonb('all_conditions').$type<RoutingCondition[]>().notNull().default([]),
  anyConditions: jsonb('any_conditions').$type<RoutingCondition[]>().notNull().default([]),
  actions: jsonb('actions').$type<RoutingActions>().notNull().default({}),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** Reply templates, auto-responses and default bodies, written by the team (owner O-6). */
export const emailTemplates = pgTable('email_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').$type<'reply' | 'auto_response' | 'default_body'>().notNull().default('reply'),
  title: text('title').notNull(),
  subject: text('subject'),
  bodyHtml: text('body_html').notNull().default(''),
  /** Empty = every mailbox / category. */
  queueIds: uuid('queue_ids')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  categoryIds: uuid('category_ids')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  createdById: uuid('created_by_id').references(() => users.id),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** SLA definitions (spec 8). */
export const slaDefinitions = pgTable('sla_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  unit: text('unit').$type<SlaUnit>().notNull().default('hours'),
  /** null = targets by priority; otherwise a select custom field (owner O-11: enquiry type). */
  basisFieldId: uuid('basis_field_id').references(() => customFields.id),
  targets: jsonb('targets').$type<Record<string, SlaTarget>>().notNull().default({}),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** Time groups: weekly working hours, timezone and dated exceptions (spec 8). */
export const timeGroups = pgTable('time_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  timezone: text('timezone').notNull().default('Europe/London'),
  /** Index 0 = Monday … 6 = Sunday. */
  week: jsonb('week').$type<Interval[][]>().notNull(),
  exceptions: jsonb('exceptions').$type<TimeException[]>().notNull().default([]),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** "Ready for email": the mailbox queues a user is logged in to for distribution (spec 9). */
export const queueLogins = pgTable(
  'queue_logins',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    queueId: uuid('queue_id')
      .notNull()
      .references(() => mailboxQueues.id, { onDelete: 'cascade' }),
    since: timestamp('since', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.queueId] })],
);

/** In-app notification centre (spec 13). */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** assigned, mention, activity, sla_warning, sla_breached, email_failed, job_done */
    kind: text('kind').notNull(),
    ticketId: integer('ticket_id'),
    actorId: uuid('actor_id').references(() => users.id),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** Stops repeats, e.g. one SLA warning per deadline. */
    dedupeKey: text('dedupe_key'),
    /** Where clicking goes when it is not a ticket, e.g. "/jobs". */
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('notifications_dedupe_uq')
      .on(t.userId, t.dedupeKey)
      .where(sql`dedupe_key IS NOT NULL`),
  ],
);

/** Email notification rules per category, per user (spec 13). */
export const notificationRules = pgTable(
  'notification_rules',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    owner: boolean('owner').notNull().default(false),
    followed: boolean('followed').notNull().default(false),
    isNew: boolean('is_new').notNull().default(false),
    activity: boolean('activity').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.categoryId] })],
);

/** Macros (spec 10). */
export const macros = pgTable('macros', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  colour: text('colour').notNull().default('blue'),
  position: text('position').$type<MacroPosition>().notNull().default('button'),
  actions: jsonb('actions').$type<MacroAction[]>().notNull().default([]),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const macroCategories = pgTable(
  'macro_categories',
  {
    macroId: uuid('macro_id')
      .notNull()
      .references(() => macros.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.macroId, t.categoryId] })],
);

export const rightsProfileMacros = pgTable(
  'rights_profile_macros',
  {
    rightsProfileId: uuid('rights_profile_id')
      .notNull()
      .references(() => rightsProfiles.id, { onDelete: 'cascade' }),
    macroId: uuid('macro_id')
      .notNull()
      .references(() => macros.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rightsProfileId, t.macroId] })],
);

/** Background jobs (spec 14): bulk edits, imports, exports, erasure, subject access exports. */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    status: text('status').$type<'queued' | 'running' | 'done' | 'failed'>().notNull().default('queued'),
    title: text('title').notNull(),
    total: integer('total').notNull().default(0),
    done: integer('done').notNull().default(0),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    /** A file to download when finished (export, error report, ZIP). */
    fileKey: text('file_key'),
    fileName: text('file_name'),
    fileMime: text('file_mime'),
    createdById: uuid('created_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('jobs_user_idx').on(t.createdById, t.createdAt)],
);

/** Saved column mappings for imports (spec 12.4). */
export const importTemplates = pgTable('import_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  entity: text('entity').$type<'contacts' | 'accounts'>().notNull(),
  name: text('name').notNull(),
  mapping: jsonb('mapping').$type<Record<string, string>>().notNull(),
  createdById: uuid('created_by_id').references(() => users.id),
  ...timestamps,
});

/** Knowledge base (spec 15): a nested folder tree. */
export const kbFolders = pgTable('kb_folders', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id'),
  title: text('title').notNull(),
  position: integer('position').notNull().default(0),
  ...timestamps,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const kbArticles = pgTable(
  'kb_articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => kbFolders.id),
    title: text('title').notNull(),
    bodyHtml: text('body_html').notNull().default(''),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: integer('version').notNull().default(1),
    authorId: uuid('author_id').references(() => users.id),
    updatedById: uuid('updated_by_id').references(() => users.id),
    /** The ticket activity it was written from, if any. */
    sourceActivityId: uuid('source_activity_id'),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || regexp_replace(coalesce(body_html, ''), '<[^>]+>', ' ', 'g'))`,
    ),
  },
  (t) => [
    index('kb_articles_folder_idx').on(t.folderId),
    index('kb_articles_search_gin').using('gin', t.searchVector),
    index('kb_articles_tags_gin').using('gin', t.tags),
  ],
);

/** Every saved version, for history and restore (spec 15). */
export const kbArticleVersions = pgTable(
  'kb_article_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => kbArticles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    bodyHtml: text('body_html').notNull(),
    tags: text('tags').array().notNull(),
    folderId: uuid('folder_id').notNull(),
    editedById: uuid('edited_by_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('kb_article_versions_uq').on(t.articleId, t.version)],
);

/** Folder rights per rights profile (spec 15). */
export const rightsProfileKbFolders = pgTable(
  'rights_profile_kb_folders',
  {
    rightsProfileId: uuid('rights_profile_id')
      .notNull()
      .references(() => rightsProfiles.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => kbFolders.id, { onDelete: 'cascade' }),
    view: boolean('view').notNull().default(true),
    create: boolean('create').notNull().default(false),
    update: boolean('update').notNull().default(false),
    delete: boolean('delete').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.rightsProfileId, t.folderId] })],
);
