/**
 * Opens the local database and keeps the UI in step with it.
 *
 * SQLite is the single source of truth (spec 2.2): screens read it through
 * `useDbQuery`, which re-runs whenever the database changes. Nothing caches a
 * second copy of user data.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { applyPragmas, runMigrations, schema, water, type Db, type RawSqlite } from '@nt/db';

export const DATABASE_NAME = 'nutrition.db';

interface DbContextValue {
  db: Db;
  /** Bumped on every database change; `useDbQuery` re-reads when it moves. */
  revision: number;
}

const DbContext = createContext<DbContextValue | null>(null);

/**
 * First launch copies the bundled catalog (already carrying the schema and
 * ~460 foods) into place, so search works offline before anything is logged.
 */
async function ensureDatabaseFile(): Promise<void> {
  const directory = new Directory(Paths.document, 'SQLite');
  if (!directory.exists) directory.create({ intermediates: true });

  const target = new File(directory, DATABASE_NAME);
  if (target.exists) return;

  const asset = Asset.fromModule(require('../../assets/catalog.sqlite') as number);
  await asset.downloadAsync();
  if (asset.localUri === null) throw new Error('bundled catalog asset is missing');
  new File(asset.localUri).copy(target);
}

function openDatabase(): { db: Db; native: SQLite.SQLiteDatabase } {
  // Without `enableChangeListener` expo-sqlite never installs SQLite's update
  // hook, and `addDatabaseChangeListener` silently never fires — writes land
  // but no screen hears about them.
  const native = SQLite.openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });
  const raw: RawSqlite = {
    execute: (sql) => native.execSync(sql),
    select: <T,>(sql: string) => native.getAllSync<T>(sql),
  };
  applyPragmas(raw);
  // The bundled catalog already carries the schema, so this is usually a no-op;
  // it is what applies a new migration after an app update.
  runMigrations(raw);
  const db = drizzle(native, { schema }) as unknown as Db;
  water.ensureDefaultPresets(db);
  return { db, native };
}

export function DatabaseProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }): React.JSX.Element {
  const [value, setValue] = useState<{ db: Db; native: SQLite.SQLiteDatabase } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    ensureDatabaseFile()
      .then(() => {
        if (cancelled) return;
        setValue(openDatabase());
      })
      .catch((err: unknown) => setError(err instanceof Error ? err : new Error(String(err))));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (value === null) return undefined;
    // `databaseName` is SQLite's internal name — "main" — not the file name,
    // so the file path is what identifies our database. Only one is ever open,
    // so an unrecognised path still counts rather than being dropped.
    const subscription = SQLite.addDatabaseChangeListener(({ databaseFilePath }) => {
      if (databaseFilePath === undefined || databaseFilePath.endsWith(DATABASE_NAME)) {
        setRevision((r) => r + 1);
      }
    });
    return () => subscription.remove();
  }, [value]);

  const context = useMemo(() => (value === null ? null : { db: value.db, revision }), [value, revision]);

  if (error !== null) throw error;
  if (context === null) return <>{fallback}</>;
  return <DbContext.Provider value={context}>{children}</DbContext.Provider>;
}

export function useDb(): Db {
  const context = useContext(DbContext);
  if (context === null) throw new Error('useDb must be used inside DatabaseProvider');
  return context.db;
}

/**
 * Reads from SQLite and re-reads when the database changes or `deps` move.
 * Reads are synchronous, so a logged entry is on screen in the same frame —
 * that is what keeps the 50 ms save-to-totals budget (spec 2.13).
 */
export function useDbQuery<T>(read: (db: Db) => T, deps: readonly unknown[] = []): T {
  const context = useContext(DbContext);
  if (context === null) throw new Error('useDbQuery must be used inside DatabaseProvider');
  const { db, revision } = context;
  const readRef = useRef(read);
  readRef.current = read;

  return useMemo(() => readRef.current(db), [db, revision, ...deps]);
}
