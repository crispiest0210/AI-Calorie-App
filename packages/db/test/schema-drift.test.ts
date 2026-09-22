/**
 * The SQL files are the source of truth; the Drizzle schema is a mirror.
 * This test fails if a column is added to one and not the other.
 */
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { schema } from '../src/schema';
import { freshDb } from './helpers';

describe('schema drift', () => {
  const { sqlite } = freshDb();

  for (const [key, table] of Object.entries(schema)) {
    const config = getTableConfig(table);
    it(`${config.name} matches the migration`, () => {
      const columns = sqlite.prepare(`pragma table_info(${config.name})`).all() as { name: string; notnull: number }[];
      expect(columns.length, `${key} has no table in SQL`).toBeGreaterThan(0);
      const sqlNames = columns.map((c) => c.name).sort();
      const drizzleNames = config.columns.map((c) => c.name).sort();
      expect(drizzleNames).toEqual(sqlNames);
    });
  }
});
