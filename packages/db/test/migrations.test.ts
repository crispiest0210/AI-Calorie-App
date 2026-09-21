import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from '../src/migrations.generated';
import { renderMigrations } from '../scripts/build-migrations.mjs';
import { freshDb } from './helpers';

const MIGRATION_DIR = path.resolve(import.meta.dirname, '..', 'migrations');

describe('migrations', () => {
  it('keeps the generated module in step with the SQL files', () => {
    const onDisk = readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'migrations.generated.ts'), 'utf8');
    expect(onDisk).toBe(renderMigrations());
  });

  it('embeds every checked-in migration', () => {
    const files = readdirSync(MIGRATION_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(MIGRATIONS.map((m) => `${m.name}.sql`)).toEqual(files);
  });

  it('applies to a fresh database and is idempotent', () => {
    const { db, sqlite } = freshDb();
    const tables = sqlite.prepare("select name from sqlite_master where type='table' order by name").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('log_entry');
    expect(tables.map((t) => t.name)).toContain('food_fts');
    expect(sqlite.prepare('select count(*) as n from schema_migration').get()).toEqual({ n: 1 });
    void db;
  });

  it('refuses a log entry that breaks its own shape', () => {
    const { sqlite } = freshDb();
    expect(() =>
      sqlite
        .prepare(
          `insert into log_entry (id, local_date, logged_at, tz_offset_min, meal_slot, entry_kind, amount_value, amount_unit, grams_provenance, food_name_snapshot, updated_at)
           values ('x','2026-09-20',0,0,'lunch','food','1','g','user','Rice',0)`,
        )
        .run(),
    ).toThrow(/CHECK constraint/i);
  });
});
