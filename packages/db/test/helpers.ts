import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  NUTRIENT_DEFS,
  NUTRIENT_CODES,
  customFoodFromLabel,
  type CanonicalFood,
} from '@nt/core';
import { applyPragmas, runMigrations, type RawSqlite } from '../src/migrations';
import { schema, nutrientDef, sourceRelease } from '../src/schema';
import type { Db } from '../src/db';
import { insertFood } from '../src/repositories/foods';

export const RELEASE_ID = 'release-test';

export function freshDb(): { db: Db; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  const raw: RawSqlite = {
    execute: (sql) => {
      sqlite.exec(sql);
    },
    select: (sql) => sqlite.prepare(sql).all() as never[],
  };
  applyPragmas(raw);
  runMigrations(raw);

  const db = drizzle(sqlite, { schema }) as unknown as Db;
  for (const code of NUTRIENT_CODES) {
    const def = NUTRIENT_DEFS[code];
    db.insert(nutrientDef)
      .values({ code, displayName: def.displayName, unit: def.unit, fdcNutrientIds: JSON.stringify(def.fdcNutrientIds), sortOrder: def.sortOrder })
      .run();
  }
  db.insert(sourceRelease)
    .values({ id: RELEASE_ID, provider: 'fdc', dataset: 'sr_legacy', version: 'test', releasedOn: '2026-01-01', importedAt: 0, isActive: 1 })
    .run();
  return { db, sqlite };
}

export function catalogFood(db: Db, name: string, per100g: Record<string, string>, extra: Partial<CanonicalFood> = {}): string {
  const food: CanonicalFood = {
    kind: 'generic',
    name,
    brand: null,
    gtin: null,
    qualityTier: 'lab',
    sourceRef: name,
    densityGPerMl: null,
    nutrients: Object.entries(per100g).map(([code, amountPer100g]) => ({ code: code as never, amountPer100g, derivation: 'reported' as const })),
    portions: [],
    ...extra,
  };
  return db.transaction((tx) => insertFood(tx, food, { sourceReleaseId: RELEASE_ID, synced: false }));
}

export function customFood(db: Db, name: string, per100g: Record<string, string>): string {
  const { food } = customFoodFromLabel({ name, basis: 'per_100g', values: per100g as never });
  return db.transaction((tx) => insertFood(tx, food, { sourceReleaseId: RELEASE_ID }));
}
