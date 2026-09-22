import { describe, expect, it } from 'vitest';
import { availableUnits, defaultAmount, gramsToUnit, resolveGrams, type FoodMeasureInfo } from '../src/units';

const cup = { id: 'p1', label: '1 cup, cooked', gramWeight: '158', source: 'fdc' as const };
const rice: FoodMeasureInfo = { densityGPerMl: null, portions: [cup] };
const milk: FoodMeasureInfo = { densityGPerMl: '1.03', portions: [] };

describe('resolveGrams', () => {
  it('passes grams through', () => {
    expect(resolveGrams({ value: '150', unit: 'g' }, rice)).toEqual({ ok: true, grams: '150', provenance: 'user' });
  });

  it('uses density for mL and refuses when there is none', () => {
    expect(resolveGrams({ value: '200', unit: 'ml' }, milk)).toEqual({ ok: true, grams: '206', provenance: 'user' });
    expect(resolveGrams({ value: '200', unit: 'ml' }, rice)).toEqual({ ok: false, reason: 'density_unknown' });
  });

  it('multiplies household portions by their gram weight', () => {
    expect(resolveGrams({ value: '2', unit: 'portion', portionId: 'p1' }, rice)).toEqual({ ok: true, grams: '316', provenance: 'portion' });
    expect(resolveGrams({ value: '1', unit: 'portion', portionId: 'nope' }, rice)).toEqual({ ok: false, reason: 'portion_unknown' });
    expect(resolveGrams({ value: '1', unit: 'portion' }, rice)).toEqual({ ok: false, reason: 'portion_unknown' });
  });

  it('refuses non-positive amounts and energy units', () => {
    expect(resolveGrams({ value: '0', unit: 'g' }, rice)).toEqual({ ok: false, reason: 'amount_not_positive' });
    expect(resolveGrams({ value: '-1', unit: 'g' }, rice)).toEqual({ ok: false, reason: 'amount_not_positive' });
    expect(resolveGrams({ value: '250', unit: 'kcal' }, rice)).toEqual({ ok: false, reason: 'energy_unit_needs_quick_add' });
  });
});

describe('unit pickers', () => {
  it('offers only units the food supports, servings first', () => {
    expect(availableUnits(rice)).toEqual(['portion', 'g']);
    expect(availableUnits(milk)).toEqual(['g', 'ml']);
    expect(availableUnits({ densityGPerMl: null, portions: [] })).toEqual(['g']);
  });

  it('opens on the source’s serving, and falls back to grams', () => {
    expect(defaultAmount(rice)).toEqual({ unit: 'portion', portionId: 'p1', value: '1' });
    expect(defaultAmount(milk)).toEqual({ unit: 'g', portionId: null, value: '100' });
    expect(defaultAmount({ densityGPerMl: null, portions: [] })).toEqual({ unit: 'g', portionId: null, value: '100' });
  });

  it('converts grams back for the amount field', () => {
    expect(gramsToUnit('316', 'portion', rice, 'p1')).toBe('2');
    expect(gramsToUnit('316', 'portion', rice, 'nope')).toBeNull();
    expect(gramsToUnit('206', 'ml', milk)).toBe('200');
    expect(gramsToUnit('206', 'ml', rice)).toBeNull();
    expect(gramsToUnit('150', 'g', rice)).toBe('150');
    expect(gramsToUnit('150', 'kcal', rice)).toBeNull();
  });
});
