/**
 * SQLite rows → wire rows. Custom foods and goal profiles travel as
 * aggregates: the food carries its nutrients and portions, the profile carries
 * its targets, so neither can arrive half-written (review R3).
 */
import { eq } from 'drizzle-orm';
import { parseNutrientMap, type SyncRow, type SyncedTable } from '@nt/core';
import { food, foodNutrient, foodPortion, goalProfile, goalTarget, logEntry, recipeIngredient, recipeMeta, waterEntry, waterPreset } from '../schema';
import { parseJson, type Db } from '../db';

/** Reads one row by id and shapes it for the wire; null if it has vanished. */
export function serializeRow(db: Db, table: SyncedTable, id: string): SyncRow | null {
  switch (table) {
    case 'log_entry': {
      const row = db.select().from(logEntry).where(eq(logEntry.id, id)).get();
      if (!row) return null;
      return {
        table: 'log_entry',
        row: {
          id: row.id,
          localDate: row.localDate,
          loggedAt: row.loggedAt,
          tzOffsetMin: row.tzOffsetMin,
          mealSlot: row.mealSlot as never,
          entryKind: row.entryKind as never,
          foodId: row.foodId,
          amountValue: row.amountValue,
          amountUnit: row.amountUnit as never,
          portionId: row.portionId,
          grams: row.grams,
          gramsProvenance: row.gramsProvenance as never,
          foodNameSnapshot: row.foodNameSnapshot,
          sourceReleaseId: row.sourceReleaseId,
          nutrientsPer100g: row.nutrientsPer100g === null ? null : parseNutrientMap(parseJson(row.nutrientsPer100g, {})),
          nutrientsAbsolute: row.nutrientsAbsolute === null ? null : parseNutrientMap(parseJson(row.nutrientsAbsolute, {})),
          note: row.note,
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt,
        },
      };
    }
    case 'water_entry': {
      const row = db.select().from(waterEntry).where(eq(waterEntry.id, id)).get();
      if (!row) return null;
      return {
        table: 'water_entry',
        row: { id: row.id, localDate: row.localDate, loggedAt: row.loggedAt, amountMl: row.amountMl, updatedAt: row.updatedAt, deletedAt: row.deletedAt },
      };
    }
    case 'water_preset': {
      const row = db.select().from(waterPreset).where(eq(waterPreset.id, id)).get();
      if (!row) return null;
      return {
        table: 'water_preset',
        row: {
          id: row.id,
          label: row.label,
          amountMl: row.amountMl,
          position: row.position,
          updatedAt: row.updatedAt ?? 0,
          deletedAt: row.deletedAt,
        },
      };
    }
    case 'goal_profile': {
      const row = db.select().from(goalProfile).where(eq(goalProfile.id, id)).get();
      if (!row) return null;
      const targets = db.select().from(goalTarget).where(eq(goalTarget.goalProfileId, id)).all();
      return {
        table: 'goal_profile',
        row: {
          id: row.id,
          effectiveFrom: row.effectiveFrom,
          waterTargetMl: row.waterTargetMl,
          targets: targets.map((t) => ({
            nutrientCode: t.nutrientCode as never,
            kind: t.kind as never,
            value: t.value,
            valueLow: t.valueLow,
            valueHigh: t.valueHigh,
            basis: t.basis as never,
          })),
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt,
        },
      };
    }
    case 'food': {
      const row = db.select().from(food).where(eq(food.id, id)).get();
      if (!row) return null;
      // Catalog foods are server-owned and never pushed.
      if (row.kind !== 'custom' && row.kind !== 'recipe') return null;
      const nutrients = db.select().from(foodNutrient).where(eq(foodNutrient.foodId, id)).all();
      const portions = db.select().from(foodPortion).where(eq(foodPortion.foodId, id)).orderBy(foodPortion.position).all();

      const meta = row.kind === 'recipe' ? db.select().from(recipeMeta).where(eq(recipeMeta.foodId, id)).get() : undefined;
      const ingredients =
        row.kind === 'recipe'
          ? db.select().from(recipeIngredient).where(eq(recipeIngredient.recipeFoodId, id)).orderBy(recipeIngredient.position).all()
          : [];

      return {
        table: 'food',
        row: {
          id: row.id,
          kind: row.kind as never,
          name: row.name,
          brand: row.brand,
          gtin: row.gtin,
          qualityTier: row.qualityTier as never,
          sourceRef: row.sourceRef,
          densityGPerMl: row.densityGPerMl,
          nutrients: nutrients.map((n) => ({ nutrientCode: n.nutrientCode, amountPer100g: n.amountPer100g, derivation: n.derivation })),
          portions: portions.map((p) => ({ id: p.id, label: p.label, gramWeight: p.gramWeight, source: p.source, position: p.position })),
          recipe:
            meta === undefined
              ? null
              : {
                  servings: meta.servings,
                  totalCookedGrams: meta.totalCookedGrams,
                  ingredients: ingredients.map((i) => ({
                    id: i.id,
                    ingredientFoodId: i.ingredientFoodId,
                    grams: i.grams,
                    position: i.position,
                  })),
                },
          updatedAt: row.updatedAt ?? 0,
          deletedAt: row.deletedAt,
        },
      };
    }
  }
}
