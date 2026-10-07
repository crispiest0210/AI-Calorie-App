/**
 * The scores a model or prompt change is judged on (spec 6.1, AI evaluation).
 *
 * Two of these are gates rather than metrics: a schema violation and a nutrient
 * field in the output are both zero-tolerance, because the first means the app
 * shows nothing and the second means the AI boundary leaked.
 */
import { findNutrientFields, modelResult, normalizePortion } from '@nt/core';
import type { LabeledMeal } from './types';

export interface ItemOutcome {
  mealId: string;
  /** The label the model produced, for reading failures. */
  label: string;
  /** Catalog id the labeller says is right. */
  expectedFoodId: string | null;
  /** Ids the matcher offered, best first. */
  candidateIds: string[];
  matched: boolean;
  top1: boolean;
  top3: boolean;
  expectedGrams: number | null;
  estimatedGrams: number | null;
  /** |estimate − truth| ÷ truth. */
  absolutePercentageError: number | null;
  /** True when the model's own low–high range contained the real weight. */
  rangeCovered: boolean | null;
}

export interface MealOutcome {
  mealId: string;
  schemaValid: boolean;
  schemaError: string | null;
  nutrientLeaks: { path: string; value: string }[];
  isFoodCorrect: boolean;
  /** Model items that no labeled item accounts for, and vice versa. */
  extraItems: number;
  missedItems: number;
  items: ItemOutcome[];
  latencyMs: number | null;
}

