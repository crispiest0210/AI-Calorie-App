/**
 * Provider records → one canonical form: nutrients per 100 g, internal codes,
 * portions only from the source's own portion table (spec 2.6). Anything that
 * fails a sanity check is quarantined rather than served.
 */
import { dec, num, type Num } from './decimal';
import { codeForFdcNutrientId, type Derivation, type NutrientCode } from './nutrients';
import { NUTRIENT_DEFS } from './nutrients';
import { resolveEnergy } from './energy';
import type { NutrientMap } from './nutrient-map';

export const QUALITY_TIERS = ['lab', 'survey', 'label', 'crowd', 'user', 'computed'] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

export const QUALITY_TIER_BADGES: Record<QualityTier, string> = {
  lab: 'USDA',
  survey: 'USDA survey',
  label: 'Label (USDA)',
  crowd: 'Open Food Facts',
  user: 'You',
  computed: 'Recipe',
};

export const FOOD_KINDS = ['generic', 'branded', 'custom', 'recipe'] as const;
export type FoodKind = (typeof FOOD_KINDS)[number];

export interface CanonicalNutrient {
  code: NutrientCode;
  amountPer100g: Num;
  derivation: Derivation;
}

export interface CanonicalPortion {
  label: string;
  gramWeight: Num;
  source: 'fdc' | 'off_serving' | 'user';
}

export interface CanonicalFood {
  kind: FoodKind;
  name: string;
  brand: string | null;
  gtin: string | null;
  qualityTier: QualityTier;
  sourceRef: string;
  densityGPerMl: Num | null;
  nutrients: CanonicalNutrient[];
  portions: CanonicalPortion[];
}

export type NormalizeResult =
  | { ok: true; food: CanonicalFood; warnings: string[] }
  | { ok: false; reasons: string[]; sourceRef: string };

/** FDC energy in kJ; kcal codes are in NUTRIENT_DEFS, this one is a fallback. */
const FDC_ENERGY_KJ_ID = 1062;

/** Milligrams per one unit, so any mass unit converts to any other via mg. */
const MG_PER_UNIT: Record<'g' | 'mg' | 'µg', string> = { g: '1000', mg: '1', 'µg': '0.001' };

const SOURCE_MASS_UNITS: Record<string, 'g' | 'mg' | 'µg'> = {
  G: 'g',
  MG: 'mg',
  UG: 'µg',
  'ÂµG': 'µg',
  MCG: 'µg',
};

/** Converts a source amount into the unit the internal code is stored in. */
export function convertToCodeUnit(amount: Num | number, sourceUnit: string, code: NutrientCode): { value: Num; converted: boolean } | null {
  const target = NUTRIENT_DEFS[code].unit;
  const upper = sourceUnit.toUpperCase();
  if (target === 'kcal') {
    if (upper === 'KCAL') return { value: num(amount), converted: false };
    if (upper === 'KJ') return { value: num(dec(amount).div('4.184')), converted: true };
    return null;
  }
  const source = SOURCE_MASS_UNITS[upper];
  if (!source) return null;
  if (source === target) return { value: num(amount), converted: false };
  return { value: num(dec(amount).times(MG_PER_UNIT[source]).div(MG_PER_UNIT[target])), converted: true };
}

/** Barcodes are stored as 14 digits so UPC-A, EAN-13 and GTIN-14 compare equal. */
export function normalizeGtin(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 14) return null;
  return digits.padStart(14, '0');
}

export interface SanityLimits {
  maxKcalPer100g: number;
  maxMacroGramsPer100g: number;
}

export const DEFAULT_SANITY_LIMITS: SanityLimits = { maxKcalPer100g: 900, maxMacroGramsPer100g: 100 };

/** Import-time plausibility checks (spec 2.6.8, review item R11). */
export function sanityCheck(nutrients: readonly CanonicalNutrient[], limits: SanityLimits = DEFAULT_SANITY_LIMITS): string[] {
  const reasons: string[] = [];
  const byCode = new Map(nutrients.map((n) => [n.code, n.amountPer100g]));

  const energy = byCode.get('energy_kcal');
  if (energy !== undefined && dec(energy).greaterThan(limits.maxKcalPer100g)) {
    reasons.push(`energy_kcal ${energy} exceeds ${limits.maxKcalPer100g} per 100 g`);
  }
  let macroSum = dec(0);
  for (const code of ['protein_g', 'fat_g', 'carb_g'] as const) {
    const value = byCode.get(code);
    if (value !== undefined) macroSum = macroSum.plus(dec(value));
  }
  if (macroSum.greaterThan(limits.maxMacroGramsPer100g)) {
    reasons.push(`protein + fat + carbs ${num(macroSum)} g exceeds ${limits.maxMacroGramsPer100g} g per 100 g`);
  }
  for (const n of nutrients) {
    if (dec(n.amountPer100g).isNegative()) reasons.push(`${n.code} is negative`);
  }
  return reasons;
}

