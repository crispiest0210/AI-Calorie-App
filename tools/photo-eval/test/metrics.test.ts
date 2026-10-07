/**
 * The harness has to be trustworthy before any number it produces means
 * anything, so the scoring is tested directly — including the two gates that
 * must never pass: a response that fails the schema, and one carrying a
 * nutrient value.
 */
import { describe, expect, it } from 'vitest';
import { compareToBaseline, median, percentile, scoreMeal, summarize, type EvalReport, type MealOutcome } from '../src/metrics';
import type { LabeledMeal } from '../src/types';

const MEAL: LabeledMeal = {
  id: 'meal-1',
  isFood: true,
  items: [
    { foodId: 'rice', grams: 100 },
    { foodId: 'chicken', grams: 200 },
  ],
};

const item = (label: string, estimate: number, low = estimate * 0.8, high = estimate * 1.2) => ({
  label,
  identification_confidence: 0.8,
  portion_grams: { estimate, low, high },
});

const score = (raw: unknown, candidates: Record<string, string[]> = {}) =>
  scoreMeal({
    meal: MEAL,
    raw,
    latencyMs: 1000,
    candidatesFor: (label) => candidates[label] ?? [],
  });

describe('statistics', () => {
  it('computes medians and percentiles, including the empty case', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('scoring a meal', () => {
  it('credits a top-1 match and measures the gram error against the weighed truth', () => {
    const outcome = score({ is_food: true, items: [item('white rice', 120)] }, { 'white rice': ['rice', 'other'] });
    const scored = outcome.items[0]!;
    expect(scored.top1).toBe(true);
    expect(scored.top3).toBe(true);
    expect(scored.expectedGrams).toBe(100);
    expect(scored.absolutePercentageError).toBeCloseTo(0.2, 10);
  });

  it('credits top-3 without top-1 when the right food is not first', () => {
    const outcome = score({ is_food: true, items: [item('white rice', 100)] }, { 'white rice': ['wrong', 'other', 'rice'] });
    expect(outcome.items[0]!.top1).toBe(false);
    expect(outcome.items[0]!.top3).toBe(true);
  });

  it('counts an item the matcher could not place as unmatched, not as wrong', () => {
    const outcome = score({ is_food: true, items: [item('mystery sauce', 30)] });
    expect(outcome.items[0]!.matched).toBe(false);
    expect(outcome.items[0]!.top3).toBe(false);
    expect(outcome.extraItems).toBe(1);
    expect(outcome.missedItems).toBe(2);
  });

  it('counts foods the model never mentioned', () => {
    const outcome = score({ is_food: true, items: [item('white rice', 100)] }, { 'white rice': ['rice'] });
    expect(outcome.missedItems).toBe(1);
    expect(outcome.extraItems).toBe(0);
  });

  it('never credits the same labeled food to two model items', () => {
    const outcome = score(
      { is_food: true, items: [item('rice', 60), item('more rice', 60)] },
      { rice: ['rice'], 'more rice': ['rice'] },
    );
    expect(outcome.items.filter((i) => i.expectedFoodId === 'rice')).toHaveLength(1);
    expect(outcome.extraItems).toBe(1);
  });

  it('records whether the stated range actually contained the truth', () => {
    const covered = score({ is_food: true, items: [item('white rice', 120, 90, 150)] }, { 'white rice': ['rice'] });
    expect(covered.items[0]!.rangeCovered).toBe(true);
    const missed = score({ is_food: true, items: [item('white rice', 140, 130, 150)] }, { 'white rice': ['rice'] });
    expect(missed.items[0]!.rangeCovered).toBe(false);
  });

  it('repairs a range that does not contain the model’s own estimate', () => {
    const outcome = score({ is_food: true, items: [item('white rice', 100, 150, 200)] }, { 'white rice': ['rice'] });
    expect(outcome.items[0]!.rangeCovered).toBe(true);
  });

  it('fails a response that does not validate, and blames nothing else on it', () => {
    const outcome = score({ is_food: true, items: [{ label: 'rice' }] });
    expect(outcome.schemaValid).toBe(false);
    expect(outcome.items).toEqual([]);
    expect(outcome.missedItems).toBe(2);
  });

  it('catches a nutrient value anywhere in the response', () => {
    const outcome = score({
      is_food: true,
      items: [{ ...item('white rice', 100), calories: 205 }],
    });
    expect(outcome.nutrientLeaks.map((leak) => leak.path)).toContain('items[0].calories');
  });

  it('notices when the model calls a photo of a bicycle food', () => {
    expect(score({ is_food: true, items: [] }).isFoodCorrect).toBe(true);
    expect(score({ is_food: false, items: [] }).isFoodCorrect).toBe(false);
  });
});

describe('summary and regression gate', () => {
  const report = (overrides: Partial<EvalReport>): EvalReport => ({
    setName: 's', model: 'm', promptVersion: 'p', meals: 1, items: 1,
    top1Accuracy: 0.8, top3Accuracy: 0.9, unmatchedRate: 0.05, gramsMdAPE: 0.2,
    rangeCoverage: 0.9, schemaViolations: 0, nutrientFieldViolations: 0, isFoodErrors: 0,
    extraItems: 0, missedItems: 0, latencyP50Ms: 1, latencyP95Ms: 2, outcomes: [],
    ...overrides,
  });

  it('summarises outcomes into the headline numbers', () => {
    const outcomes: MealOutcome[] = [
      score({ is_food: true, items: [item('white rice', 110)] }, { 'white rice': ['rice'] }),
      score({ is_food: true, items: [item('mystery', 50)] }),
    ];
    const summary = summarize({ setName: 's', model: 'm', promptVersion: 'p', outcomes });
    expect(summary.items).toBe(2);
    expect(summary.top1Accuracy).toBe(0.5);
    expect(summary.unmatchedRate).toBe(0.5);
    expect(summary.gramsMdAPE).toBeCloseTo(0.1, 10);
  });

  it('fails outright on a schema violation or a nutrient leak, baseline or not', () => {
    expect(compareToBaseline(report({ schemaViolations: 1 }), null).passed).toBe(false);
    expect(compareToBaseline(report({ nutrientFieldViolations: 1 }), null).failures[0]).toContain('AI boundary leaked');
  });

  it('passes a first run with no baseline to compare against', () => {
    expect(compareToBaseline(report({}), null).passed).toBe(true);
  });

  it('fails a drop of more than three points and tolerates less', () => {
    const baseline = report({ top1Accuracy: 0.8 });
    expect(compareToBaseline(report({ top1Accuracy: 0.74 }), baseline).passed).toBe(false);
    expect(compareToBaseline(report({ top1Accuracy: 0.78 }), baseline).passed).toBe(true);
    expect(compareToBaseline(report({ top1Accuracy: 0.9 }), baseline).passed).toBe(true);
  });

  it('fails a gram estimate that got worse', () => {
    const verdict = compareToBaseline(report({ gramsMdAPE: 0.3 }), report({ gramsMdAPE: 0.2 }));
    expect(verdict.passed).toBe(false);
    expect(verdict.failures[0]).toContain('gram error rose');
  });
});
