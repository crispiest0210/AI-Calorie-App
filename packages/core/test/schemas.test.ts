import { describe, expect, it } from 'vitest';
import { goalProfileSchema, logEntrySchema, numericString, waterEntrySchema, waterPresetSchema, foodSchema, foodPortionSchema, localDate, nutrientMap } from '../src/schemas';

const entry = {
  id: 'e1',
  localDate: '2026-09-20',
  loggedAt: 1_789_000_000_000,
  tzOffsetMin: -420,
  mealSlot: 'lunch',
  entryKind: 'food',
  foodId: 'f1',
  amountValue: '150',
  amountUnit: 'g',
  portionId: null,
  grams: '150',
  gramsProvenance: 'user',
  foodNameSnapshot: 'Rice, brown, cooked',
  sourceReleaseId: 'r1',
  nutrientsPer100g: { energy_kcal: '123' },
  nutrientsAbsolute: null,
  note: null,
};

describe('shared schemas', () => {
  it('accepts decimal strings and rejects floats and junk', () => {
    expect(numericString.safeParse('12.5').success).toBe(true);
    expect(numericString.safeParse('-3').success).toBe(true);
    expect(numericString.safeParse('1e3').success).toBe(false);
    expect(numericString.safeParse('abc').success).toBe(false);
  });

  it('validates local dates and nutrient maps', () => {
    expect(localDate.safeParse('2026-09-20').success).toBe(true);
    expect(localDate.safeParse('2026-13-01').success).toBe(false);
    expect(nutrientMap.safeParse({ energy_kcal: '1' }).success).toBe(true);
    expect(nutrientMap.safeParse({ bogus: '1' }).success).toBe(false);
  });

  it('accepts a well-formed food entry', () => {
    expect(logEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('requires food entries to carry a food, grams and a snapshot', () => {
    expect(logEntrySchema.safeParse({ ...entry, foodId: null }).success).toBe(false);
    expect(logEntrySchema.safeParse({ ...entry, grams: null }).success).toBe(false);
    expect(logEntrySchema.safeParse({ ...entry, nutrientsPer100g: null }).success).toBe(false);
  });

  it('requires quick adds to carry absolute nutrients', () => {
    const quick = { ...entry, entryKind: 'quick_add', foodId: null, grams: null, nutrientsPer100g: null, amountUnit: 'kcal', amountValue: '250' };
    expect(logEntrySchema.safeParse({ ...quick, nutrientsAbsolute: { energy_kcal: '250' } }).success).toBe(true);
    expect(logEntrySchema.safeParse(quick).success).toBe(false);
  });

  it('validates goals, water and food rows', () => {
    expect(
      goalProfileSchema.safeParse({
        id: 'g1',
        effectiveFrom: '2026-09-01',
        waterTargetMl: 2500,
        targets: [{ nutrientCode: 'energy_kcal', kind: 'target', value: '2100', valueLow: null, valueHigh: null, basis: 'absolute' }],
      }).success,
    ).toBe(true);
    expect(waterEntrySchema.safeParse({ id: 'w1', localDate: '2026-09-20', loggedAt: 1, amountMl: 250 }).success).toBe(true);
    expect(waterEntrySchema.safeParse({ id: 'w1', localDate: '2026-09-20', loggedAt: 1, amountMl: 9000 }).success).toBe(false);
    expect(waterPresetSchema.safeParse({ id: 'p1', label: 'Glass', amountMl: 250, position: 0 }).success).toBe(true);
    expect(
      foodSchema.safeParse({ id: 'f1', kind: 'generic', name: 'Rice', brand: null, gtin: null, qualityTier: 'lab', sourceRef: '169704', sourceReleaseId: 'r1', densityGPerMl: null }).success,
    ).toBe(true);
    expect(foodPortionSchema.safeParse({ id: 'p1', foodId: 'f1', label: '1 cup', gramWeight: '202', source: 'fdc' }).success).toBe(true);
  });
});
