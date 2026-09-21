/**
 * A repeated POST with the same Idempotency-Key returns the stored response
 * instead of acting twice, so a retry after a dropped connection is safe (4.1).
 */
import type { Sql } from './db';

const WINDOW_HOURS = 24;

export async function replay(sql: Sql, userId: string, key: string | undefined): Promise<unknown | null> {
  if (key === undefined || key === '') return null;
  const { rows } = await sql.query<{ response: unknown }>(
    `select response from idempotency_key
     where key = $1 and user_id = $2 and created_at > now() - interval '${WINDOW_HOURS} hours'`,
    [key, userId],
  );
  return rows[0]?.response ?? null;
}

export async function remember(sql: Sql, userId: string, key: string | undefined, response: unknown): Promise<void> {
  if (key === undefined || key === '') return;
  await sql.query(
    `insert into idempotency_key (key, user_id, response) values ($1, $2, $3)
     on conflict (key) do update set response = excluded.response, created_at = now()`,
    [key, userId, JSON.stringify(response)],
  );
}
