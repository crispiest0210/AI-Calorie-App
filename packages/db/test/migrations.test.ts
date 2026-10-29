import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { parseJson } from '../src/db';
import { appliedMigrations, runMigrations, type RawSqlite } from '../src/migrations';
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
    // One row per checked-in migration file.
    expect(sqlite.prepare('select count(*) as n from schema_migration').get()).toEqual({ n: MIGRATIONS.length });
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

  describe('runMigrations', () => {
    const rawDb = (): RawSqlite => {
      const sqlite = new Database(':memory:');
      return { execute: (sql) => void sqlite.exec(sql), select: (sql) => sqlite.prepare(sql).all() as never[] };
    };
    const migrations = [
      { name: '0001_a', sql: 'create table a (id integer);' },
      { name: '0002_b', sql: 'create table b (id integer);' },
    ];

    it('reports what it ran and only runs what is still pending', () => {
      const raw = rawDb();
      expect(runMigrations(raw, migrations.slice(0, 1))).toEqual(['0001_a']);
      expect(runMigrations(raw, migrations)).toEqual(['0002_b']);
      expect(runMigrations(raw, migrations)).toEqual([]);
      expect(appliedMigrations(raw)).toEqual(['0001_a', '0002_b']);
    });

    it('records the injected timestamp in the ledger', () => {
      const raw = rawDb();
      runMigrations(raw, migrations, 1234);
      expect(raw.select('select applied_at from schema_migration')).toEqual([{ applied_at: 1234 }, { applied_at: 1234 }]);
    });
  });
});

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('falls back for null, undefined, empty and corrupt text', () => {
    for (const value of [null, undefined, '', '{not json']) expect(parseJson(value, { fallback: true })).toEqual({ fallback: true });
  });
});