/* ------------------------------ FDC ------------------------------ */

export interface FdcNutrientRow {
  nutrientId: number;
  amount: number | string | null;
  unitName: string;
}

export interface FdcPortionRow {
  amount?: number | null;
  modifier?: string | null;
  measureUnitName?: string | null;
  portionDescription?: string | null;
  gramWeight: number | string;
}

export interface FdcFoodRecord {
  fdcId: number;
  description: string;
  dataType: string;
  foodNutrients: readonly FdcNutrientRow[];
  foodPortions?: readonly FdcPortionRow[];
  brandOwner?: string | null;
  brandName?: string | null;
  gtinUpc?: string | null;
  servingSize?: number | null;
  servingSizeUnit?: string | null;
  householdServingFullText?: string | null;
  /** Branded records may report per serving; per 100 g is assumed otherwise. */
  nutrientBasis?: 'per_100g' | 'per_serving';
}

export function qualityTierForFdcDataType(dataType: string): QualityTier | null {
  switch (dataType.toLowerCase()) {
    case 'foundation':
    case 'sr legacy':
      return 'lab';
    case 'survey (fndds)':
    case 'survey':
      return 'survey';
    case 'branded':
      return 'label';
    default:
      return null;
  }
}

function fdcPortionLabel(row: FdcPortionRow): string {
  if (row.portionDescription) return row.portionDescription.trim();
  const words = [row.measureUnitName, row.modifier]
    .filter((p): p is string => typeof p === 'string' && p !== '' && p !== 'undetermined')
    .map((p) => p.trim());
  // "1" on its own says nothing; a portion needs a unit or a modifier to be useful.
  if (words.length === 0) return '';
  return `${row.amount ?? 1} ${words.join(' ')}`;
}

export function normalizeFdcFood(record: FdcFoodRecord): NormalizeResult {
  const sourceRef = String(record.fdcId);
  const tier = qualityTierForFdcDataType(record.dataType);
  if (tier === null) return { ok: false, reasons: [`unsupported FDC dataType "${record.dataType}"`], sourceRef };

  const warnings: string[] = [];
  const perServing = record.nutrientBasis === 'per_serving';
  const servingGrams = record.servingSize ?? null;
  if (perServing && (servingGrams === null || (record.servingSizeUnit ?? 'g').toLowerCase() !== 'g')) {
    return { ok: false, reasons: ['per-serving record without a gram serving size'], sourceRef };
  }
  const basisFactor = perServing ? dec(100).div(dec(servingGrams as number)) : dec(1);

  const raw: NutrientMap = {};
  const nutrients: CanonicalNutrient[] = [];
  let energyKcal: Num | null = null;
  let energyKj: Num | null = null;
  let energyDerivation: Derivation = 'reported';

  for (const row of record.foodNutrients) {
    if (row.amount === null || row.amount === undefined) continue;
    const scaled = num(dec(row.amount).times(basisFactor));

    if (row.nutrientId === FDC_ENERGY_KJ_ID) {
      energyKj = scaled;
      continue;
    }
    const code = codeForFdcNutrientId(row.nutrientId);
    if (code === null) continue;
    const converted = convertToCodeUnit(scaled, row.unitName, code);
    if (converted === null) {
      warnings.push(`dropped ${code}: unit "${row.unitName}" not convertible`);
      continue;
    }
    if (code === 'energy_kcal') {
      if (energyKcal !== null) continue; // first matching id wins (priority order)
      energyKcal = converted.value;
      energyDerivation = converted.converted ? 'converted' : 'reported';
      continue;
    }
    if (raw[code] !== undefined) continue;
    raw[code] = converted.value;
    nutrients.push({
      code,
      amountPer100g: converted.value,
      derivation: converted.converted ? 'converted' : perServing ? 'converted' : 'reported',
    });
  }

  const energy = resolveEnergy({ kcal: energyKcal, kj: energyKj, macros: raw });
  if (energy.kcal !== null) {
    nutrients.unshift({
      code: 'energy_kcal',
      amountPer100g: energy.kcal,
      derivation: energy.derivation === 'reported' ? energyDerivation : (energy.derivation as Derivation),
    });
  } else {
    warnings.push('no energy value available');
  }

  const portions: CanonicalPortion[] = [];
  for (const row of record.foodPortions ?? []) {
    const gramWeight = dec(row.gramWeight);
    if (!gramWeight.greaterThan(0)) continue;
    const label = fdcPortionLabel(row);
    if (label === '') continue;
    portions.push({ label, gramWeight: num(gramWeight), source: 'fdc' });
  }
  if (tier === 'label' && servingGrams !== null && (record.servingSizeUnit ?? 'g').toLowerCase() === 'g') {
    portions.push({
      label: record.householdServingFullText?.trim() || `1 serving (${servingGrams} g)`,
      gramWeight: num(servingGrams),
      source: 'fdc',
    });
  }

  const reasons = sanityCheck(nutrients);
  if (reasons.length > 0) return { ok: false, reasons, sourceRef };

  return {
    ok: true,
    warnings,
    food: {
      kind: tier === 'label' ? 'branded' : 'generic',
      name: record.description.trim(),
      brand: record.brandName?.trim() || record.brandOwner?.trim() || null,
      gtin: normalizeGtin(record.gtinUpc),
      qualityTier: tier,
      sourceRef,
      densityGPerMl: null,
      nutrients,
      portions,
    },
  };
}

