import { describe, expect, it } from 'vitest';
import { CustomFoodError, customFoodFromLabel } from '../src/custom-food';

describe('customFoodFromLabel', () => {
  it('converts per-serving label values to per 100 g and keeps the serving', () => {
    const { food } = customFoodFromLabel({
      name: '  Protein bar  ',
      brand: ' Acme ',
      basis: 'per_serving',
      servingGrams: 50,
      servingLabel: '1 bar',
      values: { energy_kcal: '200', protein_g: '20' },
      gtin: '049000028911',
    });
    expect(food).toMatchObject({ kind: 'custom', qualityTier: 'user', name: 'Protein bar', brand: 'Acme', gtin: '00049000028911' });
    expect(food.nutrients).toEqual([
      { code: 'energy_kcal', amountPer100g: '400', derivation: 'converted' },
      { code: 'protein_g', amountPer100g: '40', derivation: 'converted' },
    ]);
    expect(food.portions).toEqual([{ label: '1 bar', gramWeight: '50', source: 'user' }]);
  });

  it('takes per-100 g values as reported', () => {
    const { food } = customFoodFromLabel({ name: 'Flour', basis: 'per_100g', values: { energy_kcal: '364' } });
    expect(food.nutrients[0]!.derivation).toBe('reported');
    expect(food.portions).toEqual([]);
    expect(food.brand).toBeNull();
    expect(food.sourceRef).toBe('user');
  });

  it('generates a serving label when none is typed', () => {
    const { food } = customFoodFromLabel({ name: 'Bar', basis: 'per_serving', servingGrams: '40', values: { energy_kcal: '150' } });
    expect(food.portions[0]!.label).toBe('1 serving (40 g)');
  });

  it('reports quarantine reasons without throwing, so the user can fix the number', () => {
    const { quarantineReasons } = customFoodFromLabel({ name: 'Typo', basis: 'per_100g', values: { energy_kcal: '9000' } });
    expect(quarantineReasons[0]).toContain('exceeds 900');
  });

  it('refuses input it cannot canonicalize', () => {
    expect(() => customFoodFromLabel({ name: ' ', basis: 'per_100g', values: { energy_kcal: '1' } })).toThrow(CustomFoodError);
    expect(() => customFoodFromLabel({ name: 'x', basis: 'per_100g', values: {} })).toThrow(CustomFoodError);
    expect(() => customFoodFromLabel({ name: 'x', basis: 'per_serving', values: { energy_kcal: '1' } })).toThrow(CustomFoodError);
    expect(() => customFoodFromLabel({ name: 'x', basis: 'per_serving', servingGrams: 0, values: { energy_kcal: '1' } })).toThrow(CustomFoodError);
    expect(() => customFoodFromLabel({ name: 'x', basis: 'per_serving', servingGrams: null, values: { energy_kcal: '1' } })).toThrow(CustomFoodError);
  });
});
