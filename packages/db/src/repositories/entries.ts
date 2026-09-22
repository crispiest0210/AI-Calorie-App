/**
 * Log entries. A write never depends on the network (spec 2.11): the row and
 * its outbox record land in one local transaction and the UI re-reads SQLite.
 */
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import {
  localDateOf,
  mapToJson,
  parseNutrientMap,
  tzOffsetMinutesOf,
  uuidv7,
  type AmountUnit,
  type EngineEntry,
  type GramsProvenance,
  type LocalDate,
  type MealSlot,
  type NutrientMap,
  type Num,
} from '@nt/core';
import { logEntry } from '../schema';
import { parseJson, type Db } from '../db';
import { enqueue } from './outbox';

export interface EntryView extends EngineEntry {
  localDate: LocalDate;
  loggedAt: number;
  foodId: string | null;
  foodName: string;
  foodBrand: string | null;
  qualityTier: string | null;
  amountValue: Num;
  amountUnit: AmountUnit;
  portionId: string | null;
  portionLabel: string | null;
  note: string | null;
}

interface RawEntryRow {
  id: string;
  local_date: string;
  logged_at: number;
  meal_slot: string;
  entry_kind: string;
  food_id: string | null;
  amount_value: string;
  amount_unit: string;
  portion_id: string | null;
  grams: string | null;
  grams_provenance: string;
  food_name_snapshot: string;
  nutrients_per_100g: string | null;
  nutrients_absolute: string | null;
  note: string | null;
  food_brand: string | null;
  food_quality_tier: string | null;
  portion_label: string | null;
}

function toView(row: RawEntryRow): EntryView {
  return {
    id: row.id,
    localDate: row.local_date,
    loggedAt: row.logged_at,
    mealSlot: row.meal_slot as MealSlot,
    entryKind: row.entry_kind as EntryView['entryKind'],
    grams: row.grams,
    nutrientsPer100g: row.nutrients_per_100g === null ? null : parseNutrientMap(parseJson(row.nutrients_per_100g, {})),
    nutrientsAbsolute: row.nutrients_absolute === null ? null : parseNutrientMap(parseJson(row.nutrients_absolute, {})),
    gramsProvenance: row.grams_provenance as GramsProvenance,
    foodId: row.food_id,
    foodName: row.food_name_snapshot,
    foodBrand: row.food_brand,
    qualityTier: row.food_quality_tier,
    amountValue: row.amount_value,
    amountUnit: row.amount_unit as AmountUnit,
    portionId: row.portion_id,
    portionLabel: row.portion_label,
    note: row.note,
  };
}

const DAY_QUERY = sql`
  select id, local_date, logged_at, meal_slot, entry_kind, food_id, amount_value, amount_unit,
         portion_id, grams, grams_provenance, food_name_snapshot, nutrients_per_100g,
         nutrients_absolute, note, food_brand, food_quality_tier, portion_label
  from v_day_entry
`;

export function entriesForDate(db: Db, date: LocalDate): EntryView[] {
  return db.all<RawEntryRow>(sql`${DAY_QUERY} where local_date = ${date} order by logged_at asc`).map(toView);
}

export function entriesForRange(db: Db, from: LocalDate, to: LocalDate): EntryView[] {
  return db.all<RawEntryRow>(sql`${DAY_QUERY} where local_date between ${from} and ${to} order by local_date asc, logged_at asc`).map(toView);
}

export function entryById(db: Db, id: string): EntryView | null {
  const row = db.get<RawEntryRow>(sql`${DAY_QUERY} where id = ${id}`);
  return row ? toView(row) : null;
}

export interface LogFoodInput {
  foodId: string;
  foodName: string;
  sourceReleaseId: string | null;
  mealSlot: MealSlot;
  amountValue: Num;
  amountUnit: AmountUnit;
  portionId?: string | null;
  grams: Num;
  gramsProvenance: GramsProvenance;
  nutrientsPer100g: NutrientMap;
  note?: string | null;
  /** Defaults to now; a past day is logged by passing its date and instant. */
  at?: Date;
}

export function logFood(db: Db, input: LogFoodInput): string {
  const at = input.at ?? new Date();
  const now = at.getTime();
  const id = uuidv7(now);
  db.transaction((tx) => {
    tx.insert(logEntry)
      .values({
        id,
        localDate: localDateOf(at),
        loggedAt: now,
        tzOffsetMin: tzOffsetMinutesOf(at),
        mealSlot: input.mealSlot,
        entryKind: 'food',
        foodId: input.foodId,
        amountValue: input.amountValue,
        amountUnit: input.amountUnit,
        portionId: input.portionId ?? null,
        grams: input.grams,
        gramsProvenance: input.gramsProvenance,
        foodNameSnapshot: input.foodName,
        sourceReleaseId: input.sourceReleaseId,
        nutrientsPer100g: JSON.stringify(mapToJson(input.nutrientsPer100g)),
        nutrientsAbsolute: null,
        note: input.note ?? null,
        updatedAt: now,
      })
      .run();
    enqueue(tx, 'log_entry', id, 'upsert', now);
  });
  return id;
}

