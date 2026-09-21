import { describe, expect, it } from 'vitest';
import { customFoodFromLabel, dayTotals, localDateOf, totalOf } from '@nt/core';
import { readDay } from '../src/day';
import * as entries from '../src/repositories/entries';
import * as foods from '../src/repositories/foods';
import * as goalsRepo from '../src/repositories/goals';
import * as outbox from '../src/repositories/outbox';
import * as water from '../src/repositories/water';
import { insertFood } from '../src/repositories/foods';
import { RELEASE_ID, catalogFood, customFood, freshDb } from './helpers';

const RICE = { energy_kcal: '123', protein_g: '2.74', carb_g: '25.6', fat_g: '0.97', fiber_g: '1.6', sodium_mg: '4' };
const CHICKEN = { energy_kcal: '165', protein_g: '31', carb_g: '0', fat_g: '3.6', fiber_g: '0', sodium_mg: '74' };

function seeded() {
  const { db, sqlite } = freshDb();
  const rice = catalogFood(db, 'Rice, brown, long-grain, cooked', RICE);
  const chicken = catalogFood(db, 'Chicken, breast, roasted', CHICKEN);
  return { db, sqlite, rice, chicken };
}

const logRice = (db: ReturnType<typeof seeded>['db'], rice: string, grams: string, at?: Date, mealSlot: 'breakfast' | 'lunch' | 'dinner' | 'snack' = 'lunch') =>
  entries.logFood(db, {
    foodId: rice,
    foodName: 'Rice, brown, long-grain, cooked',
    sourceReleaseId: RELEASE_ID,
    mealSlot,
    amountValue: grams,
    amountUnit: 'g',
    grams,
    gramsProvenance: 'user',
    nutrientsPer100g: RICE,
    ...(at ? { at } : {}),
  });

describe('food search', () => {
  it('finds foods by prefix as the user types', () => {
    const { db } = seeded();
    expect(foods.searchFoods(db, 'ric').map((f) => f.name)).toContain('Rice, brown, long-grain, cooked');
    expect(foods.searchFoods(db, 'chick bre').map((f) => f.name)).toEqual(['Chicken, breast, roasted']);
    expect(foods.searchFoods(db, 'zzz')).toEqual([]);
    expect(foods.searchFoods(db, '   ')).toEqual([]);
  });

  it('survives text that would otherwise be FTS syntax', () => {
    const { db } = seeded();
    expect(() => foods.searchFoods(db, 'rice OR "')).not.toThrow();
    expect(() => foods.searchFoods(db, 'rice NEAR/2 (')).not.toThrow();
    expect(foods.toFtsQuery('rice cooked')).toBe('"rice"* AND "cooked"*');
    expect(foods.toFtsQuery('  ')).toBeNull();
  });

  it('puts the user’s own foods first', () => {
    const { db } = seeded();
    customFood(db, 'Rice pudding, mine', { energy_kcal: '130' });
    expect(foods.searchFoods(db, 'rice')[0]!.kind).toBe('custom');
  });

  it('collapses the same food appearing in two USDA datasets, keeping the better tier', () => {
    const { db } = freshDb();
    catalogFood(db, 'Rice noodles, cooked', { energy_kcal: '107' }, { qualityTier: 'survey', sourceRef: 'fndds' });
    catalogFood(db, 'Rice noodles, cooked', { energy_kcal: '108' }, { qualityTier: 'lab', sourceRef: 'sr' });
    const results = foods.searchFoods(db, 'rice');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ qualityTier: 'lab', energyPer100g: '108' });
  });

  it('never collapses a custom food into a catalog food of the same name', () => {
    const { db } = freshDb();
    catalogFood(db, 'Granola', { energy_kcal: '450' });
    customFood(db, 'Granola', { energy_kcal: '480' });
    const results = foods.searchFoods(db, 'granola');
    expect(results).toHaveLength(2);
    expect(results[0]!.kind).toBe('custom');
  });

  it('ranks the plain food above one that merely starts with the same word', () => {
    const { db } = freshDb();
    catalogFood(db, 'Rice noodles, cooked', { energy_kcal: '108' });
    catalogFood(db, 'Rice, cooked, NFS', { energy_kcal: '129' }, { qualityTier: 'survey' });
    catalogFood(db, 'Rice, white, cooked, glutinous', { energy_kcal: '96' }, { qualityTier: 'survey' });
    const names = foods.searchFoods(db, 'rice').map((f) => f.name);
    expect(names[0]).toBe('Rice, cooked, NFS');
    expect(names.indexOf('Rice noodles, cooked')).toBeGreaterThan(names.indexOf('Rice, white, cooked, glutinous'));
  });

  it('prefers the shorter name when nothing else separates two foods', () => {
    const { db } = freshDb();
    catalogFood(db, 'Oats, whole grain, rolled, old fashioned', { energy_kcal: '379' });
    catalogFood(db, 'Oats, raw', { energy_kcal: '389' });
    expect(foods.searchFoods(db, 'oats')[0]!.name).toBe('Oats, raw');
  });

  it('carries energy per 100 g into the result row', () => {
    const { db, rice } = seeded();
    expect(foods.searchFoods(db, 'rice').find((f) => f.id === rice)!.energyPer100g).toBe('123');
  });

  it('hides deleted foods', () => {
    const { db, rice } = seeded();
    foods.softDeleteFood(db, rice);
    expect(foods.searchFoods(db, 'rice')).toEqual([]);
    expect(foods.foodDetail(db, rice)).toBeNull();
  });
});

