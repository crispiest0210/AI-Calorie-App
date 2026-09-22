import { describe, expect, it } from 'vitest';
import { mapToJson, nutrientCodesOf, parseNutrientMap, scaleMap, scalePer100g } from '../src/nutrient-map';

describe('nutrient maps', () => {
  it('lists reported codes in catalog order', () => {
    expect(nutrientCodesOf({ sodium_mg: '10', energy_kcal: '100' })).toEqual(['energy_kcal', 'sodium_mg']);
  });

  it('scales per-100 g values by grams', () => {
    expect(scalePer100g({ energy_kcal: '130', protein_g: '2.7' }, '150')).toEqual({ energy_kcal: '195', protein_g: '4.05' });
    expect(scalePer100g({ energy_kcal: '130' }, '0')).toEqual({ energy_kcal: '0' });
  });

  it('keeps missing nutrients missing rather than zero', () => {
    const scaled = scalePer100g({ energy_kcal: '100' }, '50');
    expect('fiber_g' in scaled).toBe(false);
  });

  it('scales by a bare factor', () => {
    expect(scaleMap({ fat_g: '3' }, '2')).toEqual({ fat_g: '6' });
  });

  it('parses untrusted JSON columns defensively', () => {
    expect(parseNutrientMap({ energy_kcal: 100, protein_g: '2.5', bogus: '1', fat_g: null, carb_g: {} })).toEqual({
      energy_kcal: '100',
      protein_g: '2.5',
    });
    expect(parseNutrientMap(null)).toEqual({});
    expect(parseNutrientMap('nope')).toEqual({});
    expect(parseNutrientMap({ fiber_g: undefined })).toEqual({});
  });

  it('round-trips to JSON', () => {
    expect(mapToJson({ energy_kcal: '100' })).toEqual({ energy_kcal: '100' });
  });
});
