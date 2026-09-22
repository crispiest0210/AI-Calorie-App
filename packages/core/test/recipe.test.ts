import { describe, expect, it } from 'vitest';
import { RecipeError, computeRecipe } from '../src/recipe';

const rice = { ingredientFoodId: 'rice', grams: '200', nutrientsPer100g: { energy_kcal: '130', protein_g: '2.7', carb_g: '28', fat_g: '0.3' } };
const chicken = { ingredientFoodId: 'chicken', grams: '300', nutrientsPer100g: { energy_kcal: '165', protein_g: '31', carb_g: '0', fat_g: '3.6' } };

describe('computeRecipe', () => {
  it('computes per-100 g from ingredients and raw weight', () => {
    const result = computeRecipe({ ingredients: [rice, chicken], servings: 2 });
    expect(result.cookedGrams).toBe('500');
    // (200×130 + 300×165) ÷ 100 = 755 kcal over 500 g
    expect(result.per100g.energy_kcal).toBe('151');
    expect(result.per100g.protein_g).toBe('19.68');
  });

  it('uses the cooked weight when given, so reduction concentrates the food', () => {
    const result = computeRecipe({ ingredients: [rice, chicken], totalCookedGrams: '400', servings: 4 });
    expect(result.per100g.energy_kcal).toBe('188.75');
    expect(result.servingGrams).toBe('100');
    expect(result.servingPortion).toEqual({ label: '1 serving', gramWeight: '100', source: 'user' });
  });

  it('marks every computed value as computed', () => {
    const result = computeRecipe({ ingredients: [rice], servings: 1 });
    expect(result.nutrients.every((n) => n.derivation === 'computed')).toBe(true);
  });

  it('drops a nutrient any ingredient does not report, and says so', () => {
    const result = computeRecipe({
      ingredients: [{ ...rice, nutrientsPer100g: { ...rice.nutrientsPer100g, fiber_g: '0.4' } }, chicken],
      servings: 1,
    });
    expect(result.per100g.fiber_g).toBeUndefined();
    expect(result.incompleteCodes).toEqual(['fiber_g']);
  });

  it('refuses recipes it cannot compute', () => {
    expect(() => computeRecipe({ ingredients: [], servings: 1 })).toThrow(RecipeError);
    expect(() => computeRecipe({ ingredients: [rice], servings: 0 })).toThrow(RecipeError);
    expect(() => computeRecipe({ ingredients: [{ ...rice, grams: '0' }], servings: 1 })).toThrow(RecipeError);
    expect(() => computeRecipe({ ingredients: [rice], totalCookedGrams: '0', servings: 1 })).toThrow(RecipeError);
  });

  it('treats a null cooked weight as the raw sum', () => {
    expect(computeRecipe({ ingredients: [rice], totalCookedGrams: null, servings: 1 }).cookedGrams).toBe('200');
  });
});