describe('food detail', () => {
  it('returns nutrients and portions together', () => {
    const { db } = freshDb();
    const { food } = customFoodFromLabel({ name: 'Protein bar', basis: 'per_serving', servingGrams: 50, servingLabel: '1 bar', values: { energy_kcal: '200', protein_g: '20' } });
    const id = db.transaction((tx) => insertFood(tx, food, { sourceReleaseId: RELEASE_ID }));
    const detail = foods.foodDetail(db, id)!;
    expect(detail.nutrientsPer100g).toEqual({ energy_kcal: '400', protein_g: '40' });
    expect(detail.portions).toEqual([{ id: expect.any(String), label: '1 bar', gramWeight: '50', source: 'user' }]);
    expect(detail.qualityTier).toBe('user');
  });

  it('records a custom food in the outbox but never a catalog food', () => {
    const { db } = freshDb();
    catalogFood(db, 'Rice', RICE);
    expect(outbox.pendingCount(db)).toBe(0);
    customFood(db, 'My granola', { energy_kcal: '450' });
    expect(outbox.pending(db).map((r) => [r.tableName, r.op])).toEqual([['food', 'upsert']]);
  });
});

describe('logging', () => {
  it('writes an entry and its outbox record in one transaction', () => {
    const { db, rice } = seeded();
    const id = logRice(db, rice, '150');
    expect(entries.entriesForDate(db, localDateOf()).map((e) => e.id)).toEqual([id]);
    expect(outbox.pending(db).map((r) => r.rowId)).toEqual([id]);
  });

  it('computes the day total from the snapshot, not the catalog', () => {
    const { db, rice } = seeded();
    logRice(db, rice, '150');
    const day = readDay(db, localDateOf());
    expect(totalOf(day.totals.total, 'energy_kcal')).toBe('184.5');
    expect(day.totals.byMeal.lunch.values.protein_g).toBe('4.11');
  });

  it('keeps a past day fixed when the catalog food changes', () => {
    const { db, sqlite, rice } = seeded();
    logRice(db, rice, '100');
    sqlite.prepare("update food_nutrient set amount_per_100g = '999' where food_id = ? and nutrient_code = 'energy_kcal'").run(rice);
    const day = readDay(db, localDateOf());
    expect(totalOf(day.totals.total, 'energy_kcal')).toBe('123');
  });

  it('logs a quick add with absolute numbers', () => {
    const { db } = freshDb();
    entries.logQuickAdd(db, { mealSlot: 'snack', nutrients: { energy_kcal: '250' }, label: 'Cafeteria lunch' });
    const day = readDay(db, localDateOf());
    expect(day.entries[0]).toMatchObject({ entryKind: 'quick_add', foodName: 'Cafeteria lunch', amountUnit: 'kcal' });
    expect(totalOf(day.totals.total, 'energy_kcal')).toBe('250');
    expect(totalOf(day.totals.total, 'protein_g')).toBeNull();
  });

  it('names an unlabelled quick add', () => {
    const { db } = freshDb();
    entries.logQuickAdd(db, { mealSlot: 'snack', nutrients: { energy_kcal: '100' }, label: '  ' });
    expect(entries.entriesForDate(db, localDateOf())[0]!.foodName).toBe('Quick add');
  });

  it('edits an entry and re-queues it', () => {
    const { db, rice } = seeded();
    const id = logRice(db, rice, '150');
    entries.updateEntry(db, id, { grams: '200', amountValue: '200', mealSlot: 'dinner', note: 'second helping' });
    const entry = entries.entryById(db, id)!;
    expect(entry).toMatchObject({ grams: '200', mealSlot: 'dinner', note: 'second helping' });
    expect(outbox.pending(db)).toHaveLength(2);
  });

  it('leaves untouched fields alone on a partial edit', () => {
    const { db, rice } = seeded();
    const id = logRice(db, rice, '150');
    entries.updateEntry(db, id, { note: 'x' });
    expect(entries.entryById(db, id)).toMatchObject({ grams: '150', mealSlot: 'lunch', amountUnit: 'g' });
  });

  it('soft-deletes with undo, leaving a tombstone for sync', () => {
    const { db, sqlite, rice } = seeded();
    const id = logRice(db, rice, '150');
    entries.deleteEntry(db, id);
    expect(entries.entriesForDate(db, localDateOf())).toEqual([]);
    expect(sqlite.prepare('select count(*) as n from log_entry').get()).toEqual({ n: 1 });
    expect(outbox.pending(db).at(-1)!.op).toBe('delete');

    entries.restoreEntry(db, id);
    expect(entries.entriesForDate(db, localDateOf())).toHaveLength(1);
  });

  it('copies a meal from another day, keeping each snapshot', () => {
    const { db, rice, chicken } = seeded();
    const yesterday = new Date(Date.now() - 86_400_000);
    logRice(db, rice, '150', yesterday, 'breakfast');
    entries.logFood(db, {
      foodId: chicken,
      foodName: 'Chicken, breast, roasted',
      sourceReleaseId: RELEASE_ID,
      mealSlot: 'breakfast',
      amountValue: '100',
      amountUnit: 'g',
      grams: '100',
      gramsProvenance: 'user',
      nutrientsPer100g: CHICKEN,
      at: yesterday,
    });

    const from = localDateOf(yesterday);
    const today = localDateOf();
    const copied = entries.copyMeal(db, { date: from, mealSlot: 'breakfast' }, { date: today, mealSlot: 'breakfast' });
    expect(copied).toHaveLength(2);
    const day = readDay(db, today);
    expect(day.entries.map((e) => e.foodName)).toEqual(['Rice, brown, long-grain, cooked', 'Chicken, breast, roasted']);
    expect(totalOf(day.totals.byMeal.breakfast, 'energy_kcal')).toBe('349.5');
  });

  it('copies nothing when the source meal is empty', () => {
    const { db } = freshDb();
    expect(entries.copyMeal(db, { date: '2026-01-01', mealSlot: 'lunch' }, { date: '2026-01-02', mealSlot: 'lunch' })).toEqual([]);
  });

  it('lists recents and frequents for the Log sheet', () => {
    const { db, rice, chicken } = seeded();
    logRice(db, rice, '150', new Date(Date.now() - 3000));
    logRice(db, rice, '120', new Date(Date.now() - 2000));
    entries.logFood(db, {
      foodId: chicken,
      foodName: 'Chicken, breast, roasted',
      sourceReleaseId: RELEASE_ID,
      mealSlot: 'dinner',
      amountValue: '100',
      amountUnit: 'g',
      grams: '100',
      gramsProvenance: 'user',
      nutrientsPer100g: CHICKEN,
    });
    expect(foods.recentFoods(db).map((f) => f.id)).toEqual([chicken, rice]);
    expect(foods.frequentFoods(db, 0).map((f) => f.id)).toEqual([rice, chicken]);
    expect(foods.lastAmountFor(db, rice)).toMatchObject({ amountValue: '120', amountUnit: 'g' });
    expect(foods.lastAmountFor(db, 'nope')).toBeNull();
  });

  it('lists the user’s own foods and the days that have entries', () => {
    const { db, rice } = seeded();
    customFood(db, 'My granola', { energy_kcal: '450' });
    expect(foods.myFoods(db).map((f) => f.name)).toEqual(['My granola']);
    logRice(db, rice, '150', new Date(Date.now() - 86_400_000));
    logRice(db, rice, '150');
    expect(entries.loggedDates(db, '2000-01-01', '2999-01-01')).toHaveLength(2);
  });

  it('reads a range for the history charts', () => {
    const { db, rice } = seeded();
    logRice(db, rice, '150', new Date(Date.now() - 86_400_000));
    logRice(db, rice, '100');
    const rows = entries.entriesForRange(db, '2000-01-01', '2999-01-01');
    expect(rows).toHaveLength(2);
    expect(dayTotals(rows).total.values.energy_kcal).toBe('307.5');
  });
});