export interface EvalReport {
  setName: string;
  model: string;
  promptVersion: string;
  meals: number;
  items: number;
  /** Share of items whose first candidate is the right food. */
  top1Accuracy: number;
  top3Accuracy: number;
  unmatchedRate: number;
  /** Median absolute percentage error of the gram estimate. */
  gramsMdAPE: number | null;
  /** Share of items whose stated range contained the true weight. */
  rangeCoverage: number | null;
  schemaViolations: number;
  nutrientFieldViolations: number;
  isFoodErrors: number;
  extraItems: number;
  missedItems: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  outcomes: MealOutcome[];
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

/** Matches model items to labeled items so the two can be compared at all. */
export interface MatchedPair {
  labeled: LabeledMeal['items'][number];
  candidateIds: string[];
  label: string;
  estimatedGrams: number;
  low: number;
  high: number;
}

export function scoreMeal(input: {
  meal: LabeledMeal;
  raw: unknown;
  latencyMs: number | null;
  /** Candidate ids the matcher produced for each model item, in order. */
  candidatesFor: (label: string, preparation: string | undefined) => string[];
}): MealOutcome {
  const parsed = modelResult.safeParse(input.raw);
  const nutrientLeaks = findNutrientFields(input.raw);

  if (!parsed.success) {
    return {
      mealId: input.meal.id,
      schemaValid: false,
      schemaError: parsed.error.issues[0]?.message ?? 'invalid',
      nutrientLeaks,
      isFoodCorrect: false,
      extraItems: 0,
      missedItems: input.meal.items.length,
      items: [],
      latencyMs: input.latencyMs,
    };
  }

  const result = parsed.data;
  const isFoodCorrect = result.is_food === input.meal.isFood;

  /*
   * Each model item is paired with the labeled item it most likely refers to:
   * the first labeled food that appears among its candidates. Anything left
   * over on either side is counted rather than silently dropped — a model that
   * sees three foods where there is one is wrong in a way accuracy hides.
   */
  const unclaimed = new Set(input.meal.items.map((item) => item.foodId));
  const items: ItemOutcome[] = [];

  for (const modelItem of result.items) {
    const candidateIds = input.candidatesFor(modelItem.label, modelItem.preparation);
    const portion = normalizePortion(modelItem.portion_grams);
    const estimate = Number.parseFloat(portion.estimate);

    const hit = candidateIds.find((id) => unclaimed.has(id)) ?? null;
    const expected = hit === null ? null : input.meal.items.find((item) => item.foodId === hit)!;
    if (hit !== null) unclaimed.delete(hit);

    const expectedGrams = expected?.grams ?? null;
    items.push({
      mealId: input.meal.id,
      label: modelItem.label,
      expectedFoodId: hit,
      candidateIds,
      matched: candidateIds.length > 0,
      top1: hit !== null && candidateIds[0] === hit,
      top3: hit !== null && candidateIds.slice(0, 3).includes(hit),
      expectedGrams,
      estimatedGrams: estimate,
      absolutePercentageError: expectedGrams === null ? null : Math.abs(estimate - expectedGrams) / expectedGrams,
      rangeCovered:
        expectedGrams === null
          ? null
          : expectedGrams >= Number.parseFloat(portion.low) && expectedGrams <= Number.parseFloat(portion.high),
    });
  }

  return {
    mealId: input.meal.id,
    schemaValid: true,
    schemaError: null,
    nutrientLeaks,
    isFoodCorrect,
    extraItems: items.filter((item) => item.expectedFoodId === null).length,
    missedItems: unclaimed.size,
    items,
    latencyMs: input.latencyMs,
  };
}

export function summarize(input: {
  setName: string;
  model: string;
  promptVersion: string;
  outcomes: MealOutcome[];
}): EvalReport {
  const { outcomes } = input;
  const items = outcomes.flatMap((outcome) => outcome.items);
  const withTruth = items.filter((item) => item.expectedGrams !== null);
  const latencies = outcomes.map((o) => o.latencyMs).filter((ms): ms is number => ms !== null);
  const share = (count: number, total: number) => (total === 0 ? 0 : count / total);

  return {
    setName: input.setName,
    model: input.model,
    promptVersion: input.promptVersion,
    meals: outcomes.length,
    items: items.length,
    top1Accuracy: share(items.filter((i) => i.top1).length, items.length),
    top3Accuracy: share(items.filter((i) => i.top3).length, items.length),
    unmatchedRate: share(items.filter((i) => !i.matched).length, items.length),
    gramsMdAPE: median(withTruth.map((i) => i.absolutePercentageError!)),
    rangeCoverage: withTruth.length === 0 ? null : share(withTruth.filter((i) => i.rangeCovered).length, withTruth.length),
    schemaViolations: outcomes.filter((o) => !o.schemaValid).length,
    nutrientFieldViolations: outcomes.filter((o) => o.nutrientLeaks.length > 0).length,
    isFoodErrors: outcomes.filter((o) => !o.isFoodCorrect).length,
    extraItems: outcomes.reduce((sum, o) => sum + o.extraItems, 0),
    missedItems: outcomes.reduce((sum, o) => sum + o.missedItems, 0),
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    outcomes,
  };
}

/** Spec 6.1: no regression greater than 3 points, and zero on the two gates. */
export interface RegressionVerdict {
  passed: boolean;
  failures: string[];
}

export const REGRESSION_TOLERANCE = 0.03;

export function compareToBaseline(current: EvalReport, baseline: EvalReport | null): RegressionVerdict {
  const failures: string[] = [];

  if (current.schemaViolations > 0) failures.push(`${current.schemaViolations} responses failed schema validation`);
  if (current.nutrientFieldViolations > 0) {
    failures.push(`${current.nutrientFieldViolations} responses contained a nutrient field — the AI boundary leaked`);
  }
  if (baseline === null) return { passed: failures.length === 0, failures };

  const dropped = (name: string, now: number, before: number) => {
    if (before - now > REGRESSION_TOLERANCE) {
      failures.push(`${name} fell from ${(before * 100).toFixed(1)}% to ${(now * 100).toFixed(1)}%`);
    }
  };
  dropped('top-1 accuracy', current.top1Accuracy, baseline.top1Accuracy);
  dropped('top-3 accuracy', current.top3Accuracy, baseline.top3Accuracy);
  dropped('unmatched rate', 1 - current.unmatchedRate, 1 - baseline.unmatchedRate);

  if (current.gramsMdAPE !== null && baseline.gramsMdAPE !== null && current.gramsMdAPE - baseline.gramsMdAPE > REGRESSION_TOLERANCE) {
    failures.push(`gram error rose from ${(baseline.gramsMdAPE * 100).toFixed(1)}% to ${(current.gramsMdAPE * 100).toFixed(1)}%`);
  }
  return { passed: failures.length === 0, failures };
}
