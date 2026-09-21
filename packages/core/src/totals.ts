/**
 * Totals are always recomputed from entries — never stored — so they cannot
 * drift from the rows they summarize (spec 3.4).
 */
import { dec, num, type Num } from './decimal';
import { CORE_CODES, NUTRIENT_CODES, sortedCodes, type NutrientCode } from './nutrients';
import { nutrientCodesOf, type NutrientMap } from './nutrient-map';
import { MEAL_SLOTS, entryNutrients, type EngineEntry, type MealSlot } from './entries';

export interface NutrientTotals {
  values: NutrientMap;
  /** Codes some contributor did not report; the UI shows these as "incomplete". */
  incomplete: NutrientCode[];
}

export const EMPTY_TOTALS: NutrientTotals = { values: {}, incomplete: [] };

export interface SumOptions {
  /** Codes always reported, even when nothing contributes them. Defaults to the core six. */
  codes?: readonly NutrientCode[];
}

export function sumNutrients(maps: readonly NutrientMap[], options: SumOptions = {}): NutrientTotals {
  const base = options.codes ?? CORE_CODES;
  const present = new Set<NutrientCode>(base);
  for (const map of maps) for (const code of nutrientCodesOf(map)) present.add(code);

  const values: NutrientMap = {};
  const incomplete: NutrientCode[] = [];
  for (const code of sortedCodes(present)) {
    let total = dec(0);
    let contributors = 0;
    for (const map of maps) {
      const value = map[code];
      if (value === undefined) continue;
      total = total.plus(dec(value));
      contributors += 1;
    }
    values[code] = num(total);
    if (contributors < maps.length) incomplete.push(code);
  }
  return { values, incomplete };
}

export function totalsForEntries(entries: readonly EngineEntry[], options?: SumOptions): NutrientTotals {
  return sumNutrients(entries.map(entryNutrients), options);
}

export interface DayTotals {
  total: NutrientTotals;
  byMeal: Record<MealSlot, NutrientTotals>;
  entryCount: number;
}

export function dayTotals(entries: readonly EngineEntry[], options?: SumOptions): DayTotals {
  const byMeal = {} as Record<MealSlot, NutrientTotals>;
  for (const slot of MEAL_SLOTS) {
    byMeal[slot] = totalsForEntries(entries.filter((e) => e.mealSlot === slot), options);
  }
  return { total: totalsForEntries(entries, options), byMeal, entryCount: entries.length };
}

/** Value of one nutrient in a totals object, or null when nothing reported it. */
export function totalOf(totals: NutrientTotals, code: NutrientCode): Num | null {
  const value = totals.values[code];
  if (value === undefined) return null;
  if (totals.incomplete.includes(code) && dec(value).isZero()) return null;
  return value;
}

/** Share of energy carried by each macro, for the Today bars. 0–1, null when energy is unknown. */
export function macroEnergyShares(totals: NutrientTotals): Partial<Record<'protein_g' | 'carb_g' | 'fat_g', number>> {
  const energy = totals.values.energy_kcal;
  if (energy === undefined || dec(energy).isZero()) return {};
  const factors = { protein_g: 4, carb_g: 4, fat_g: 9 } as const;
  const out: Partial<Record<'protein_g' | 'carb_g' | 'fat_g', number>> = {};
  for (const code of ['protein_g', 'carb_g', 'fat_g'] as const) {
    const grams = totals.values[code];
    if (grams === undefined) continue;
    out[code] = dec(grams).times(factors[code]).div(dec(energy)).toNumber();
  }
  return out;
}

export const ALL_CODES: readonly NutrientCode[] = NUTRIENT_CODES;