/* --------------------------- Open Food Facts --------------------------- */

/** OFF reports minerals in grams per 100 g; salt is the common stand-in for sodium. */
const OFF_FIELD_MAP: Record<string, { code: NutrientCode; unit: string }> = {
  'energy-kcal_100g': { code: 'energy_kcal', unit: 'KCAL' },
  proteins_100g: { code: 'protein_g', unit: 'G' },
  fat_100g: { code: 'fat_g', unit: 'G' },
  carbohydrates_100g: { code: 'carb_g', unit: 'G' },
  fiber_100g: { code: 'fiber_g', unit: 'G' },
  sugars_100g: { code: 'sugars_g', unit: 'G' },
  'saturated-fat_100g': { code: 'sat_fat_g', unit: 'G' },
  sodium_100g: { code: 'sodium_mg', unit: 'G' },
  potassium_100g: { code: 'potassium_mg', unit: 'G' },
  calcium_100g: { code: 'calcium_mg', unit: 'G' },
  iron_100g: { code: 'iron_mg', unit: 'G' },
  cholesterol_100g: { code: 'cholesterol_mg', unit: 'G' },
  'vitamin-c_100g': { code: 'vitamin_c_mg', unit: 'G' },
};

export const SALT_TO_SODIUM_MG_PER_G = 400;

export interface OffProductRecord {
  code: string;
  product_name?: string | null;
  brands?: string | null;
  serving_size?: string | null;
  serving_quantity?: number | string | null;
  nutriments?: Record<string, number | string | null | undefined>;
}

export function normalizeOffProduct(record: OffProductRecord): NormalizeResult {
  const sourceRef = record.code;
  const name = record.product_name?.trim();
  if (!name) return { ok: false, reasons: ['product has no name'], sourceRef };

  const warnings: string[] = [];
  const nutriments = record.nutriments ?? {};
  const nutrients: CanonicalNutrient[] = [];
  const raw: NutrientMap = {};
  let energyKcal: Num | null = null;

  for (const [field, mapping] of Object.entries(OFF_FIELD_MAP)) {
    const value = nutriments[field];
    if (value === null || value === undefined || value === '') continue;
    // Non-null by construction: every unit in OFF_FIELD_MAP is convertible.
    const converted = convertToCodeUnit(num(value), mapping.unit, mapping.code)!;
    if (mapping.code === 'energy_kcal') {
      energyKcal = converted.value;
      continue;
    }
    raw[mapping.code] = converted.value;
    nutrients.push({ code: mapping.code, amountPer100g: converted.value, derivation: converted.converted ? 'converted' : 'reported' });
  }

  if (raw.sodium_mg === undefined) {
    const salt = nutriments['salt_100g'];
    if (salt !== null && salt !== undefined && salt !== '') {
      const sodium = num(dec(salt).times(SALT_TO_SODIUM_MG_PER_G));
      raw.sodium_mg = sodium;
      nutrients.push({ code: 'sodium_mg', amountPer100g: sodium, derivation: 'derived' });
      warnings.push('sodium derived from salt');
    }
  }

  const energy = resolveEnergy({ kcal: energyKcal, kj: toNumOrNull(nutriments['energy-kj_100g']), macros: raw });
  if (energy.kcal !== null) {
    nutrients.unshift({ code: 'energy_kcal', amountPer100g: energy.kcal, derivation: energy.derivation as Derivation });
  } else {
    warnings.push('no energy value available');
  }

  const portions: CanonicalPortion[] = [];
  const servingGrams = toNumOrNull(record.serving_quantity);
  if (servingGrams !== null && dec(servingGrams).greaterThan(0)) {
    portions.push({
      label: record.serving_size?.trim() || `1 serving (${servingGrams} g)`,
      gramWeight: num(servingGrams),
      source: 'off_serving',
    });
  }

  const reasons = sanityCheck(nutrients);
  if (reasons.length > 0) return { ok: false, reasons, sourceRef };

  return {
    ok: true,
    warnings,
    food: {
      kind: 'branded',
      name,
      brand: record.brands?.split(',')[0]?.trim() || null,
      gtin: normalizeGtin(record.code),
      qualityTier: 'crowd',
      sourceRef,
      densityGPerMl: null,
      nutrients,
      portions,
    },
  };
}

function toNumOrNull(value: number | string | null | undefined): Num | null {
  if (value === null || value === undefined || value === '') return null;
  return num(value);
}
