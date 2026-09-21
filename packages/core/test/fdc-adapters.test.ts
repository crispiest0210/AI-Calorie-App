import { describe, expect, it } from 'vitest';
import { fromFdcDetail, fromFdcSearchHit } from '../src/fdc-adapters';
import { normalizeFdcFood } from '../src/normalize';

describe('FDC wire shapes', () => {
  it('maps a search hit onto the neutral record', () => {
    expect(
      fromFdcSearchHit({
        fdcId: 1,
        description: 'Rice',
        dataType: 'SR Legacy',
        foodNutrients: [
          { nutrientId: 1008, unitName: 'KCAL', value: 123 },
          { nutrientId: 1003, unitName: 'G', value: null },
        ],
      }),
    ).toEqual({
      fdcId: 1,
      description: 'Rice',
      dataType: 'SR Legacy',
      brandOwner: null,
      brandName: null,
      gtinUpc: null,
      servingSize: null,
      servingSizeUnit: null,
      householdServingFullText: null,
      foodNutrients: [
        { nutrientId: 1008, amount: 123, unitName: 'KCAL' },
        { nutrientId: 1003, amount: null, unitName: 'G' },
      ],
    });
  });

  it('tolerates a hit with no nutrient array', () => {
    expect(fromFdcSearchHit({ fdcId: 1, description: 'x', dataType: 'Foundation' }).foodNutrients).toEqual([]);
  });

  it('maps a detail record, including the portions only it carries', () => {
    const record = fromFdcDetail({
      fdcId: 169704,
      description: 'Rice, brown, cooked',
      dataType: 'SR Legacy',
      brandOwner: 'x',
      foodNutrients: [
        { nutrient: { id: 1008, unitName: 'KCAL' }, amount: 123 },
        { nutrient: null, amount: 5 },
        { nutrient: { id: 1003, unitName: 'G' } },
      ],
      foodPortions: [
        { amount: 1, modifier: 'cooked', measureUnit: { name: 'cup' }, gramWeight: 202 },
        { portionDescription: '1 oz', gramWeight: 28.35 },
      ],
    });
    expect(record.foodNutrients).toEqual([
      { nutrientId: 1008, amount: 123, unitName: 'KCAL' },
      { nutrientId: 1003, amount: null, unitName: 'G' },
    ]);
    expect(record.foodPortions).toEqual([
      { amount: 1, modifier: 'cooked', portionDescription: null, measureUnitName: 'cup', gramWeight: 202 },
      { amount: null, modifier: null, portionDescription: '1 oz', measureUnitName: null, gramWeight: 28.35 },
    ]);
    expect(normalizeFdcFood(record).ok).toBe(true);
  });

  it('tolerates a detail record with neither nutrients nor portions', () => {
    const record = fromFdcDetail({ fdcId: 1, description: 'x', dataType: 'Foundation' });
    expect(record.foodNutrients).toEqual([]);
    expect(record.foodPortions).toEqual([]);
  });
});