export interface QuickAddInput {
  mealSlot: MealSlot;
  nutrients: NutrientMap;
  label?: string;
  note?: string | null;
  at?: Date;
}

/** A quick add carries absolute numbers the user typed; there is no food behind it. */
export function logQuickAdd(db: Db, input: QuickAddInput): string {
  const at = input.at ?? new Date();
  const now = at.getTime();
  const id = uuidv7(now);
  db.transaction((tx) => {
    tx.insert(logEntry)
      .values({
        id,
        localDate: localDateOf(at),
        loggedAt: now,
        tzOffsetMin: tzOffsetMinutesOf(at),
        mealSlot: input.mealSlot,
        entryKind: 'quick_add',
        foodId: null,
        amountValue: input.nutrients.energy_kcal ?? '0',
        amountUnit: 'kcal',
        portionId: null,
        grams: null,
        gramsProvenance: 'user',
        foodNameSnapshot: input.label?.trim() || 'Quick add',
        sourceReleaseId: null,
        nutrientsPer100g: null,
        nutrientsAbsolute: JSON.stringify(mapToJson(input.nutrients)),
        note: input.note ?? null,
        updatedAt: now,
      })
      .run();
    enqueue(tx, 'log_entry', id, 'upsert', now);
  });
  return id;
}

export interface UpdateEntryInput {
  mealSlot?: MealSlot;
  amountValue?: Num;
  amountUnit?: AmountUnit;
  portionId?: string | null;
  grams?: Num | null;
  gramsProvenance?: GramsProvenance;
  nutrientsAbsolute?: NutrientMap;
  note?: string | null;
}

export function updateEntry(db: Db, id: string, patch: UpdateEntryInput, now = Date.now()): void {
  db.transaction((tx) => {
    const values: Record<string, unknown> = { updatedAt: now };
    if (patch.mealSlot !== undefined) values.mealSlot = patch.mealSlot;
    if (patch.amountValue !== undefined) values.amountValue = patch.amountValue;
    if (patch.amountUnit !== undefined) values.amountUnit = patch.amountUnit;
    if (patch.portionId !== undefined) values.portionId = patch.portionId;
    if (patch.grams !== undefined) values.grams = patch.grams;
    if (patch.gramsProvenance !== undefined) values.gramsProvenance = patch.gramsProvenance;
    if (patch.nutrientsAbsolute !== undefined) values.nutrientsAbsolute = JSON.stringify(mapToJson(patch.nutrientsAbsolute));
    if (patch.note !== undefined) values.note = patch.note;
    tx.update(logEntry).set(values).where(eq(logEntry.id, id)).run();
    enqueue(tx, 'log_entry', id, 'upsert', now);
  });
}

/** Soft delete: the row becomes a tombstone so other devices learn about it. */
export function deleteEntry(db: Db, id: string, now = Date.now()): void {
  db.transaction((tx) => {
    tx.update(logEntry).set({ deletedAt: now, updatedAt: now }).where(eq(logEntry.id, id)).run();
    enqueue(tx, 'log_entry', id, 'delete', now);
  });
}

/** Undo for the swipe-to-delete toast; the row never left the database. */
export function restoreEntry(db: Db, id: string, now = Date.now()): void {
  db.transaction((tx) => {
    tx.update(logEntry).set({ deletedAt: null, updatedAt: now }).where(eq(logEntry.id, id)).run();
    enqueue(tx, 'log_entry', id, 'upsert', now);
  });
}

/** Copy a meal from another day (F4), re-snapshotting nothing — the old snapshot is the point. */
export function copyMeal(db: Db, from: { date: LocalDate; mealSlot: MealSlot }, to: { date: LocalDate; mealSlot: MealSlot }, at = new Date()): string[] {
  const source = db
    .select()
    .from(logEntry)
    .where(and(eq(logEntry.localDate, from.date), eq(logEntry.mealSlot, from.mealSlot), isNull(logEntry.deletedAt)))
    .orderBy(asc(logEntry.loggedAt))
    .all();

  const ids: string[] = [];
  if (source.length === 0) return ids;
  const now = at.getTime();
  db.transaction((tx) => {
    source.forEach((row, i) => {
      const id = uuidv7(now + i);
      tx.insert(logEntry)
        .values({
          ...row,
          id,
          localDate: to.date,
          mealSlot: to.mealSlot,
          loggedAt: now + i,
          tzOffsetMin: tzOffsetMinutesOf(at),
          serverRev: null,
          updatedAt: now,
          deletedAt: null,
        })
        .run();
      enqueue(tx, 'log_entry', id, 'upsert', now);
      ids.push(id);
    });
  });
  return ids;
}

/** Days in the window that have at least one entry — drives the History list. */
export function loggedDates(db: Db, from: LocalDate, to: LocalDate): LocalDate[] {
  return db
    .all<{ local_date: string }>(
      sql`select distinct local_date from log_entry where deleted_at is null and local_date between ${from} and ${to} order by local_date desc`,
    )
    .map((r) => r.local_date);
}

export { gte, lte };
