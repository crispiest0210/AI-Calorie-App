/**
 * Recipe math and bookkeeping. The arithmetic itself is proved in
 * packages/core; what matters here is that the stored nutrients always match
 * the ingredients, and that logging a recipe is just logging a food.
 */
import { describe, expect, it } from 'vitest';
import { localDateOf, totalOf } from '@nt/core';
import { readDay } from '../src/day';
import * as entries from '../src/repositories/entries';
import * as foods from '../src/repositories/foods';
import * as outbox from '../src/repositories/outbox';
import * as recipes from '../src/repositories/recipes';
import { RELEASE_ID, catalogFood, freshDb } from './helpers';

const RICE = { energy_kcal: '130', protein_g: '2.7', carb_g: '28', fat_g: '0.3' };
const CHICKEN = { energy_kcal: '165', protein_g: '31', carb_g: '0', fat_g: '3.6' };

function kitchen() {
  const { db } = freshDb();
  const rice = catalogFood(db, 'Rice, cooked, NFS', RICE);
  const chicken = catalogFood(db, 'Chicken breast, roasted', CHICKEN);
  const id = recipes.createRecipe(db, { name: 'Chicken and rice', servings: '2', sourceReleaseId: RELEASE_ID });
  return { db, rice, chicken, id };
}

describe('recipes', () => {
  it('computes per-100 g from its ingredients', () => {
    const { db, rice, chicken, id } = kitchen();
    recipes.addIngredient(db, id, rice, '200');
    recipes.addIngredient(db, id, chicken, '300');

    const view = recipes.readRecipe(db, id)!;
    expect(view.computed!.cookedGrams).toBe('500');
    // (200x130 + 300x165) / 100 = 755 kcal over 500 g
    expect(view.computed!.per100g.energy_kcal).toBe('151');

    const stored = foods.foodDetail(db, id)!;
    expect(stored.nutrientsPer100g.energy_kcal).toBe('151');
    expect(stored.qualityTier).toBe('computed');
  });

  it('generates a serving portion from the yield', () => {
    const { db, rice, chicken, id } = kitchen();
    recipes.addIngredient(db, id, rice, '200');
    recipes.addIngredient(db, id, chicken, '300');
    expect(foods.foodDetail(db, id)!.portions).toEqual([
      { id: expect.any(String), label: '1 serving', gramWeight: '250', source: 'user' },
    ]);
  });

  it('recomputes when an ingredient changes, is added or removed', () => {
    const { db, rice, chicken, id } = kitchen();
    const riceIngredient = recipes.addIngredient(db, id, rice, '200');
    expect(foods.foodDetail(db, id)!.nutrientsPer100g.energy_kcal).toBe('130');

    recipes.addIngredient(db, id, chicken, '300');
    expect(foods.foodDetail(db, id)!.nutrientsPer100g.energy_kcal).toBe('151');

    // 400 g rice at 130 plus 300 g chicken at 165, over 700 g.
    recipes.updateIngredient(db, id, riceIngredient, '400');
    expect(foods.foodDetail(db, id)!.nutrientsPer100g.energy_kcal).toBe('145');

    recipes.removeIngredient(db, id, riceIngredient);
    expect(foods.foodDetail(db, id)!.nutrientsPer100g.energy_kcal).toBe('165');
  });

  it('follows the cooked weight when reduction concentrates it', () => {
    const { db, rice, chicken, id } = kitchen();
    recipes.addIngredient(db, id, rice, '200');
    recipes.addIngredient(db, id, chicken, '300');
    recipes.updateRecipe(db, id, { totalCookedGrams: '400' });

    const view = recipes.readRecipe(db, id)!;
    expect(view.computed!.per100g.energy_kcal).toBe('188.75');
    expect(foods.foodDetail(db, id)!.portions[0]!.gramWeight).toBe('200');
  });

  it('drops a nutrient any ingredient does not report, and says which', () => {
    const { db, chicken, id } = kitchen();
    const partial = catalogFood(db, 'Mystery sauce', { energy_kcal: '90' });
    recipes.addIngredient(db, id, chicken, '100');
    recipes.addIngredient(db, id, partial, '50');

    const view = recipes.readRecipe(db, id)!;
    expect(view.computed!.per100g.protein_g).toBeUndefined();
    expect(view.incompleteCodes).toContain('protein_g');
    expect(foods.foodDetail(db, id)!.nutrientsPer100g.protein_g).toBeUndefined();
  });

  it('has no nutrients until it has an ingredient', () => {
    const { db, id } = kitchen();
    const view = recipes.readRecipe(db, id)!;
    expect(view.computed).toBeNull();
    expect(foods.foodDetail(db, id)!.nutrientsPer100g).toEqual({});
  });

  it('is logged like any other food, snapshot and all', () => {
    const { db, rice, chicken, id } = kitchen();
    recipes.addIngredient(db, id, rice, '200');
    recipes.addIngredient(db, id, chicken, '300');

    const detail = foods.foodDetail(db, id)!;
    const serving = detail.portions[0]!;
    entries.logFood(db, {
      foodId: id,
      foodName: detail.name,
      sourceReleaseId: detail.sourceReleaseId,
      mealSlot: 'dinner',
      amountValue: '1',
      amountUnit: 'portion',
      portionId: serving.id,
      grams: serving.gramWeight,
      gramsProvenance: 'portion',
      nutrientsPer100g: detail.nutrientsPer100g,
    });

    const day = readDay(db, localDateOf());
    expect(totalOf(day.totals.total, 'energy_kcal')).toBe('377.5');

    // Changing the recipe afterwards must not move a logged day, and must not
    // break the entry's reference to the serving it was logged against.
    recipes.updateIngredient(db, id, recipes.readRecipe(db, id)!.ingredients[0]!.id, '1000');
    expect(totalOf(readDay(db, localDateOf()).totals.total, 'energy_kcal')).toBe('377.5');
    expect(readDay(db, localDateOf()).entries[0]!.portionLabel).toBe('1 serving');
    expect(foods.foodDetail(db, id)!.portions[0]!.id).toBe(serving.id);
  });

  it('queues the recipe for sync on every change', () => {
    const { db, rice, id } = kitchen();
    recipes.addIngredient(db, id, rice, '200');
    recipes.updateRecipe(db, id, { servings: '4' });
    const queued = outbox.pending(db).filter((row) => row.rowId === id);
    expect(queued.length).toBeGreaterThanOrEqual(2);
    expect(queued.every((row) => row.tableName === 'food')).toBe(true);
  });

  it('lists recipes and ignores a deleted one', () => {
    const { db, rice, id } = kitchen();
    recipes.addIngredient(db, id, rice, '200');
    expect(recipes.listRecipes(db).map((r) => r.id)).toEqual([id]);
    foods.softDeleteFood(db, id);
    expect(recipes.listRecipes(db)).toEqual([]);
    expect(recipes.readRecipe(db, 'not-a-recipe')).toBeNull();
    expect(recipes.readRecipe(db, rice)).toBeNull();
  });

  it('skips an ingredient whose food has gone', () => {
    const { db, rice, id } = kitchen();
    recipes.addIngredient(db, id, rice, '200');
    foods.softDeleteFood(db, rice);
    expect(recipes.readRecipe(db, id)!.ingredients).toEqual([]);
  });
});
