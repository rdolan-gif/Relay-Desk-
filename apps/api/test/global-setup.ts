import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://relay:relay@localhost:5432/relay_desk_test';

/** Recreates the test schema from migrations once per test run. */
export default async function setup() {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  await client.end();
  await runMigrations(TEST_DATABASE_URL);
}
