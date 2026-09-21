/** Water logging (F6). Only water entries count toward the water goal (R10). */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { localDateOf, uuidv7, type LocalDate } from '@nt/core';
import { waterEntry, waterPreset } from '../schema';
import type { Db } from '../db';
import { enqueue } from './outbox';

export const DEFAULT_PRESETS = [
  { label: 'Glass', amountMl: 250 },
  { label: 'Bottle', amountMl: 500 },
  { label: 'Large bottle', amountMl: 750 },
];

export function addWater(db: Db, amountMl: number, at = new Date()): string {
  const now = at.getTime();
  const id = uuidv7(now);
  db.transaction((tx) => {
    tx.insert(waterEntry).values({ id, localDate: localDateOf(at), loggedAt: now, amountMl, updatedAt: now }).run();
    enqueue(tx, 'water_entry', id, 'upsert', now);
  });
  return id;
}

export function deleteWater(db: Db, id: string, now = Date.now()): void {
  db.transaction((tx) => {
    tx.update(waterEntry).set({ deletedAt: now, updatedAt: now }).where(eq(waterEntry.id, id)).run();
    enqueue(tx, 'water_entry', id, 'delete', now);
  });
}

export function waterForDate(db: Db, date: LocalDate) {
  return db
    .select()
    .from(waterEntry)
    .where(and(eq(waterEntry.localDate, date), isNull(waterEntry.deletedAt)))
    .orderBy(asc(waterEntry.loggedAt))
    .all();
}

export function waterTotalMl(db: Db, date: LocalDate): number {
  const row = db.get<{ total: number | null }>(
    sql`select sum(amount_ml) as total from water_entry where local_date = ${date} and deleted_at is null`,
  );
  return row?.total ?? 0;
}

export function waterTotalsForRange(db: Db, from: LocalDate, to: LocalDate): Record<string, number> {
  const rows = db.all<{ local_date: string; total: number }>(
    sql`select local_date, sum(amount_ml) as total from water_entry
        where deleted_at is null and local_date between ${from} and ${to}
        group by local_date`,
  );
  return Object.fromEntries(rows.map((r) => [r.local_date, r.total]));
}

export function presets(db: Db) {
  return db.select().from(waterPreset).where(isNull(waterPreset.deletedAt)).orderBy(asc(waterPreset.position)).all();
}

export function ensureDefaultPresets(db: Db, now = Date.now()): void {
  if (db.select().from(waterPreset).all().length > 0) return;
  db.transaction((tx) => {
    DEFAULT_PRESETS.forEach((preset, position) => {
      const id = uuidv7(now + position);
      tx.insert(waterPreset).values({ id, label: preset.label, amountMl: preset.amountMl, position, updatedAt: now }).run();
      enqueue(tx, 'water_preset', id, 'upsert', now);
    });
  });
}
