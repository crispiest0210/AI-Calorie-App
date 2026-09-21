/**
 * Every request runs inside one transaction that first declares who is asking.
 * The connection role is `app_api`, which does not own the tables, so row-level
 * security is enforced by Postgres rather than by the handler remembering to
 * add a `where user_id = ...` — defence in depth behind the auth middleware.
 */
import { Pool, type PoolClient } from 'pg';
import pg from 'pg';

// Nutrient values are `numeric`. node-postgres parses numeric as a JS float by
// default, which would undo the whole point of decimal arithmetic (review R13).
pg.types.setTypeParser(1700, (value: string) => value);
// int8 (server_rev) comes back as a string for the same reason; we want numbers
// small enough to be exact, so parse it deliberately.
pg.types.setTypeParser(20, (value: string) => Number(value));

export interface DbConfig {
  connectionString: string;
  /** Role the request runs as. Not the table owner, so RLS applies. */
  role?: string;
}

export function createPool(config: DbConfig): Pool {
  return new Pool({ connectionString: config.connectionString, max: 10 });
}

export type Sql = PoolClient;

/**
 * Runs `work` in a transaction with the caller's identity set for the length
 * of that transaction only (`set_config(..., true)` is transaction-local).
 */
export async function withUser<T>(pool: Pool, userId: string, work: (sql: Sql) => Promise<T>, role = 'app_api'): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select set_config($1, $2, true)', ['app.user_id', userId]);
    await client.query(`set local role ${role}`);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Privileged work with no user context: migrations, catalog import, purges. */
export async function withService<T>(pool: Pool, work: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}
