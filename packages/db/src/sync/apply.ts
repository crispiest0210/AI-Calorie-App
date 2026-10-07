/**
 * Wire rows → SQLite, applied in one transaction so a half-applied pull can
 * never be observed (spec 2.10). These writes deliberately do *not* enqueue
 * anything in the outbox: they came from the server, and echoing them back
 * would loop forever.
 */
import { eq } from 'drizzle-orm';
import type { SyncRow } from '@nt/core';
import { food, foodNutrient, foodPortion, goalProfile, goalTarget, logEntry, recipeIngredient, recipeMeta, waterEntry, waterPreset } from '../schema';
import type { Writer } from '../db';

export interface ApplyContext {
  /** Release row custom foods point at, since the server does not send one. */
  userSourceReleaseId: string;
}

export function applyRow(tx: Writer, change: SyncRow & { serverRev: number }, context: ApplyContext): void {
  switch (change.table) {
    case 'log_entry': {
      const row = change.row;
      tx.insert(logEntry)
        .values({
          id: row.id,
          localDate: row.localDate,
          loggedAt: row.loggedAt,
          tzOffsetMin: row.tzOffsetMin,
          mealSlot: row.mealSlot,
          entryKind: row.entryKind,
          foodId: row.foodId,
          amountValue: row.amountValue,
          amountUnit: row.amountUnit,
          portionId: row.portionId,
          grams: row.grams,
          gramsProvenance: row.gramsProvenance,
          foodNameSnapshot: row.foodNameSnapshot,
          sourceReleaseId: row.sourceReleaseId,
          nutrientsPer100g: row.nutrientsPer100g === null ? null : JSON.stringify(row.nutrientsPer100g),
          nutrientsAbsolute: row.nutrientsAbsolute === null ? null : JSON.stringify(row.nutrientsAbsolute),
          note: row.note,
          serverRev: change.serverRev,
          updatedAt: row.updatedAt,
          deletedAt: row.deletedAt,
        })
        .onConflictDoUpdate({
          target: logEntry.id,
          set: {
            localDate: row.localDate,
            loggedAt: row.loggedAt,
            mealSlot: row.mealSlot,
            entryKind: row.entryKind,
            foodId: row.foodId,
            amountValue: row.amountValue,
            amountUnit: row.amountUnit,
            portionId: row.portionId,
            grams: row.grams,
            gramsProvenance: row.gramsProvenance,
            foodNameSnapshot: row.foodNameSnapshot,
            sourceReleaseId: row.sourceReleaseId,
            nutrientsPer100g: row.nutrientsPer100g === null ? null : JSON.stringify(row.nutrientsPer100g),
            nutrientsAbsolute: row.nutrientsAbsolute === null ? null : JSON.stringify(row.nutrientsAbsolute),
            note: row.note,
            serverRev: change.serverRev,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          },
        })
        .run();
      return;
    }
    case 'water_entry': {
      const row = change.row;
      const values = {
        id: row.id,
        localDate: row.localDate,
        loggedAt: row.loggedAt,
        amountMl: row.amountMl,
        serverRev: change.serverRev,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
      };
      tx.insert(waterEntry).values(values).onConflictDoUpdate({ target: waterEntry.id, set: values }).run();
      return;
    }
    case 'water_preset': {
      const row = change.row;
      const values = {
        id: row.id,
        label: row.label,
        amountMl: row.amountMl,
        position: row.position,
        serverRev: change.serverRev,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
      };
      tx.insert(waterPreset).values(values).onConflictDoUpdate({ target: waterPreset.id, set: values }).run();
      return;
    }
    case 'goal_profile': {
      const row = change.row;
      const values = {
        id: row.id,
        effectiveFrom: row.effectiveFrom,
        waterTargetMl: row.waterTargetMl,
        serverRev: change.serverRev,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
      };
      tx.insert(goalProfile).values(values).onConflictDoUpdate({ target: goalProfile.id, set: values }).run();
      // The profile owns its targets, so they are replaced wholesale.
      tx.delete(goalTarget).where(eq(goalTarget.goalProfileId, row.id)).run();
      for (const target of row.targets) {
        tx.insert(goalTarget)
          .values({
            goalProfileId: row.id,
            nutrientCode: target.nutrientCode,
            kind: target.kind,
            value: target.value ?? null,
            valueLow: target.valueLow ?? null,
            valueHigh: target.valueHigh ?? null,
            basis: target.basis,
          })
          .run();
      }
      return;
    }
    case 'food': {
      const row = change.row;
      const values = {
        id: row.id,
        kind: row.kind,
        ownerUserId: null,
        name: row.name,
        brand: row.brand,
        gtin: row.gtin,
        sourceReleaseId: context.userSourceReleaseId,
        sourceRef: row.sourceRef,
        qualityTier: row.qualityTier,
        densityGPerMl: row.densityGPerMl,
        serverRev: change.serverRev,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
      };
      tx.insert(food).values(values).onConflictDoUpdate({ target: food.id, set: values }).run();

      tx.delete(foodNutrient).where(eq(foodNutrient.foodId, row.id)).run();
      for (const nutrient of row.nutrients) {
        tx.insert(foodNutrient)
          .values({ foodId: row.id, nutrientCode: nutrient.nutrientCode, amountPer100g: nutrient.amountPer100g, derivation: nutrient.derivation })
          .run();
      }
      tx.delete(foodPortion).where(eq(foodPortion.foodId, row.id)).run();
      for (const portion of row.portions) {
        tx.insert(foodPortion)
          .values({ id: portion.id, foodId: row.id, label: portion.label, gramWeight: portion.gramWeight, source: portion.source, position: portion.position })
          .run();
      }

      if (row.recipe != null) {
        const meta = { foodId: row.id, servings: row.recipe.servings, totalCookedGrams: row.recipe.totalCookedGrams };
        tx.insert(recipeMeta).values(meta).onConflictDoUpdate({ target: recipeMeta.foodId, set: meta }).run();
        tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeFoodId, row.id)).run();
        for (const ingredient of row.recipe.ingredients) {
          tx.insert(recipeIngredient)
            .values({
              id: ingredient.id,
              recipeFoodId: row.id,
              ingredientFoodId: ingredient.ingredientFoodId,
              grams: ingredient.grams,
              position: ingredient.position,
              serverRev: change.serverRev,
              updatedAt: row.updatedAt,
            })
            .run();
        }
      }
      return;
    }
  }
}
