import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { Schema } from './schema';

/** Any synchronous Drizzle SQLite database: expo-sqlite on device, better-sqlite3 in tests. */
export type Db = BaseSQLiteDatabase<'sync', unknown, Schema>;

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type Writer = Db | Tx;

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
