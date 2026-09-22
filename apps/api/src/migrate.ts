/** Applies the checked-in SQL migrations, the same way CI does (spec 6.2). */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { withService } from './db';

const MIGRATION_DIR = path.resolve(import.meta.dirname, '..', 'migrations');

export async function migrate(pool: Pool, dir = MIGRATION_DIR): Promise<string[]> {
  return withService(pool, async (sql) => {
    await sql.query(`create table if not exists schema_migration (
      name text primary key, applied_at timestamptz not null default now())`);
    const { rows } = await sql.query<{ name: string }>('select name from schema_migration');
    const applied = new Set(rows.map((r) => r.name));

    const ran: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const name = file.replace(/\.sql$/, '');
      if (applied.has(name)) continue;
      await sql.query('begin');
      try {
        await sql.query(readFileSync(path.join(dir, file), 'utf8'));
        await sql.query('insert into schema_migration (name) values ($1)', [name]);
        await sql.query('commit');
      } catch (error) {
        await sql.query('rollback');
        throw error;
      }
      ran.push(name);
    }
    return ran;
  });
}
