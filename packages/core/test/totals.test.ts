import { describe, expect, it } from 'vitest';
import { entryNutrients, isEstimated, type EngineEntry } from '../src/entries';
import { EMPTY_TOTALS, ALL_CODES, dayTotals, macroEnergyShares, sumNutrients, totalOf, totalsForEntries } from '../src/totals';

const oats: EngineEntry = {
  id: 'e1',
  mealSlot: 'breakfast',
  entryKind: 'food',
  grams: '50',
  nutrientsPer100g: { energy_kcal: '389', protein_g: '16.9', carb_g: '66.3', fat_g: '6.9', fiber_g: '10.6', sodium_mg: '2' },
  nutrientsAbsolute: null,
  gramsProvenance: 'user',
};

const quickAdd: EngineEntry = {
  id: 'e2',
  mealSlot: 'snack',
  entryKind: 'quick_add',
  grams: null,
  nutrientsPer100g: null,
  nutrientsAbsolute: { energy_kcal: '150' },
  gramsProvenance: 'user',
};

describe('entry nutrients', () => {
  it('scales a food entry by its grams', () => {
    expect(entryNutrients(oats)).toEqual({
      energy_kcal: '194.5',
      protein_g: '8.45',
      carb_g: '33.15',
      fat_g: '3.45',
      fiber_g: '5.3',
      sodium_mg: '1',
    });
  });

  it('uses absolute values for a quick add', () => {
    expect(entryNutrients(quickAdd)).toEqual({ energy_kcal: '150' });
    expect(entryNutrients({ ...quickAdd, nutrientsAbsolute: null })).toEqual({});
  });

  it('contributes nothing when a food entry lost its snapshot', () => {
    expect(entryNutrients({ ...oats, grams: null })).toEqual({});
    expect(entryNutrients({ ...oats, nutrientsPer100g: null })).toEqual({});
  });

  it('flags AI-estimated amounts until they are edited', () => {
    expect(isEstimated({ ...oats, gramsProvenance: 'ai_estimate' })).toBe(true);
    expect(isEstimated({ ...oats, gramsProvenance: 'ai_adjusted' })).toBe(false);
  });
});

describe('totals', () => {
  it('sums maps and always reports the core codes', () => {
    const totals = sumNutrients([{ energy_kcal: '100' }, { energy_kcal: '50' }]);
    expect(totals.values.energy_kcal).toBe('150');
    expect(totals.values.protein_g).toBe('0');
    expect(totals.incomplete).toContain('protein_g');
    expect(totals.incomplete).not.toContain('energy_kcal');
  });

  it('marks a code incomplete when any contributor lacks it', () => {
    const totals = totalsForEntries([oats, quickAdd]);
    expect(totals.values.energy_kcal).toBe('344.5');
    expect(totals.incomplete).toContain('protein_g');
  });

  it('reports non-core codes only when something carries them', () => {
    expect(sumNutrients([{ energy_kcal: '1' }]).values.sugars_g).toBeUndefined();
    expect(sumNutrients([{ sugars_g: '4' }]).values.sugars_g).toBe('4');
    expect(sumNutrients([{ energy_kcal: '1' }], { codes: ALL_CODES }).values.sugars_g).toBe('0');
  });

  it('handles an empty day', () => {
    const totals = sumNutrients([]);
    expect(totals.incomplete).toEqual([]);
    expect(totals.values.energy_kcal).toBe('0');
    expect(EMPTY_TOTALS.values).toEqual({});
  });

  it('breaks a day down by meal', () => {
    const day = dayTotals([oats, quickAdd]);
    expect(day.entryCount).toBe(2);
    expect(day.byMeal.breakfast.values.energy_kcal).toBe('194.5');
    expect(day.byMeal.snack.values.energy_kcal).toBe('150');
    expect(day.byMeal.lunch.values.energy_kcal).toBe('0');
    expect(day.total.values.energy_kcal).toBe('344.5');
  });

  it('reads a single nutrient, hiding a zero that is only missing data', () => {
    const totals = totalsForEntries([quickAdd]);
    expect(totalOf(totals, 'energy_kcal')).toBe('150');
    expect(totalOf(totals, 'protein_g')).toBeNull();
    expect(totalOf(sumNutrients([{ vitamin_c_mg: '1' }]), 'sugars_g')).toBeNull();
    expect(totalOf(totalsForEntries([oats]), 'protein_g')).toBe('8.45');
  });

  it('computes macro energy shares for the Today bars', () => {
    const shares = macroEnergyShares(totalsForEntries([oats]));
    expect(shares.protein_g).toBeCloseTo((8.45 * 4) / 194.5, 10);
    expect(shares.fat_g).toBeCloseTo((3.45 * 9) / 194.5, 10);
    expect(macroEnergyShares(sumNutrients([]))).toEqual({});
    expect(macroEnergyShares({ values: { energy_kcal: '100' }, incomplete: [] })).toEqual({});
  });
});
