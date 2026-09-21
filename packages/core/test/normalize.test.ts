import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SANITY_LIMITS,
  QUALITY_TIER_BADGES,
  convertToCodeUnit,
  normalizeFdcFood,
  normalizeGtin,
  normalizeOffProduct,
  qualityTierForFdcDataType,
  sanityCheck,
  type FdcFoodRecord,
} from '../src/normalize';

const baseFdc: FdcFoodRecord = {
  fdcId: 169704,
  description: 'Rice, brown, long-grain, cooked',
  dataType: 'SR Legacy',
  foodNutrients: [
    { nutrientId: 1008, amount: 123, unitName: 'KCAL' },
    { nutrientId: 1003, amount: 2.74, unitName: 'G' },
    { nutrientId: 1004, amount: 0.97, unitName: 'G' },
    { nutrientId: 1005, amount: 25.6, unitName: 'G' },
    { nutrientId: 1093, amount: 4, unitName: 'MG' },
  ],
  foodPortions: [{ amount: 1, measureUnitName: 'cup', modifier: 'cooked', gramWeight: 202 }],
};

describe('unit conversion onto internal codes', () => {
  it('passes matching units straight through', () => {
    expect(convertToCodeUnit('2.7', 'G', 'protein_g')).toEqual({ value: '2.7', converted: false });
    expect(convertToCodeUnit('100', 'KCAL', 'energy_kcal')).toEqual({ value: '100', converted: false });
  });

  it('converts kJ, grams and micrograms', () => {
    expect(convertToCodeUnit('418.4', 'KJ', 'energy_kcal')).toEqual({ value: '100', converted: true });
    expect(convertToCodeUnit('0.5', 'G', 'sodium_mg')).toEqual({ value: '500', converted: true });
    expect(convertToCodeUnit('2000', 'MG', 'protein_g')).toEqual({ value: '2', converted: true });
    expect(convertToCodeUnit('1500', 'UG', 'iron_mg')).toEqual({ value: '1.5', converted: true });
    expect(convertToCodeUnit('1', 'MG', 'iron_mg')).toEqual({ value: '1', converted: false });
  });

  it('refuses units it cannot convert rather than guessing', () => {
    expect(convertToCodeUnit('10', 'IU', 'vitamin_c_mg')).toBeNull();
    expect(convertToCodeUnit('10', 'G', 'energy_kcal')).toBeNull();
  });
});

describe('gtin normalization', () => {
  it('pads to 14 digits so UPC and EAN compare equal', () => {
    expect(normalizeGtin('049000028911')).toBe('00049000028911');
    expect(normalizeGtin('3017620422003')).toBe('03017620422003');
    expect(normalizeGtin('0 49000 02891 1')).toBe('00049000028911');
  });

  it('rejects empty and oversized codes', () => {
    expect(normalizeGtin(null)).toBeNull();
    expect(normalizeGtin(undefined)).toBeNull();
    expect(normalizeGtin('abc')).toBeNull();
    expect(normalizeGtin('123456789012345')).toBeNull();
  });
});

describe('sanity checks', () => {
  it('passes a plausible food', () => {
    expect(sanityCheck([{ code: 'energy_kcal', amountPer100g: '123', derivation: 'reported' }])).toEqual([]);
  });

  it('quarantines impossible energy, impossible macros and negatives', () => {
    expect(sanityCheck([{ code: 'energy_kcal', amountPer100g: '1200', derivation: 'reported' }])[0]).toContain('exceeds 900');
    const macros = sanityCheck([
      { code: 'protein_g', amountPer100g: '60', derivation: 'reported' },
      { code: 'fat_g', amountPer100g: '30', derivation: 'reported' },
      { code: 'carb_g', amountPer100g: '30', derivation: 'reported' },
    ]);
    expect(macros[0]).toContain('exceeds 100 g');
    expect(sanityCheck([{ code: 'fiber_g', amountPer100g: '-1', derivation: 'reported' }])[0]).toContain('negative');
    expect(DEFAULT_SANITY_LIMITS.maxKcalPer100g).toBe(900);
  });
});