describe('water', () => {
  it('adds, totals and removes water', () => {
    const { db } = freshDb();
    const today = localDateOf();
    water.addWater(db, 250);
    const second = water.addWater(db, 500);
    expect(water.waterTotalMl(db, today)).toBe(750);
    expect(water.waterForDate(db, today)).toHaveLength(2);

    water.deleteWater(db, second);
    expect(water.waterTotalMl(db, today)).toBe(250);
    expect(water.waterTotalsForRange(db, '2000-01-01', '2999-01-01')[today]).toBe(250);
  });

  it('reports zero for a day with no water', () => {
    const { db } = freshDb();
    expect(water.waterTotalMl(db, '2020-01-01')).toBe(0);
  });

  it('seeds quick-add presets once', () => {
    const { db } = freshDb();
    water.ensureDefaultPresets(db);
    water.ensureDefaultPresets(db);
    expect(water.presets(db).map((p) => p.amountMl)).toEqual([250, 500, 750]);
  });
});

describe('goals', () => {
  const targets = [
    { nutrientCode: 'energy_kcal' as const, kind: 'target' as const, value: '2100', valueLow: null, valueHigh: null, basis: 'absolute' as const },
    { nutrientCode: 'protein_g' as const, kind: 'target' as const, value: '25', valueLow: null, valueHigh: null, basis: 'pct_energy' as const },
  ];

  it('versions goals by date so past days keep their targets', () => {
    const { db } = freshDb();
    goalsRepo.saveGoals(db, { waterTargetMl: 2500, targets, effectiveFrom: '2026-01-01' });
    goalsRepo.saveGoals(db, { waterTargetMl: 3000, targets, effectiveFrom: '2026-06-01' });

    expect(goalsRepo.goalsForDate(db, '2026-03-01')!.waterTargetMl).toBe(2500);
    expect(goalsRepo.goalsForDate(db, '2026-09-01')!.waterTargetMl).toBe(3000);
    expect(goalsRepo.goalsForDate(db, '2025-12-31')).toBeNull();
    expect(goalsRepo.allGoalProfiles(db)).toHaveLength(2);
  });

  it('replaces the targets of a profile saved again the same day', () => {
    const { db } = freshDb();
    goalsRepo.saveGoals(db, { waterTargetMl: 2500, targets, effectiveFrom: '2026-01-01' });
    goalsRepo.saveGoals(db, { waterTargetMl: 2000, targets: [targets[0]!], effectiveFrom: '2026-01-01' });
    const profile = goalsRepo.goalsForDate(db, '2026-01-01')!;
    expect(profile.waterTargetMl).toBe(2000);
    expect(profile.targets).toHaveLength(1);
    expect(goalsRepo.allGoalProfiles(db)).toHaveLength(1);
  });

  it('resolves percent-of-energy targets when a day is read', () => {
    const { db, rice } = seeded();
    goalsRepo.saveGoals(db, { waterTargetMl: 2500, targets, effectiveFrom: '2000-01-01' });
    logRice(db, rice, '150');
    const day = readDay(db, localDateOf());
    const protein = day.progress.find((p) => p.nutrientCode === 'protein_g')!;
    expect(protein.reference).toBe('131.25');
    expect(protein.derivedFromPercent).toBe(true);
    expect(day.water.targetMl).toBe(2500);
  });

  it('reads a day with no goals at all', () => {
    const { db } = freshDb();
    const day = readDay(db, '2026-09-20');
    expect(day.progress).toEqual([]);
    expect(day.water).toMatchObject({ consumedMl: 0, targetMl: null });
  });
});

describe('outbox', () => {
  it('drains and clears', () => {
    const { db, rice } = seeded();
    const id = logRice(db, rice, '150');
    const rows = outbox.pending(db);
    expect(rows).toHaveLength(1);
    outbox.clear(db, rows.map((r) => r.seq));
    expect(outbox.pendingCount(db)).toBe(0);
    outbox.clear(db, []);

    logRice(db, rice, '100');
    outbox.clearFor(db, 'log_entry', id);
    expect(outbox.pendingCount(db)).toBe(1);
  });
});
