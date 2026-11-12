import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction; services accept either. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

export function createPool(url: string): Pool {
  const pool = new Pool({ connectionString: url, max: 10 });
  // A connection dropped by the database (restart, failover) must not crash the API: the pool
  // only listens on idle connections, so a connection that is checked out (e.g. mid-transaction)
  // needs its own listener. The query in flight still fails; the pool opens a fresh connection.
  const lost = (err: Error) => console.error(`database connection lost: ${err.message}`);
  pool.on('error', lost);
  pool.on('connect', (client) => client.on('error', lost));
  return pool;
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