describe('normalizeFdcFood', () => {
  it('canonicalizes a generic SR Legacy record', () => {
    const result = normalizeFdcFood(baseFdc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food).toMatchObject({ kind: 'generic', qualityTier: 'lab', sourceRef: '169704', gtin: null });
    expect(result.food.nutrients[0]).toEqual({ code: 'energy_kcal', amountPer100g: '123', derivation: 'reported' });
    expect(result.food.portions).toEqual([{ label: '1 cup cooked', gramWeight: '202', source: 'fdc' }]);
    expect(result.warnings).toEqual([]);
  });

  it('maps data types to quality tiers and refuses unknown ones', () => {
    expect(qualityTierForFdcDataType('Foundation')).toBe('lab');
    expect(qualityTierForFdcDataType('Survey (FNDDS)')).toBe('survey');
    expect(qualityTierForFdcDataType('survey')).toBe('survey');
    expect(qualityTierForFdcDataType('Branded')).toBe('label');
    expect(qualityTierForFdcDataType('Experimental')).toBeNull();
    const result = normalizeFdcFood({ ...baseFdc, dataType: 'Experimental' });
    expect(result).toMatchObject({ ok: false, sourceRef: '169704' });
    expect(QUALITY_TIER_BADGES.crowd).toBe('Open Food Facts');
  });

  it('keeps the branded label serving as a portion', () => {
    const result = normalizeFdcFood({
      ...baseFdc,
      dataType: 'Branded',
      brandOwner: 'Acme Foods',
      gtinUpc: '049000028911',
      servingSize: 40,
      servingSizeUnit: 'g',
      householdServingFullText: '1 bar',
      foodPortions: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food).toMatchObject({ kind: 'branded', brand: 'Acme Foods', gtin: '00049000028911' });
    expect(result.food.portions).toEqual([{ label: '1 bar', gramWeight: '40', source: 'fdc' }]);
  });

  it('falls back to a generated serving label and prefers brandName over brandOwner', () => {
    const result = normalizeFdcFood({
      ...baseFdc,
      dataType: 'Branded',
      brandOwner: 'Acme Foods',
      brandName: 'Acme',
      servingSize: 55,
      foodPortions: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food.brand).toBe('Acme');
    expect(result.food.portions[0]!.label).toBe('1 serving (55 g)');
  });

  it('converts a per-serving branded record to per 100 g', () => {
    const result = normalizeFdcFood({
      ...baseFdc,
      dataType: 'Branded',
      nutrientBasis: 'per_serving',
      servingSize: 50,
      servingSizeUnit: 'g',
      foodPortions: [],
      foodNutrients: [
        { nutrientId: 1008, amount: 100, unitName: 'KCAL' },
        { nutrientId: 1003, amount: 5, unitName: 'G' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food.nutrients).toEqual([
      { code: 'energy_kcal', amountPer100g: '200', derivation: 'reported' },
      { code: 'protein_g', amountPer100g: '10', derivation: 'converted' },
    ]);
  });

  it('refuses a per-serving record with no gram serving size', () => {
    expect(normalizeFdcFood({ ...baseFdc, nutrientBasis: 'per_serving' })).toMatchObject({ ok: false });
    expect(normalizeFdcFood({ ...baseFdc, nutrientBasis: 'per_serving', servingSize: 50, servingSizeUnit: 'ml' })).toMatchObject({ ok: false });
  });

  it('derives energy from Atwater factors only when none is reported', () => {
    const result = normalizeFdcFood({
      ...baseFdc,
      foodNutrients: [
        { nutrientId: 1003, amount: 10, unitName: 'G' },
        { nutrientId: 1004, amount: 1, unitName: 'G' },
        { nutrientId: 1005, amount: 20, unitName: 'G' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food.nutrients[0]).toEqual({ code: 'energy_kcal', amountPer100g: '129', derivation: 'derived' });
  });

  it('leaves energy missing when only some macros are reported', () => {
    const result = normalizeFdcFood({
      ...baseFdc,
      foodNutrients: [
        { nutrientId: 1003, amount: 22, unitName: 'G' },
        { nutrientId: 1004, amount: 1.2, unitName: 'G' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food.nutrients.some((n) => n.code === 'energy_kcal')).toBe(false);
  });

  it('converts a kJ-only energy value', () => {
    const result = normalizeFdcFood({ ...baseFdc, foodNutrients: [{ nutrientId: 1062, amount: 418.4, unitName: 'KJ' }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food.nutrients[0]).toEqual({ code: 'energy_kcal', amountPer100g: '100', derivation: 'converted' });
  });

  it('warns rather than inventing a value when energy is missing entirely', () => {
    const result = normalizeFdcFood({ ...baseFdc, foodNutrients: [{ nutrientId: 1093, amount: 4, unitName: 'MG' }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContain('no energy value available');
    expect(result.food.nutrients.some((n) => n.code === 'energy_kcal')).toBe(false);
  });

  it('skips null amounts, untracked nutrients, duplicates and unconvertible units', () => {
    const result = normalizeFdcFood({
      ...baseFdc,
      foodNutrients: [
        { nutrientId: 1008, amount: 123, unitName: 'KCAL' },
        { nutrientId: 2048, amount: 999, unitName: 'KCAL' },
        { nutrientId: 1003, amount: null, unitName: 'G' },
        { nutrientId: 9999, amount: 1, unitName: 'G' },
        { nutrientId: 1093, amount: 4, unitName: 'MG' },
        { nutrientId: 1093, amount: 40, unitName: 'MG' },
        { nutrientId: 1162, amount: 10, unitName: 'IU' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food.nutrients).toEqual([
      { code: 'energy_kcal', amountPer100g: '123', derivation: 'reported' },
      { code: 'sodium_mg', amountPer100g: '4', derivation: 'reported' },
    ]);
    expect(result.warnings[0]).toContain('vitamin_c_mg');
  });

  it('drops a portion whose label is only a source code or a placeholder', () => {
    const result = normalizeFdcFood({
      ...baseFdc,
      foodPortions: [
        { portionDescription: '10043', gramWeight: 158 },
        { portionDescription: 'Quantity not specified', gramWeight: 145 },
        { amount: 1, modifier: '61479', gramWeight: 50 },
        { portionDescription: '1 hamburger', gramWeight: 145 },
      ],
    });
    expect(result.ok && result.food.portions).toEqual([{ label: '1 hamburger', gramWeight: '145', source: 'fdc' }]);
  });

  it('carries the source’s own food grouping through', () => {
    expect(normalizeFdcFood({ ...baseFdc, category: '  Burgers  ' })).toMatchObject({ food: { category: 'Burgers' } });
    expect(normalizeFdcFood({ ...baseFdc, category: '  ' })).toMatchObject({ food: { category: null } });
    expect(normalizeFdcFood(baseFdc)).toMatchObject({ food: { category: null } });
  });

  it('drops portions with no weight or no label', () => {
    const result = normalizeFdcFood({
      ...baseFdc,
      foodPortions: [
        { amount: 1, measureUnitName: 'cup', gramWeight: 0 },
        { amount: null, measureUnitName: 'undetermined', modifier: '', gramWeight: 50 },
        { portionDescription: '  1 slice  ', gramWeight: 28 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food.portions).toEqual([
      { label: '1 slice', gramWeight: '28', source: 'fdc' },
    ]);
  });

  it('records that a value had to be converted', () => {
    const result = normalizeFdcFood({
      ...baseFdc,
      foodNutrients: [
        { nutrientId: 2047, amount: 418.4, unitName: 'KJ' },
        { nutrientId: 1093, amount: 0.004, unitName: 'G' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food.nutrients).toEqual([
      { code: 'energy_kcal', amountPer100g: '100', derivation: 'converted' },
      { code: 'sodium_mg', amountPer100g: '4', derivation: 'converted' },
    ]);
  });

  it('assumes grams when a per-serving record omits the serving unit', () => {
    const result = normalizeFdcFood({
      ...baseFdc,
      nutrientBasis: 'per_serving',
      servingSize: 50,
      foodPortions: [],
      foodNutrients: [{ nutrientId: 1008, amount: 100, unitName: 'KCAL' }],
    });
    expect(result.ok && result.food.nutrients[0]!.amountPer100g).toBe('200');
  });

  it('labels a portion that gives a unit but no count', () => {
    const result = normalizeFdcFood({ ...baseFdc, foodPortions: [{ measureUnitName: 'tbsp', gramWeight: 15 }] });
    expect(result.ok && result.food.portions).toEqual([{ label: '1 tbsp', gramWeight: '15', source: 'fdc' }]);
  });

  it('quarantines an implausible record instead of serving it', () => {
    const result = normalizeFdcFood({ ...baseFdc, foodNutrients: [{ nutrientId: 1008, amount: 4000, unitName: 'KCAL' }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons[0]).toContain('exceeds 900');
  });
});

describe('normalizeOffProduct', () => {
  const product = {
    code: '3017620422003',
    product_name: 'Nutella',
    brands: 'Ferrero, Nutella',
    serving_size: '15 g',
    serving_quantity: 15,
    nutriments: {
      'energy-kcal_100g': 539,
      proteins_100g: 6.3,
      fat_100g: 30.9,
      carbohydrates_100g: 57.5,
      sugars_100g: 56.3,
      'saturated-fat_100g': 10.6,
      sodium_100g: 0.0428,
      fiber_100g: '',
    },
  };

  it('canonicalizes a product, converting mineral grams to milligrams', () => {
    const result = normalizeOffProduct(product);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food).toMatchObject({ kind: 'branded', qualityTier: 'crowd', brand: 'Ferrero', gtin: '03017620422003' });
    expect(result.food.nutrients).toContainEqual({ code: 'sodium_mg', amountPer100g: '42.8', derivation: 'converted' });
    expect(result.food.portions).toEqual([{ label: '15 g', gramWeight: '15', source: 'off_serving' }]);
  });

  it('derives sodium from salt when sodium is missing', () => {
    const result = normalizeOffProduct({
      ...product,
      nutriments: { 'energy-kcal_100g': 100, salt_100g: 1.25 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food.nutrients).toContainEqual({ code: 'sodium_mg', amountPer100g: '500', derivation: 'derived' });
    expect(result.warnings).toContain('sodium derived from salt');
  });

  it('falls back to kJ, then to nothing', () => {
    const kj = normalizeOffProduct({ code: '1', product_name: 'x', nutriments: { 'energy-kj_100g': 418.4 } });
    expect(kj.ok && kj.food.nutrients[0]).toEqual({ code: 'energy_kcal', amountPer100g: '100', derivation: 'converted' });
    const none = normalizeOffProduct({ code: '1', product_name: 'x', nutriments: {} });
    expect(none.ok && none.warnings).toContain('no energy value available');
    const noNutriments = normalizeOffProduct({ code: '1', product_name: 'x' });
    expect(noNutriments.ok && noNutriments.food.nutrients).toEqual([]);
  });

  it('refuses a nameless product and quarantines implausible ones', () => {
    expect(normalizeOffProduct({ code: '1' })).toMatchObject({ ok: false, reasons: ['product has no name'] });
    expect(normalizeOffProduct({ code: '1', product_name: '  ' })).toMatchObject({ ok: false });
    expect(normalizeOffProduct({ code: '1', product_name: 'x', nutriments: { 'energy-kcal_100g': 5000 } })).toMatchObject({ ok: false });
  });

  it('handles missing optional fields', () => {
    const result = normalizeOffProduct({ code: '1', product_name: 'Plain', nutriments: { 'energy-kcal_100g': 100 }, serving_quantity: null, brands: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.food.brand).toBeNull();
    expect(result.food.portions).toEqual([]);
  });

  it('builds a serving label when the product gives only a quantity', () => {
    const result = normalizeOffProduct({ code: '1', product_name: 'Plain', nutriments: {}, serving_quantity: 30 });
    expect(result.ok && result.food.portions[0]!.label).toBe('1 serving (30 g)');
    const zero = normalizeOffProduct({ code: '1', product_name: 'Plain', nutriments: {}, serving_quantity: 0 });
    expect(zero.ok && zero.food.portions).toEqual([]);
  });
});
