/**
 * The repository boundary. Screens parse what people type, but nothing below
 * this line trusts that they did: every number a repository writes is checked
 * and canonicalized here, so SQLite never holds a negative gram count or a
 * nutrient value the engine cannot read back. A rejected write throws
 * ValidationError before its transaction opens, so neither the row nor its
 * outbox record lands.
 */
import { isNutrientCode, num, tryDec, type NutrientMap, type Num } from '@nt/core';

export class ValidationError extends RangeError {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field} ${reason}`);
    this.name = 'ValidationError';
  }
}

export const WATER_ML_MIN = 1;
export const WATER_ML_MAX = 5000;
/** A daily water target, not a single drink, so it may exceed one entry's cap. */
export const WATER_TARGET_ML_MAX = 20000;

function decimalOf(field: string, value: unknown) {
  const parsed = typeof value === 'string' ? tryDec(value) : null;
  if (parsed === null) throw new ValidationError(field, 'must be a decimal string');
  return parsed;
}

/** A canonical decimal string ≥ 0. */
export function nonNegativeNum(field: string, value: unknown): Num {
  const parsed = decimalOf(field, value);
  if (parsed.isNegative()) throw new ValidationError(field, 'must not be negative');
  return num(parsed);
}

/** A canonical decimal string > 0. */
export function positiveNum(field: string, value: unknown): Num {
  const parsed = decimalOf(field, value);
  if (!parsed.greaterThan(0)) throw new ValidationError(field, 'must be greater than zero');
  return num(parsed);
}

/** Every key a nutrient code, every value a non-negative decimal; missing stays missing. */
export function nutrientMap(field: string, map: unknown): NutrientMap {
  if (map === null || typeof map !== 'object') throw new ValidationError(field, 'must be a nutrient map');
  const out: NutrientMap = {};
  for (const [code, value] of Object.entries(map as Record<string, unknown>)) {
    if (!isNutrientCode(code)) throw new ValidationError(`${field}.${code}`, 'is not a nutrient code');
    if (value === undefined) continue;
    if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) throw new ValidationError(`${field}.${code}`, 'must be a non-negative decimal string');
    out[code] = nonNegativeNum(`${field}.${code}`, value);
  }
  return out;
}

export function integerInRange(field: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(field, `must be a whole number from ${min} to ${max}`);
  }
  return value;
}

/** True when a stored value can be read as a non-negative decimal. */
export function isReadableNum(value: unknown): value is Num {
  const parsed = typeof value === 'string' ? tryDec(value) : null;
  return parsed !== null && !parsed.isNegative();
}

/** True when a stored value can be read as a decimal > 0 (a divisor, a weight). */
export function isReadablePositiveNum(value: unknown): value is Num {
  return isReadableNum(value) && tryDec(value)!.greaterThan(0);
}

/**
 * A stored value the engine cannot read is ignored on the way out, not thrown
 * on: one bad row (from an old build, a sync peer, a hand edit) must not make a
 * whole day unreadable. Only the location is logged — never the value.
 */
export function reportUnreadable(table: string, id: string, field: string): void {
  console.warn(`[db] ignored an unreadable value in ${table}.${field} for ${id}`);
}
