/**
 * Every nutrient number crosses a boundary (SQLite, sync payload, JSON) as a
 * *decimal string* and is computed as a Decimal. Floats are never used for
 * nutrient math, so two devices that see the same entries produce the same
 * totals bit for bit (review item R13).
 */
import Decimal from 'decimal.js';

const D = Decimal.clone({
  precision: 34,
  rounding: Decimal.ROUND_HALF_EVEN,
  // Wide exponent thresholds so toString() never emits scientific notation.
  toExpNeg: -30,
  toExpPos: 30,
});

export type { Decimal };

/** A decimal string as stored and synced, e.g. "12.5". */
export type Num = string;

export type NumericInput = Num | number | Decimal;

export class NumericError extends Error {
  constructor(value: unknown) {
    super(`Not a finite decimal value: ${String(value)}`);
    this.name = 'NumericError';
  }
}

/** Parses any accepted input into a Decimal, rejecting NaN/Infinity/garbage. */
export function dec(value: NumericInput): Decimal {
  const parsed = new D(value as Decimal.Value);
  if (!parsed.isFinite()) throw new NumericError(value);
  return parsed;
}

export function tryDec(value: NumericInput): Decimal | null {
  try {
    return dec(value);
  } catch {
    return null;
  }
}

/** Canonical storage form: a plain, unrounded, non-exponential decimal string. */
export function num(value: NumericInput): Num {
  return dec(value).toFixed();
}

export function add(a: NumericInput, b: NumericInput): Decimal {
  return dec(a).plus(dec(b));
}

export function mul(a: NumericInput, b: NumericInput): Decimal {
  return dec(a).times(dec(b));
}

export function div(a: NumericInput, b: NumericInput): Decimal {
  const divisor = dec(b);
  if (divisor.isZero()) throw new NumericError(`division by zero`);
  return dec(a).div(divisor);
}

export function sum(values: readonly NumericInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new D(0));
}

export function isPositive(value: NumericInput): boolean {
  return dec(value).greaterThan(0);
}

export function compare(a: NumericInput, b: NumericInput): -1 | 0 | 1 {
  return dec(a).comparedTo(dec(b)) as -1 | 0 | 1;
}

export const ZERO: Num = '0';
