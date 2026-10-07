import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_PROMPT,
  MODEL_OUTPUT_SCHEMA,
  confidenceBand,
  findNutrientFields,
  modelResult,
  noNutrientFields,
  normalizePortion,
} from '../src/photo';

describe('confidenceBand', () => {
  it('uses inclusive lower edges for each band', () => {
    expect(confidenceBand(1)).toBe('likely');
    expect(confidenceBand(0.75)).toBe('likely');
    expect(confidenceBand(0.74)).toBe('possible');
    expect(confidenceBand(0.45)).toBe('possible');
    expect(confidenceBand(0.44)).toBe('unsure');
    expect(confidenceBand(0)).toBe('unsure');
  });
});

describe('findNutrientFields', () => {
  it('accepts a response with no nutrient fields', () => {
    const clean = { is_food: true, items: [{ label: 'white rice', portion_grams: { estimate: 150, low: 100, high: 200 } }] };
    expect(noNutrientFields(clean)).toBe(true);
  });

  it('finds nutrient keys at any depth, under any case, with the path', () => {
    const leaks = findNutrientFields({ items: [{ label: 'rice', Calories: 200, nested: { protein_g: 4 } }] });
    expect(leaks).toEqual([
      { path: 'items[0].Calories', value: '200' },
      { path: 'items[0].nested.protein_g', value: '4' },
    ]);
  });

  it('does not flag nutrient words that only appear in values', () => {
    expect(noNutrientFields({ items: [{ label: 'high protein bar' }] })).toBe(true);
  });
});

describe('modelResult', () => {
  const item = { label: 'rice', identification_confidence: 0.9, portion_grams: { estimate: 100, low: 80, high: 120 } };

  it('rejects unknown fields so a volunteered calorie count fails validation', () => {
    expect(modelResult.safeParse({ is_food: true, items: [item] }).success).toBe(true);
    expect(modelResult.safeParse({ is_food: true, items: [{ ...item, calories: 130 }] }).success).toBe(false);
    expect(modelResult.safeParse({ is_food: true, items: [], calories: 130 }).success).toBe(false);
  });

  it('rejects out-of-range portions and confidences', () => {
    const bad = (patch: object) => modelResult.safeParse({ is_food: true, items: [{ ...item, ...patch }] }).success;
    expect(bad({ identification_confidence: 1.1 })).toBe(false);
    expect(bad({ portion_grams: { estimate: 0, low: 0, high: 10 } })).toBe(false);
    expect(bad({ portion_grams: { estimate: 6000, low: 1, high: 6000 } })).toBe(false);
    expect(bad({ label: '' })).toBe(false);
  });
});

describe('model-facing definitions', () => {
  it('contain no nutrient field in the output schema', () => {
    expect(noNutrientFields(MODEL_OUTPUT_SCHEMA)).toBe(true);
  });

  it('tell the model not to state nutrients', () => {
    expect(ANALYSIS_PROMPT).toMatch(/Never state calories/);
  });
});

describe('normalizePortion', () => {
  it('leaves a consistent range alone', () => {
    const portion = normalizePortion({ estimate: 150, low: 100, high: 200 });
    expect(portion).toMatchObject({ estimate: '150', low: '100', high: '200', repaired: false });
  });

  it('widens the range when the estimate falls outside it', () => {
    expect(normalizePortion({ estimate: 50, low: 100, high: 200 })).toMatchObject({ low: '50', high: '200', repaired: true });
    expect(normalizePortion({ estimate: 300, low: 100, high: 200 })).toMatchObject({ low: '100', high: '300', repaired: true });
  });

  it('swaps an inverted range', () => {
    expect(normalizePortion({ estimate: 150, low: 200, high: 100 })).toMatchObject({ low: '100', high: '200' });
  });
});
