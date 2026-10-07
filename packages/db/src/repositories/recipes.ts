/**
 * Recipes (F11). A recipe is a `food` of kind `recipe` whose nutrients are
 * computed from its ingredients and recomputed whenever they change (spec
 * 3.3). Logging one is logging a food, so everything downstream — snapshots,
 * totals, sync — works without knowing recipes exist.
 */
import { asc, eq } from 'drizzle-orm';
import {
  computeRecipe,
  uuidv7,
  type CanonicalFood,
  type Num,
  type NutrientCode,
  type NutrientMap,
  type RecipeResult,
} from '@nt/core';
import { food, foodNutrient, foodPortion, recipeIngredient, recipeMeta } from '../schema';
import type { Db, Writer } from '../db';
import { enqueue } from './outbox';
import { foodDetail, insertFood, type FoodDetail } from './foods';

export interface RecipeIngredientView {
  id: string;
  ingredientFoodId: string;
  name: string;
  grams: Num;
  position: number;
  nutrientsPer100g: NutrientMap;
}

export interface RecipeView {
  id: string;
  name: string;
  servings: Num;
  /** Weight after cooking; null means the sum of the raw ingredients. */
  totalCookedGrams: Num | null;
  ingredients: RecipeIngredientView[];
  /** Null until the recipe has at least one ingredient. */
  computed: RecipeResult | null;
  /** Nutrients an ingredient does not report, so the recipe cannot either. */
  incompleteCodes: NutrientCode[];
}

function ingredientsOf(db: Db, recipeId: string): RecipeIngredientView[] {
  const rows = db
    .select()
    .from(recipeIngredient)
    .where(eq(recipeIngredient.recipeFoodId, recipeId))
    .orderBy(asc(recipeIngredient.position))
    .all();

  return rows.flatMap((row) => {
    const detail = foodDetail(db, row.ingredientFoodId);
    if (detail === null) return [];
    return [{
      id: row.id,
      ingredientFoodId: row.ingredientFoodId,
      name: detail.name,
      grams: row.grams,
      position: row.position,
      nutrientsPer100g: detail.nutrientsPer100g,
    }];
  });
}

export function readRecipe(db: Db, recipeId: string): RecipeView | null {
  const row = db.select().from(food).where(eq(food.id, recipeId)).get();
  if (!row || row.kind !== 'recipe') return null;
  const meta = db.select().from(recipeMeta).where(eq(recipeMeta.foodId, recipeId)).get();
  const ingredients = ingredientsOf(db, recipeId);

  const computed =
    ingredients.length === 0
      ? null
      : computeRecipe({
          ingredients: ingredients.map((i) => ({
            ingredientFoodId: i.ingredientFoodId,
            grams: i.grams,
            nutrientsPer100g: i.nutrientsPer100g,
          })),
          totalCookedGrams: meta?.totalCookedGrams ?? null,
          servings: meta?.servings ?? '1',
        });

  return {
    id: row.id,
    name: row.name,
    servings: meta?.servings ?? '1',
    totalCookedGrams: meta?.totalCookedGrams ?? null,
    ingredients,
    computed,
    incompleteCodes: computed?.incompleteCodes ?? [],
  };
}

/**
 * Rewrites the recipe's nutrients and its "1 serving" portion from whatever
 * its ingredients now say. Called after every change, because a recipe whose
 * numbers lag its ingredients is worse than no recipe.
 */
function recompute(tx: Writer, db: Db, recipeId: string, now: number): void {
  const view = readRecipe(db, recipeId);
  if (view === null) return;

  tx.delete(foodNutrient).where(eq(foodNutrient.foodId, recipeId)).run();

  if (view.computed === null) {
    tx.update(food).set({ updatedAt: now }).where(eq(food.id, recipeId)).run();
    return;
  }

  for (const nutrient of view.computed.nutrients) {
    tx.insert(foodNutrient)
      .values({ foodId: recipeId, nutrientCode: nutrient.code, amountPer100g: nutrient.amountPer100g, derivation: 'computed' })
      .run();
  }

  /*
   * The serving row is updated in place, never replaced. Entries logged
   * against this recipe reference that portion id, and deleting it would
   * either break the reference or silently orphan the entry. The entry keeps
   * its own resolved grams and nutrient snapshot either way, so the portion is
   * only ever a label.
   */
  const existing = db.select().from(foodPortion).where(eq(foodPortion.foodId, recipeId)).all();
  const serving = existing.find((portion) => portion.position === 0);
  if (serving === undefined) {
    tx.insert(foodPortion)
      .values({
        id: uuidv7(now),
        foodId: recipeId,
        label: view.computed.servingPortion.label,
        gramWeight: view.computed.servingPortion.gramWeight,
        source: 'user',
        position: 0,
      })
      .run();
  } else {
    tx.update(foodPortion)
      .set({ label: view.computed.servingPortion.label, gramWeight: view.computed.servingPortion.gramWeight })
      .where(eq(foodPortion.id, serving.id))
      .run();
  }
  tx.update(food).set({ updatedAt: now }).where(eq(food.id, recipeId)).run();
}

