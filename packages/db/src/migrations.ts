/**
 * Applies the checked-in SQL migrations to whichever SQLite the caller has —
 * expo-sqlite on device, better-sqlite3 in tests and the catalog builder.
 */
import { MIGRATIONS, type Migration } from './migrations.generated';

export type { Migration };
export { MIGRATIONS };

/** The one thing both drivers do the same way: run a script of statements. */
export interface RawSqlite {
  execute(sql: string): void;
  select<T>(sql: string): T[];
}

/**
 * Connection pragmas. They are set when the database is opened, not in a
 * migration: SQLite refuses to change journal_mode inside a transaction.
 */
export const CONNECTION_PRAGMAS = ['pragma journal_mode = wal;', 'pragma foreign_keys = on;'] as const;

export function applyPragmas(db: RawSqlite): void {
  for (const pragma of CONNECTION_PRAGMAS) db.execute(pragma);
}

const LEDGER = `create table if not exists schema_migration (
  name text primary key,
  applied_at integer not null
);`;

export function appliedMigrations(db: RawSqlite): string[] {
  db.execute(LEDGER);
  return db.select<{ name: string }>('select name from schema_migration order by name;').map((r) => r.name);
}

/** `appliedAt` is injectable so the catalog builder can produce identical files. */
export function runMigrations(db: RawSqlite, migrations: readonly Migration[] = MIGRATIONS, appliedAt: number = Date.now()): string[] {
  const applied = new Set(appliedMigrations(db));
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    db.execute(`begin;\n${migration.sql}\ninsert into schema_migration (name, applied_at) values ('${migration.name}', ${appliedAt});\ncommit;`);
    ran.push(migration.name);
  }
  return ran;
}
