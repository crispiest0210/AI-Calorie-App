import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withService } from '../src/db';
import { migrate } from '../src/migrate';
import { startHarness, type Harness } from './harness';

const SCHEMA = 'migrate_scratch';

describe('migrate', () => {
  let h: Harness;
  let scratch: Pool;
  let dir: string;

  const write = (name: string, body: string) => writeFileSync(path.join(dir, name), body);
  const tables = () =>
    withService(scratch, async (sql) => {
      const { rows } = await sql.query<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema = $1 order by 1`,
        [SCHEMA],
      );
      return rows.map((r) => r.table_name);
    });

  beforeAll(async () => {
    h = await startHarness();
    await h.pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await h.pool.query(`create schema ${SCHEMA}`);
    // A separate schema keeps these throwaway migrations away from the real ones.
    scratch = new Pool({ connectionString: h.pool.options.connectionString, options: `-c search_path=${SCHEMA}` });
  });
  afterAll(async () => {
    await scratch.end();
    await h.pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await h.stop();
  });
  beforeEach(async () => {
    await scratch.query('drop table if exists schema_migration, a, b, c');
    dir = mkdtempSync(path.join(tmpdir(), 'nt-migrations-'));
    return () => rmSync(dir, { recursive: true, force: true });
  });

  it('applies .sql files in name order, ignores other files, and records each name', async () => {
    write('0002_b.sql', 'create table b (id int)');
    write('0001_a.sql', 'create table a (id int)');
    write('notes.txt', 'not a migration');

    expect(await migrate(scratch, dir)).toEqual(['0001_a', '0002_b']);
    expect(await tables()).toEqual(['a', 'b', 'schema_migration']);
    const { rows } = await scratch.query('select name from schema_migration order by name');
    expect(rows.map((r) => r.name)).toEqual(['0001_a', '0002_b']);
  });

  it('is idempotent and only runs files added since the last call', async () => {
    write('0001_a.sql', 'create table a (id int)');
    expect(await migrate(scratch, dir)).toEqual(['0001_a']);
    expect(await migrate(scratch, dir)).toEqual([]);

    write('0002_b.sql', 'create table b (id int)');
    expect(await migrate(scratch, dir)).toEqual(['0002_b']);
  });

  it('rolls back a failing migration, records nothing for it, and stops there', async () => {
    write('0001_a.sql', 'create table a (id int)');
    write('0002_b.sql', 'create table b (id int); select * from does_not_exist;');
    write('0003_c.sql', 'create table c (id int)');

    await expect(migrate(scratch, dir)).rejects.toThrow(/does_not_exist/);
    expect(await tables()).toEqual(['a', 'schema_migration']);
    const { rows } = await scratch.query('select name from schema_migration');
    expect(rows.map((r) => r.name)).toEqual(['0001_a']);

    // Fixing the file lets the next run pick up exactly where it stopped.
    write('0002_b.sql', 'create table b (id int)');
    expect(await migrate(scratch, dir)).toEqual(['0002_b', '0003_c']);
  });
});
