/**
 * Amount → grams. Grams are the only thing the nutrition engine consumes;
 * a unit that cannot be resolved from source data is refused, never guessed
 * (spec 2.6.1 and 2.6.5).
 */
import { dec, mul, num, type Num, type NumericInput } from './decimal';

export const AMOUNT_UNITS = ['g', 'ml', 'portion', 'kcal'] as const;
export type AmountUnit = (typeof AMOUNT_UNITS)[number];

export const GRAMS_PROVENANCES = ['user', 'portion', 'ai_estimate', 'ai_adjusted'] as const;
export type GramsProvenance = (typeof GRAMS_PROVENANCES)[number];

export interface Portion {
  id: string;
  label: string;
  gramWeight: Num;
  source: 'fdc' | 'off_serving' | 'user';
}

export interface FoodMeasureInfo {
  /** g per mL; null disables mL logging for this food. */
  densityGPerMl: Num | null;
  portions: readonly Portion[];
}

export type GramsFailure =
  | 'amount_not_positive'
  | 'density_unknown'
  | 'portion_unknown'
  | 'energy_unit_needs_quick_add';

export type GramsResult =
  | { ok: true; grams: Num; provenance: Extract<GramsProvenance, 'user' | 'portion'> }
  | { ok: false; reason: GramsFailure };

export interface AmountInput {
  value: NumericInput;
  unit: AmountUnit;
  /** Required when unit is 'portion'. */
  portionId?: string | null;
}

export function resolveGrams(amount: AmountInput, food: FoodMeasureInfo): GramsResult {
  const value = dec(amount.value);
  if (!value.greaterThan(0)) return { ok: false, reason: 'amount_not_positive' };

  switch (amount.unit) {
    case 'g':
      return { ok: true, grams: num(value), provenance: 'user' };
    case 'ml': {
      if (food.densityGPerMl === null) return { ok: false, reason: 'density_unknown' };
      return { ok: true, grams: num(mul(value, food.densityGPerMl)), provenance: 'user' };
    }
    case 'portion': {
      const portion = food.portions.find((p) => p.id === amount.portionId);
      if (!portion) return { ok: false, reason: 'portion_unknown' };
      return { ok: true, grams: num(mul(value, portion.gramWeight)), provenance: 'portion' };
    }
    case 'kcal':
      return { ok: false, reason: 'energy_unit_needs_quick_add' };
  }
}

/** Units the Amount step may offer for a food, in picker order. */
export function availableUnits(food: FoodMeasureInfo): AmountUnit[] {
  const units: AmountUnit[] = ['g'];
  if (food.densityGPerMl !== null) units.push('ml');
  if (food.portions.length > 0) units.push('portion');
  return units;
}

/** Grams → the amount to show back in a given unit (inverse of resolveGrams). */
export function gramsToUnit(grams: NumericInput, unit: AmountUnit, food: FoodMeasureInfo, portionId?: string | null): Num | null {
  const g = dec(grams);
  switch (unit) {
    case 'g':
      return num(g);
    case 'ml':
      return food.densityGPerMl === null ? null : num(g.div(dec(food.densityGPerMl)));
    case 'portion': {
      const portion = food.portions.find((p) => p.id === portionId);
      return portion ? num(g.div(dec(portion.gramWeight))) : null;
    }
    case 'kcal':
      return null;
  }
}
