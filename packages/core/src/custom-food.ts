/**
 * Custom foods typed from a nutrition label (F7). The user is the source, so
 * the tier is "You" and per-serving values are converted to per 100 g here.
 */
import { dec, num, tryDec, type Decimal, type Num, type NumericInput } from './decimal';
import type { NutrientCode } from './nutrients';
import { nutrientCodesOf, type NutrientMap } from './nutrient-map';
import type { CanonicalFood, CanonicalNutrient, CanonicalPortion } from './normalize';
import { normalizeGtin, sanityCheck } from './normalize';

export type LabelBasis = 'per_serving' | 'per_100g';

export interface CustomFoodInput {
  name: string;
  brand?: string | null;
  gtin?: string | null;
  basis: LabelBasis;
  /** Required when basis is 'per_serving'. */
  servingGrams?: NumericInput | null;
  servingLabel?: string | null;
  values: NutrientMap;
  densityGPerMl?: Num | null;
  sourceRef?: string;
}

export class CustomFoodError extends Error {}

/** Parses typed label text, so a bad entry surfaces as a CustomFoodError rather than a raw DecimalError. */
function parseLabelNumber(value: NumericInput, what: string): Decimal {
  const parsed = tryDec(value);
  if (parsed === null) throw new CustomFoodError(`${what} is not a number`);
  return parsed;
}

export function customFoodFromLabel(input: CustomFoodInput): { food: CanonicalFood; quarantineReasons: string[] } {
  const name = input.name.trim();
  if (name === '') throw new CustomFoodError('a custom food needs a name');
  const codes: NutrientCode[] = nutrientCodesOf(input.values);
  if (codes.length === 0) throw new CustomFoodError('a custom food needs at least one nutrient value');

  const portions: CanonicalPortion[] = [];
  let factor = dec(1);
  if (input.basis === 'per_serving') {
    const servingGrams =
      input.servingGrams === null || input.servingGrams === undefined ? null : parseLabelNumber(input.servingGrams, 'the serving weight');
    if (servingGrams === null || !servingGrams.greaterThan(0)) {
      throw new CustomFoodError('per-serving values need a serving weight in grams');
    }
    factor = dec(100).div(servingGrams);
    portions.push({
      label: input.servingLabel?.trim() || `1 serving (${num(servingGrams)} g)`,
      gramWeight: num(servingGrams),
      source: 'user',
    });
  }

  const nutrients: CanonicalNutrient[] = codes.map((code) => ({
    code,
    amountPer100g: num(parseLabelNumber(input.values[code] as Num, code).times(factor)),
    derivation: input.basis === 'per_serving' ? 'converted' : 'reported',
  }));

  return {
    quarantineReasons: sanityCheck(nutrients),
    food: {
      kind: 'custom',
      name,
      brand: input.brand?.trim() || null,
      gtin: normalizeGtin(input.gtin),
      qualityTier: 'user',
      sourceRef: input.sourceRef ?? 'user',
      densityGPerMl: input.densityGPerMl ?? null,
      category: null,
      nutrients,
      portions,
    },
  };
}
