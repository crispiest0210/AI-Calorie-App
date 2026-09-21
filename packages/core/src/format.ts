/**
 * Display rounding lives here and nowhere else (spec 2.6.7): values are stored
 * and summed unrounded, and only the strings on screen are rounded.
 */
import Decimal from 'decimal.js';
import { dec, type Num, type NumericInput } from './decimal';
import { NUTRIENT_DEFS, type NutrientCode } from './nutrients';
import type { AmountUnit } from './units';

const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** Decimal places a code is shown with; grams gain a decimal below 10 g. */
export function displayDecimals(code: NutrientCode, value: NumericInput): number {
  const unit = NUTRIENT_DEFS[code].unit;
  if (unit === 'g') return dec(value).abs().lessThan(10) ? 1 : 0;
  return 0;
}

export function roundForDisplay(value: NumericInput, code: NutrientCode): number {
  return dec(value).toDecimalPlaces(displayDecimals(code, value), Decimal.ROUND_HALF_EVEN).toNumber();
}

export function formatNutrient(value: NumericInput | null | undefined, code: NutrientCode): string {
  if (value === null || value === undefined) return '—';
  return GROUPED.format(roundForDisplay(value, code));
}

export function formatWithUnit(value: NumericInput | null | undefined, code: NutrientCode): string {
  const unit = NUTRIENT_DEFS[code].displayUnit;
  return value === null || value === undefined ? '—' : `${formatNutrient(value, code)} ${unit}`;
}

export function formatEnergy(kcal: NumericInput | null | undefined): string {
  return formatNutrient(kcal, 'energy_kcal');
}

/** Grams as entered in the Amount step: 0.1 precision below 10 g, whole numbers above. */
export function formatGrams(grams: NumericInput | null | undefined): string {
  if (grams === null || grams === undefined) return '—';
  const d = dec(grams);
  const places = d.abs().lessThan(10) ? 1 : 0;
  return GROUPED.format(d.toDecimalPlaces(places, Decimal.ROUND_HALF_EVEN).toNumber());
}

export function formatMl(ml: NumericInput | null | undefined): string {
  return ml === null || ml === undefined ? '—' : GROUPED.format(dec(ml).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toNumber());
}

export function formatAmount(value: NumericInput, unit: AmountUnit, portionLabel?: string): string {
  switch (unit) {
    case 'g':
      return `${formatGrams(value)} g`;
    case 'ml':
      return `${formatMl(value)} mL`;
    case 'kcal':
      return `${formatEnergy(value)} cal`;
    case 'portion':
      return `${formatGrams(value)} × ${portionLabel ?? 'portion'}`;
  }
}

/** An en dash range, e.g. "520–780 cal" for an unconfirmed photo draft. */
export function formatRange(low: NumericInput, high: NumericInput, code: NutrientCode): string {
  const unit = NUTRIENT_DEFS[code].displayUnit;
  return `${formatNutrient(low, code)}–${formatNutrient(high, code)} ${unit}`;
}

/** Text alternative for the energy ring (spec 5.6). */
export function energyA11yLabel(consumed: NumericInput, target: NumericInput | null, remaining: NumericInput | null): string {
  if (target === null || remaining === null) return `Energy: ${formatEnergy(consumed)} cal, no target set`;
  const remainingD = dec(remaining);
  const tail = remainingD.isNegative()
    ? `${formatEnergy(remainingD.abs())} over`
    : `${formatEnergy(remainingD)} remaining`;
  return `Energy: ${formatEnergy(consumed)} of ${formatEnergy(target)} cal, ${tail}`;
}

/** Neutral copy for a goal overshoot — no shaming (spec 5.7). */
export function overBySummary(remaining: Num, code: NutrientCode): string | null {
  const d = dec(remaining);
  if (!d.isNegative()) return null;
  return `${formatWithUnit(d.abs(), code)} over`;
}
