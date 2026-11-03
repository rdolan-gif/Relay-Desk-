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
} from 'drizzle-orm/pg-core';
import type { AccessFlagMap, ModuleAccessMap, UserType } from '@relay-desk/domain';

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