export interface CreateRecipeInput {
  name: string;
  servings: Num;
  totalCookedGrams?: Num | null;
  sourceReleaseId: string;
}

export function createRecipe(db: Db, input: CreateRecipeInput, now = Date.now()): string {
  const canonical: CanonicalFood = {
    kind: 'recipe',
    name: input.name.trim(),
    brand: null,
    gtin: null,
    qualityTier: 'computed',
    sourceRef: 'recipe',
    densityGPerMl: null,
    category: null,
    nutrients: [],
    portions: [],
  };
  return db.transaction((tx) => {
    const id = insertFood(tx, canonical, { sourceReleaseId: input.sourceReleaseId, synced: true, now });
    tx.insert(recipeMeta)
      .values({ foodId: id, totalCookedGrams: input.totalCookedGrams ?? null, servings: input.servings })
      .run();
    return id;
  });
}

export function updateRecipe(
  db: Db,
  recipeId: string,
  patch: { name?: string; servings?: Num; totalCookedGrams?: Num | null },
  now = Date.now(),
): void {
  db.transaction((tx) => {
    if (patch.name !== undefined) tx.update(food).set({ name: patch.name.trim() }).where(eq(food.id, recipeId)).run();
    const values: Record<string, unknown> = {};
    if (patch.servings !== undefined) values.servings = patch.servings;
    if (patch.totalCookedGrams !== undefined) values.totalCookedGrams = patch.totalCookedGrams;
    if (Object.keys(values).length > 0) {
      tx.update(recipeMeta).set(values).where(eq(recipeMeta.foodId, recipeId)).run();
    }
    recompute(tx, db, recipeId, now);
    enqueue(tx, 'food', recipeId, 'upsert', now);
  });
}

export function addIngredient(db: Db, recipeId: string, ingredientFoodId: string, grams: Num, now = Date.now()): string {
  const position = db.select().from(recipeIngredient).where(eq(recipeIngredient.recipeFoodId, recipeId)).all().length;
  const id = uuidv7(now);
  db.transaction((tx) => {
    tx.insert(recipeIngredient).values({ id, recipeFoodId: recipeId, ingredientFoodId, grams, position, updatedAt: now }).run();
    recompute(tx, db, recipeId, now);
    enqueue(tx, 'food', recipeId, 'upsert', now);
  });
  return id;
}

export function updateIngredient(db: Db, recipeId: string, ingredientId: string, grams: Num, now = Date.now()): void {
  db.transaction((tx) => {
    tx.update(recipeIngredient).set({ grams, updatedAt: now }).where(eq(recipeIngredient.id, ingredientId)).run();
    recompute(tx, db, recipeId, now);
    enqueue(tx, 'food', recipeId, 'upsert', now);
  });
}

export function removeIngredient(db: Db, recipeId: string, ingredientId: string, now = Date.now()): void {
  db.transaction((tx) => {
    tx.delete(recipeIngredient).where(eq(recipeIngredient.id, ingredientId)).run();
    recompute(tx, db, recipeId, now);
    enqueue(tx, 'food', recipeId, 'upsert', now);
  });
}

export function listRecipes(db: Db): FoodDetail[] {
  return db
    .select()
    .from(food)
    .where(eq(food.kind, 'recipe'))
    .all()
    .flatMap((row) => {
      if (row.deletedAt !== null) return [];
      const detail = foodDetail(db, row.id);
      return detail === null ? [] : [detail];
    });
}
