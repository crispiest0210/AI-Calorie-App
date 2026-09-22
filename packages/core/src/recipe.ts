/**
 * Recipe nutrition (spec 3.3): per-100 g = Σ(ingredient grams × per-100 g ÷ 100)
 * ÷ cooked grams × 100. A code missing from any ingredient stays missing —
 * a recipe never silently treats an unreported nutrient as zero.
 */
import { dec, num, type Num, type NumericInput } from './decimal';
import type { NutrientCode } from './nutrients';
import { nutrientCodesOf, type NutrientMap } from './nutrient-map';
import type { CanonicalNutrient, CanonicalPortion } from './normalize';

export interface RecipeIngredient {
  ingredientFoodId: string;
  grams: Num;
  nutrientsPer100g: NutrientMap;
}

export interface RecipeInput {
  ingredients: readonly RecipeIngredient[];
  /** Weight after cooking; null means the sum of raw ingredient grams. */
  totalCookedGrams?: Num | null;
  servings: NumericInput;
}

export interface RecipeResult {
  per100g: NutrientMap;
  nutrients: CanonicalNutrient[];
  cookedGrams: Num;
  servingGrams: Num;
  servingPortion: CanonicalPortion;
  /** Codes at least one ingredient did not report. */
  incompleteCodes: NutrientCode[];
}

export class RecipeError extends Error {}

export function computeRecipe(input: RecipeInput): RecipeResult {
  if (input.ingredients.length === 0) throw new RecipeError('a recipe needs at least one ingredient');
  const servings = dec(input.servings);
  if (!servings.greaterThan(0)) throw new RecipeError('servings must be greater than zero');

  let rawGrams = dec(0);
  for (const ing of input.ingredients) {
    const g = dec(ing.grams);
    if (!g.greaterThan(0)) throw new RecipeError('ingredient grams must be greater than zero');
    rawGrams = rawGrams.plus(g);
  }

  const cooked = input.totalCookedGrams === null || input.totalCookedGrams === undefined ? rawGrams : dec(input.totalCookedGrams);
  if (!cooked.greaterThan(0)) throw new RecipeError('cooked grams must be greater than zero');

  const codesEverywhere = new Set<NutrientCode>(nutrientCodesOf(input.ingredients[0]!.nutrientsPer100g));
  const anyCode = new Set<NutrientCode>();
  for (const ing of input.ingredients) {
    const codes = new Set(nutrientCodesOf(ing.nutrientsPer100g));
    for (const code of codes) anyCode.add(code);
    for (const code of [...codesEverywhere]) if (!codes.has(code)) codesEverywhere.delete(code);
  }

  const per100g: NutrientMap = {};
  const nutrients: CanonicalNutrient[] = [];
  for (const code of codesEverywhere) {
    let absolute = dec(0);
    for (const ing of input.ingredients) {
      absolute = absolute.plus(dec(ing.nutrientsPer100g[code] as Num).times(dec(ing.grams)).div(100));
    }
    const value = num(absolute.div(cooked).times(100));
    per100g[code] = value;
    nutrients.push({ code, amountPer100g: value, derivation: 'computed' });
  }

  const servingGrams = num(cooked.div(servings));
  return {
    per100g,
    nutrients,
    cookedGrams: num(cooked),
    servingGrams,
    servingPortion: { label: '1 serving', gramWeight: servingGrams, source: 'user' },
    incompleteCodes: [...anyCode].filter((code) => !codesEverywhere.has(code)),
  };
}
