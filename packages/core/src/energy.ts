/**
 * Energy handling (spec 2.6.3): use the source's reported kcal; only when it is
 * missing compute Atwater factors and mark the value `derived`. The two are
 * never mixed silently.
 */
import { dec, num, type Num } from './decimal';
import { ATWATER_FACTORS, MACRO_CODES, type Derivation } from './nutrients';
import type { NutrientMap } from './nutrient-map';

export const KJ_PER_KCAL = '4.184';

export function kjToKcal(kj: Num | number): Num {
  return num(dec(kj).div(dec(KJ_PER_KCAL)));
}

export function kcalToKj(kcal: Num | number): Num {
  return num(dec(kcal).times(dec(KJ_PER_KCAL)));
}

/**
 * Σ(macro grams × factor), and only when protein, carbs and fat are all
 * reported. A partial macro set would produce a confidently wrong number —
 * USDA research records routinely report protein and fat but no carbohydrate —
 * so energy stays missing instead (spec 2.6.6).
 */
export function atwaterEnergy(map: NutrientMap): Num | null {
  let total = dec(0);
  for (const code of MACRO_CODES) {
    const value = map[code];
    if (value === undefined) return null;
    total = total.plus(dec(value).times(ATWATER_FACTORS[code]));
  }
  return num(total);
}

export interface ResolvedEnergy {
  kcal: Num | null;
  derivation: Derivation | null;
}

/**
 * Picks the energy value for a canonical record: reported kcal wins, then kJ
 * converted, then Atwater-derived, then nothing.
 */
export function resolveEnergy(input: { kcal?: Num | null; kj?: Num | null; macros: NutrientMap }): ResolvedEnergy {
  if (input.kcal !== undefined && input.kcal !== null) return { kcal: num(input.kcal), derivation: 'reported' };
  if (input.kj !== undefined && input.kj !== null) return { kcal: kjToKcal(input.kj), derivation: 'converted' };
  const atwater = atwaterEnergy(input.macros);
  if (atwater !== null) return { kcal: atwater, derivation: 'derived' };
  return { kcal: null, derivation: null };
}
