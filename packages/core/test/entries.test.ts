import { describe, expect, it } from 'vitest';
import { entryNutrients, isEstimated, type EngineEntry } from '../src/entries';

const base: EngineEntry = {
  id: 'e1',
  mealSlot: 'lunch',
  entryKind: 'food',
  grams: '200',
  nutrientsPer100g: { energy_kcal: '50' },
  nutrientsAbsolute: null,
};

describe('entryNutrients', () => {
  it('scales the per-100g snapshot by grams for food entries', () => {
    expect(entryNutrients(base)).toEqual({ energy_kcal: '100' });
  });

  it('returns the absolute values for quick_add entries', () => {
    const entry: EngineEntry = {
      ...base,
      entryKind: 'quick_add',
      grams: null,
      nutrientsPer100g: null,
      nutrientsAbsolute: { energy_kcal: '320' },
    };
    expect(entryNutrients(entry)).toEqual({ energy_kcal: '320' });
  });

  it('contributes nothing when a food entry lacks grams or a snapshot', () => {
    expect(entryNutrients({ ...base, grams: null })).toEqual({});
    expect(entryNutrients({ ...base, nutrientsPer100g: null })).toEqual({});
    expect(entryNutrients({ ...base, entryKind: 'quick_add', nutrientsAbsolute: null })).toEqual({});
  });
});

describe('isEstimated', () => {
  it('is true only for AI-estimated grams', () => {
    expect(isEstimated({ ...base, gramsProvenance: 'ai_estimate' })).toBe(true);
    expect(isEstimated({ ...base, gramsProvenance: 'user' })).toBe(false);
    expect(isEstimated(base)).toBe(false);
  });
});
