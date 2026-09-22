/** Log entries as the engine sees them: grams plus the snapshot taken at log time. */
import type { Num } from './decimal';
import { scalePer100g, type NutrientMap } from './nutrient-map';
import type { GramsProvenance } from './units';

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

export const ENTRY_KINDS = ['food', 'quick_add'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export interface EngineEntry {
  id: string;
  mealSlot: MealSlot;
  entryKind: EntryKind;
  /** Resolved grams; null only for quick_add. */
  grams: Num | null;
  /** Snapshot copied at log time so catalog updates never change past days (spec 2.6.8). */
  nutrientsPer100g: NutrientMap | null;
  /** Absolute values, used by quick_add. */
  nutrientsAbsolute: NutrientMap | null;
  gramsProvenance?: GramsProvenance;
}

/** The nutrients this entry actually contributes to a day. */
export function entryNutrients(entry: EngineEntry): NutrientMap {
  if (entry.entryKind === 'quick_add') return entry.nutrientsAbsolute ?? {};
  if (entry.grams === null || entry.nutrientsPer100g === null) return {};
  return scalePer100g(entry.nutrientsPer100g, entry.grams);
}

/** An AI-estimated amount keeps its badge until the user edits it (spec 5.3). */
export function isEstimated(entry: EngineEntry): boolean {
  return entry.gramsProvenance === 'ai_estimate';
}
