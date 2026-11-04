import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.factory';
import { loadConfig } from '../src/config/config';
import { createDb, createPool } from '../src/db/db';
import { DEFAULT_SEED_PASSWORD, seed } from '../src/db/seed';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://relay:relay@localhost:5432/relay_desk_test';
export const PASSWORD = DEFAULT_SEED_PASSWORD;
export const STRONG_PASSWORD = 'copper-meadow-quartz-88';

export interface TestContext {
  app: INestApplication;
  ids: Awaited<ReturnType<typeof seed>>;
  close: () => Promise<void>;
}

/** Fresh app over a truncated, re-seeded test database. */
export async function createTestContext(): Promise<TestContext> {
  const pool = createPool(TEST_DATABASE_URL);
  const db = createDb(pool);
  await db.execute(sql`
    TRUNCATE inbound_log, email_messages, attachments, email_templates, routing_rules, rights_profile_mailboxes,
      mailbox_queue_crm_databases, mailbox_queues, ticket_merges, sidebar_items, rights_profile_ticket_views, ticket_views, activities, ticket_favourites,
      ticket_followers, tickets, rights_profile_categories, category_statuses, categories, ticket_statuses,
      history_entries, filter_schemes, list_preferences, crm_records, contacts, accounts,
      rights_profile_crm_databases, rights_profile_crm_record_types, crm_record_types, crm_databases,
      custom_fields, audit_log, login_attempts, sessions, rights_profile_visible_users,
      rights_profile_editable_access_profiles, rights_profile_editable_rights_profiles,
      notifications, notification_rules, queue_logins, rights_profile_macros, macro_categories, macros,
      ticket_reads, sla_definitions, time_groups, jobs, import_templates, kb_article_versions, kb_articles, rights_profile_kb_folders, kb_folders,
      users, access_profiles, rights_profiles RESTART IDENTITY CASCADE
  `);
  const ids = await seed(db, PASSWORD);
  await pool.end();

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    STORAGE_DIR: `${tmpdir()}/relay-desk-test-storage`,
  } as NodeJS.ProcessEnv);
  const app = await createApp(config, { logger: false });
  await app.init();
  return { app, ids, close: () => app.close() };
}

/** A logged-in browser-like client: keeps the session cookie and sends the CSRF header. */
export class Client {
  readonly agent: ReturnType<typeof request.agent>;
  csrf = '';
  userId = '';

  constructor(app: INestApplication) {
    this.agent = request.agent(app.getHttpServer());
  }

  async login(email: string, password = PASSWORD, totpCode?: string) {
    const res = await this.agent.post('/api/auth/login').send({ email, password, totpCode });
    if (res.status === 200) {
      this.csrf = res.body.csrfToken;
      this.userId = res.body.user.id;
    }
    return res;
  }

  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body?: object) {
    return this.agent.post(url).set('x-csrf-token', this.csrf).send(body);
  }
  put(url: string, body?: object) {
    return this.agent.put(url).set('x-csrf-token', this.csrf).send(body);
  }
  patch(url: string, body?: object) {
    return this.agent.patch(url).set('x-csrf-token', this.csrf).send(body);
  }
  delete(url: string) {
    return this.agent.delete(url).set('x-csrf-token', this.csrf);
  }
}

export async function loginAs(app: INestApplication, email: string, password = PASSWORD) {
  const c = new Client(app);
  const res = await c.login(email, password);
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}
