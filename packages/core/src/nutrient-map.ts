/**
 * A nutrient map holds decimal strings keyed by internal code. A missing key
 * means "the source does not report it" — never zero (spec 2.6.6).
 */
import { dec, num, tryDec, type Num, type NumericInput } from './decimal';
import { NUTRIENT_CODES, type NutrientCode, isNutrientCode } from './nutrients';

export type NutrientMap = Partial<Record<NutrientCode, Num>>;

export function nutrientCodesOf(map: NutrientMap): NutrientCode[] {
  return NUTRIENT_CODES.filter((code) => map[code] !== undefined && map[code] !== null);
}

/**
 * Narrows and normalizes an untrusted `{code: value}` object (e.g. a JSON column).
 * A value that is not a non-negative decimal is dropped, never thrown on: the
 * code then reads as missing, so totals mark it incomplete instead of one bad
 * row making a whole day unreadable. `onInvalid` hears about each one.
 */
export function parseNutrientMap(raw: unknown, onInvalid?: (code: NutrientCode, value: unknown) => void): NutrientMap {
  const out: NutrientMap = {};
  if (raw === null || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isNutrientCode(key)) continue;
    if (value === null || value === undefined) continue;
    const parsed = typeof value === 'string' || typeof value === 'number' ? tryDec(value) : null;
    if (parsed === null || parsed.isNegative()) {
      onInvalid?.(key, value);
      continue;
    }
    out[key] = num(parsed);
  }
  return out;
}

/** per-100 g map × grams ÷ 100, key by key. */
export function scalePer100g(per100g: NutrientMap, grams: NumericInput): NutrientMap {
  const factor = dec(grams).div(100);
  const out: NutrientMap = {};
  for (const code of nutrientCodesOf(per100g)) {
    out[code] = num(dec(per100g[code] as Num).times(factor));
  }
  return out;
}

/** Multiplies every value by a scalar (used by recipe math). */
export function scaleMap(map: NutrientMap, factor: NumericInput): NutrientMap {
  const f = dec(factor);
  const out: NutrientMap = {};
  for (const code of nutrientCodesOf(map)) {
    out[code] = num(dec(map[code] as Num).times(f));
  }
  return out;
}

export function mapToJson(map: NutrientMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const code of nutrientCodesOf(map)) out[code] = map[code] as Num;
  return out;
}
