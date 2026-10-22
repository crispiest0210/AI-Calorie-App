/**
 * The repository boundary refuses numbers the engine could not read back, and
 * the read side survives the ones that got in anyway (an older build, a sync
 * peer, a hand edit) — one bad row must never make a whole day unreadable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDateOf, totalOf } from '@nt/core';
import { readDay } from '../src/day';
import * as entries from '../src/repositories/entries';
import * as foods from '../src/repositories/foods';
import * as goalsRepo from '../src/repositories/goals';
import * as outbox from '../src/repositories/outbox';
import * as recipes from '../src/repositories/recipes';
import * as water from '../src/repositories/water';
import { ValidationError } from '../src/validate';
import { RELEASE_ID, catalogFood, freshDb } from './helpers';

const RICE = { energy_kcal: '123', protein_g: '2.74', carb_g: '25.6', fat_g: '0.97' };
const AT = new Date('2026-09-20T12:00:00');
const DAY = localDateOf(AT);

function seeded() {
  const { db, sqlite } = freshDb();
  const rice = catalogFood(db, 'Rice', RICE);
  return { db, sqlite, rice };
}

function riceInput(rice: string, overrides: Partial<entries.LogFoodInput> = {}): entries.LogFoodInput {
  return {
    foodId: rice,
    foodName: 'Rice',
    sourceReleaseId: RELEASE_ID,
    mealSlot: 'lunch',
    amountValue: '150',
    amountUnit: 'g',
    grams: '150',
    gramsProvenance: 'user',
    nutrientsPer100g: RICE,
    at: AT,
    ...overrides,
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('entry writes', () => {
  it('rejects garbage and non-positive grams before anything is written', () => {
    const { db, rice } = seeded();
    for (const grams of ['', '.', '1.2.3', 'abc', '-5', '0']) {
      expect(() => entries.logFood(db, riceInput(rice, { grams }))).toThrow(ValidationError);
    }
    expect(() => entries.logFood(db, riceInput(rice, { amountValue: '-1' }))).toThrow(ValidationError);
    expect(entries.entriesForDate(db, DAY)).toEqual([]);
    expect(outbox.pending(db)).toEqual([]);
  });

  it('rejects a snapshot with a value the engine cannot read', () => {
    const { db, rice } = seeded();
    expect(() => entries.logFood(db, riceInput(rice, { nutrientsPer100g: { energy_kcal: '' } }))).toThrow(/nutrientsPer100g.energy_kcal/);
    expect(() => entries.logFood(db, riceInput(rice, { nutrientsPer100g: { bogus_g: '1' } as never }))).toThrow(ValidationError);
  });

  it('stores canonical decimal strings', () => {
    const { db, rice } = seeded();
    const id = entries.logFood(db, riceInput(rice, { grams: '150.50', amountValue: '0150.5' }));
    const entry = entries.entryById(db, id)!;
    expect(entry.grams).toBe('150.5');
    expect(entry.amountValue).toBe('150.5');
  });

  it('rejects a quick add or an edit with a blank or negative value', () => {
    const { db } = seeded();
    expect(() => entries.logQuickAdd(db, { mealSlot: 'snack', nutrients: { energy_kcal: '' }, at: AT })).toThrow(ValidationError);
    expect(() => entries.logQuickAdd(db, { mealSlot: 'snack', nutrients: { energy_kcal: '-200' }, at: AT })).toThrow(ValidationError);

    const id = entries.logQuickAdd(db, { mealSlot: 'snack', nutrients: { energy_kcal: '200' }, at: AT });
    expect(() => entries.updateEntry(db, id, { amountValue: '', nutrientsAbsolute: { energy_kcal: '' } })).toThrow(ValidationError);
    expect(() => entries.updateEntry(db, id, { grams: '0' })).toThrow(ValidationError);
    expect(entries.entryById(db, id)!.nutrientsAbsolute).toEqual({ energy_kcal: '200' });
  });
});

describe('water writes', () => {
  it('accepts whole millilitres from 1 to 5000 only', () => {
    const { db } = seeded();
    for (const ml of [0, -250, 5001, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => water.addWater(db, ml, AT)).toThrow(ValidationError);
    }
    water.addWater(db, 1, AT);
    water.addWater(db, 5000, AT);
    expect(water.waterTotalMl(db, DAY)).toBe(5001);
  });
});

describe('goal writes', () => {
  const energy = (value: string | null) => ({ nutrientCode: 'energy_kcal' as const, kind: 'target' as const, value, valueLow: null, valueHigh: null, basis: 'absolute' as const });

  it('rejects blank, negative and inconsistent targets', () => {
    const { db } = seeded();
    expect(() => goalsRepo.saveGoals(db, { waterTargetMl: null, targets: [energy(null)] })).toThrow(/required/);
    expect(() => goalsRepo.saveGoals(db, { waterTargetMl: null, targets: [energy('')] })).toThrow(ValidationError);
    expect(() => goalsRepo.saveGoals(db, { waterTargetMl: null, targets: [energy('-1')] })).toThrow(ValidationError);
    expect(() =>
      goalsRepo.saveGoals(db, { waterTargetMl: null, targets: [{ ...energy('2000'), valueHigh: '2500' }] }),
    ).toThrow(/must be empty/);
    expect(() =>
      goalsRepo.saveGoals(db, {
        waterTargetMl: null,
        targets: [{ nutrientCode: 'protein_g', kind: 'target', value: '120', basis: 'pct_energy' }],
      }),
    ).toThrow(/100 percent/);
    expect(() =>
      goalsRepo.saveGoals(db, {
        waterTargetMl: null,
        targets: [{ nutrientCode: 'fiber_g', kind: 'range', valueLow: '40', valueHigh: '20', basis: 'absolute' }],
      }),
    ).toThrow(/exceed/);
    expect(() => goalsRepo.saveGoals(db, { waterTargetMl: null, targets: [energy('2000'), energy('2100')] })).toThrow(/more than one/);
    expect(() => goalsRepo.saveGoals(db, { waterTargetMl: 0, targets: [] })).toThrow(ValidationError);
    expect(() => goalsRepo.saveGoals(db, { waterTargetMl: 2500.5, targets: [] })).toThrow(ValidationError);
    expect(goalsRepo.allGoalProfiles(db)).toEqual([]);
  });

  it('saves only the targets given, canonicalized', () => {
    const { db } = seeded();
    goalsRepo.saveGoals(db, { waterTargetMl: 2500, targets: [energy('2100.0')] }, AT);
    const profile = goalsRepo.goalsForDate(db, DAY)!;
    expect(profile.targets).toEqual([{ ...energy('2100') }]);
    expect(profile.waterTargetMl).toBe(2500);
  });
});

describe('recipe writes', () => {
  it('rejects non-positive servings, cooked weight and ingredient grams', () => {
    const { db, rice } = seeded();
    expect(() => recipes.createRecipe(db, { name: 'Bowl', servings: '0', sourceReleaseId: RELEASE_ID })).toThrow(ValidationError);
    const id = recipes.createRecipe(db, { name: 'Bowl', servings: '2', sourceReleaseId: RELEASE_ID });
    expect(() => recipes.updateRecipe(db, id, { servings: '.' })).toThrow(ValidationError);
    expect(() => recipes.updateRecipe(db, id, { totalCookedGrams: '-10' })).toThrow(ValidationError);
    expect(() => recipes.addIngredient(db, id, rice, '1.2.3')).toThrow(ValidationError);
    const ingredient = recipes.addIngredient(db, id, rice, '200');
    expect(() => recipes.updateIngredient(db, id, ingredient, '0')).toThrow(ValidationError);
    recipes.updateRecipe(db, id, { totalCookedGrams: null });
    expect(recipes.readRecipe(db, id)!.ingredients[0]!.grams).toBe('200');
  });
});

describe('reading a malformed stored row', () => {
  it('keeps readDay working when a quick add holds a blank value', () => {
    const { db, sqlite, rice } = seeded();
    entries.logFood(db, riceInput(rice));
    const quick = entries.logQuickAdd(db, { mealSlot: 'snack', nutrients: { energy_kcal: '200', protein_g: '10' }, at: AT });
    // What the old entry screen wrote when the energy field was cleared.
    sqlite.prepare(`update log_entry set nutrients_absolute = '{"energy_kcal":"","protein_g":"10"}', amount_value = '' where id = ?`).run(quick);

    const day = readDay(db, DAY);
    expect(day.entries).toHaveLength(2);
    // The rice still counts; energy is marked incomplete rather than thrown on or zeroed.
    expect(day.totals.total.values.energy_kcal).toBe('184.5');
    expect(day.totals.total.incomplete).toContain('energy_kcal');
    expect(day.totals.total.values.protein_g).toBe('14.11');
    expect(entries.entryById(db, quick)!.amountValue).toBe('0');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`log_entry.nutrients_absolute for ${quick}`));
  });

  it('reads a food entry with unreadable grams as contributing nothing', () => {
    const { db, sqlite, rice } = seeded();
    const id = entries.logFood(db, riceInput(rice));
    sqlite.prepare(`update log_entry set grams = 'abc', amount_value = '1.2.3' where id = ?`).run(id);
    const day = readDay(db, DAY);
    expect(day.entries[0]!.grams).toBeNull();
    expect(totalOf(day.totals.total, 'energy_kcal')).toBeNull();
  });

  it('ignores an unreadable goal target and catalog value instead of crashing', () => {
    const { db, sqlite, rice } = seeded();
    goalsRepo.saveGoals(db, { waterTargetMl: null, targets: [{ nutrientCode: 'energy_kcal', kind: 'target', value: '2000', basis: 'absolute' }] }, AT);
    sqlite.prepare(`update goal_target set value = 'x'`).run();
    sqlite.prepare(`update food_nutrient set amount_per_100g = '' where food_id = ? and nutrient_code = 'fat_g'`).run(rice);

    expect(readDay(db, DAY).goals!.targets).toEqual([]);
    expect(foods.foodDetail(db, rice)!.nutrientsPer100g.fat_g).toBeUndefined();
  });

  it('reads a recipe whose stored servings or grams went bad', () => {
    const { db, sqlite, rice } = seeded();
    const id = recipes.createRecipe(db, { name: 'Bowl', servings: '2', sourceReleaseId: RELEASE_ID });
    recipes.addIngredient(db, id, rice, '200');
    sqlite.prepare(`update recipe_meta set servings = '0', total_cooked_grams = 'x'`).run();
    const view = recipes.readRecipe(db, id)!;
    expect(view.servings).toBe('1');
    expect(view.totalCookedGrams).toBeNull();

    sqlite.prepare(`update recipe_ingredient set grams = '-3'`).run();
    expect(recipes.readRecipe(db, id)!.ingredients).toEqual([]);
  });
});
