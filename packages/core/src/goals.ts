/**
 * Goals are dated profiles (spec 3.5): editing goals writes a new profile from
 * today, so a past day is always read against the goals that applied then.
 * Percent-of-energy macro targets resolve to grams at display time.
 */
import { dec, num, type Num } from './decimal';
import { ATWATER_FACTORS, type MacroCode, type NutrientCode } from './nutrients';
import type { NutrientTotals } from './totals';

export const GOAL_KINDS = ['target', 'min', 'max', 'range'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const GOAL_BASES = ['absolute', 'pct_energy'] as const;
export type GoalBasis = (typeof GOAL_BASES)[number];

export interface GoalTarget {
  nutrientCode: NutrientCode;
  kind: GoalKind;
  value?: Num | null;
  valueLow?: Num | null;
  valueHigh?: Num | null;
  basis: GoalBasis;
}

export interface GoalProfile {
  id: string;
  /** Local date (YYYY-MM-DD) this profile starts applying. */
  effectiveFrom: string;
  waterTargetMl: number | null;
  targets: readonly GoalTarget[];
}

/** The profile in force on a local date: the latest one starting on or before it. */
export function profileForDate(profiles: readonly GoalProfile[], localDate: string): GoalProfile | null {
  let best: GoalProfile | null = null;
  for (const profile of profiles) {
    if (profile.effectiveFrom > localDate) continue;
    if (best === null || profile.effectiveFrom > best.effectiveFrom) best = profile;
  }
  return best;
}

function isMacro(code: NutrientCode): code is MacroCode {
  return Object.prototype.hasOwnProperty.call(ATWATER_FACTORS, code);
}

export interface ResolvedTarget {
  nutrientCode: NutrientCode;
  kind: GoalKind;
  /** Absolute values in the nutrient's own unit; null when it does not apply. */
  value: Num | null;
  low: Num | null;
  high: Num | null;
  basis: GoalBasis;
  /** True when grams were computed from a percent of the energy target. */
  derivedFromPercent: boolean;
}

function pctToGrams(pct: Num, energyKcal: Num, code: MacroCode): Num {
  return num(dec(pct).div(100).times(dec(energyKcal)).div(ATWATER_FACTORS[code]));
}

/**
 * Turns a stored target into absolute units. A pct_energy target on a non-macro,
 * or with no energy target to anchor it, resolves to nulls rather than a guess.
 */
export function resolveTarget(target: GoalTarget, energyTargetKcal: Num | null): ResolvedTarget {
  const base: ResolvedTarget = {
    nutrientCode: target.nutrientCode,
    kind: target.kind,
    value: target.value ?? null,
    low: target.valueLow ?? null,
    high: target.valueHigh ?? null,
    basis: target.basis,
    derivedFromPercent: false,
  };
  if (target.basis === 'absolute') return base;
  const code = target.nutrientCode;
  if (!isMacro(code) || energyTargetKcal === null) {
    return { ...base, value: null, low: null, high: null };
  }
  return {
    ...base,
    value: base.value === null ? null : pctToGrams(base.value, energyTargetKcal, code),
    low: base.low === null ? null : pctToGrams(base.low, energyTargetKcal, code),
    high: base.high === null ? null : pctToGrams(base.high, energyTargetKcal, code),
    derivedFromPercent: true,
  };
}

export function energyTargetOf(profile: GoalProfile | null): Num | null {
  if (profile === null) return null;
  const energy = profile.targets.find((t) => t.nutrientCode === 'energy_kcal');
  if (energy === undefined) return null;
  return energy.value ?? null;
}

export function resolveProfile(profile: GoalProfile | null): ResolvedTarget[] {
  if (profile === null) return [];
  const energy = energyTargetOf(profile);
  return profile.targets.map((t) => resolveTarget(t, energy));
}

export type GoalState = 'under_target' | 'at_target' | 'over_target' | 'unknown';

export interface GoalProgress {
  nutrientCode: NutrientCode;
  kind: GoalKind;
  consumed: Num;
  /** The number the ring or bar fills toward: value, low (min) or high (max/range). */
  reference: Num | null;
  remaining: Num | null;
  /** consumed ÷ reference, unclamped, so 1.2 means 20% over. null when no reference. */
  ratio: number | null;
  state: GoalState;
  derivedFromPercent: boolean;
  /** Some entry did not report this nutrient, so `consumed` is a floor, not a total. */
  incomplete: boolean;
}

function referenceFor(target: ResolvedTarget): Num | null {
  switch (target.kind) {
    case 'target':
      return target.value;
    case 'min':
      return target.low;
    case 'max':
      return target.high;
    case 'range':
      return target.high ?? target.low;
  }
}

export function goalProgress(totals: NutrientTotals, target: ResolvedTarget): GoalProgress {
  const consumed = totals.values[target.nutrientCode] ?? '0';
  const reference = referenceFor(target);
  const incomplete = totals.incomplete.includes(target.nutrientCode);

  if (reference === null) {
    return {
      nutrientCode: target.nutrientCode,
      kind: target.kind,
      consumed,
      reference: null,
      remaining: null,
      ratio: null,
      state: 'unknown',
      derivedFromPercent: target.derivedFromPercent,
      incomplete,
    };
  }

  const consumedD = dec(consumed);
  const referenceD = dec(reference);
  const remaining = num(referenceD.minus(consumedD));
  const ratio = referenceD.isZero() ? null : consumedD.div(referenceD).toNumber();

  let state: GoalState;
  if (target.kind === 'range' && target.low !== null && consumedD.lessThan(dec(target.low))) {
    state = 'under_target';
  } else if (consumedD.greaterThan(referenceD)) {
    state = 'over_target';
  } else if (consumedD.equals(referenceD)) {
    state = 'at_target';
  } else {
    state = 'under_target';
  }

  return {
    nutrientCode: target.nutrientCode,
    kind: target.kind,
    consumed,
    reference,
    remaining,
    ratio,
    state,
    derivedFromPercent: target.derivedFromPercent,
    incomplete,
  };
}

export function progressForProfile(totals: NutrientTotals, profile: GoalProfile | null): GoalProgress[] {
  return resolveProfile(profile).map((target) => goalProgress(totals, target));
}

export interface WaterProgress {
  consumedMl: number;
  targetMl: number | null;
  remainingMl: number | null;
  ratio: number | null;
}

export function waterProgress(consumedMl: number, targetMl: number | null): WaterProgress {
  if (targetMl === null || targetMl <= 0) {
    return { consumedMl, targetMl: null, remainingMl: null, ratio: null };
  }
  return {
    consumedMl,
    targetMl,
    remainingMl: targetMl - consumedMl,
    ratio: consumedMl / targetMl,
  };
}
