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
  // An idle connection dropped by the database (restart, failover) must not crash the API;
  // the pool opens a fresh one on the next query.
  pool.on('error', (err) => console.error(`database connection lost: ${err.message}`));
  return pool;
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}
