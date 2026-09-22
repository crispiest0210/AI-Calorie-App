/**
 * The fixed internal nutrient vocabulary (spec 2.6.2). Every provider is mapped
 * onto these codes at import time so the engine only ever sees one vocabulary.
 */

export const NUTRIENT_CODES = [
  'energy_kcal',
  'protein_g',
  'fat_g',
  'carb_g',
  'fiber_g',
  'sugars_g',
  'sat_fat_g',
  'sodium_mg',
  'potassium_mg',
  'calcium_mg',
  'iron_mg',
  'cholesterol_mg',
  'vitamin_c_mg',
] as const;

export type NutrientCode = (typeof NUTRIENT_CODES)[number];

export type NutrientUnit = 'kcal' | 'g' | 'mg' | 'µg';

/** How a stored value came to be; surfaced in the provenance sheet. */
export const DERIVATIONS = ['reported', 'converted', 'derived', 'computed'] as const;
export type Derivation = (typeof DERIVATIONS)[number];

export interface NutrientDef {
  code: NutrientCode;
  displayName: string;
  /** The unit the stored value is actually in. */
  unit: NutrientUnit;
  /**
   * What the unit is called on screen. Energy is stored in kilocalories, but
   * every nutrition label in the US says "Calories" for the same quantity, so
   * showing "kcal" reads as a different unit to the people using this.
   */
  displayUnit: string;
  /** FDC nutrient numbers in priority order; the first one present wins. */
  fdcNutrientIds: number[];
  sortOrder: number;
  /** Shown on Today and in the goals editor without being asked for. */
  core: boolean;
}

export const NUTRIENT_DEFS: Record<NutrientCode, NutrientDef> = {
  energy_kcal: { code: 'energy_kcal', displayName: 'Energy', unit: 'kcal', displayUnit: 'cal', fdcNutrientIds: [1008, 2048, 2047], sortOrder: 0, core: true },
  protein_g: { code: 'protein_g', displayName: 'Protein', unit: 'g', displayUnit: 'g', fdcNutrientIds: [1003], sortOrder: 1, core: true },
  carb_g: { code: 'carb_g', displayName: 'Carbs', unit: 'g', displayUnit: 'g', fdcNutrientIds: [1005, 1050], sortOrder: 2, core: true },
  fat_g: { code: 'fat_g', displayName: 'Fat', unit: 'g', displayUnit: 'g', fdcNutrientIds: [1004], sortOrder: 3, core: true },
  fiber_g: { code: 'fiber_g', displayName: 'Fiber', unit: 'g', displayUnit: 'g', fdcNutrientIds: [1079, 2033], sortOrder: 4, core: true },
  sodium_mg: { code: 'sodium_mg', displayName: 'Sodium', unit: 'mg', displayUnit: 'mg', fdcNutrientIds: [1093], sortOrder: 5, core: true },
  sugars_g: { code: 'sugars_g', displayName: 'Sugars', unit: 'g', displayUnit: 'g', fdcNutrientIds: [2000, 1063], sortOrder: 6, core: false },
  sat_fat_g: { code: 'sat_fat_g', displayName: 'Saturated fat', unit: 'g', displayUnit: 'g', fdcNutrientIds: [1258], sortOrder: 7, core: false },
  potassium_mg: { code: 'potassium_mg', displayName: 'Potassium', unit: 'mg', displayUnit: 'mg', fdcNutrientIds: [1092], sortOrder: 8, core: false },
  calcium_mg: { code: 'calcium_mg', displayName: 'Calcium', unit: 'mg', displayUnit: 'mg', fdcNutrientIds: [1087], sortOrder: 9, core: false },
  iron_mg: { code: 'iron_mg', displayName: 'Iron', unit: 'mg', displayUnit: 'mg', fdcNutrientIds: [1089], sortOrder: 10, core: false },
  cholesterol_mg: { code: 'cholesterol_mg', displayName: 'Cholesterol', unit: 'mg', displayUnit: 'mg', fdcNutrientIds: [1253], sortOrder: 11, core: false },
  vitamin_c_mg: { code: 'vitamin_c_mg', displayName: 'Vitamin C', unit: 'mg', displayUnit: 'mg', fdcNutrientIds: [1162], sortOrder: 12, core: false },
};

/** The macros that carry energy, with their Atwater factors (kcal per gram). */
export const ATWATER_FACTORS = {
  protein_g: 4,
  carb_g: 4,
  fat_g: 9,
} as const satisfies Partial<Record<NutrientCode, number>>;

export type MacroCode = keyof typeof ATWATER_FACTORS;

export const MACRO_CODES = Object.keys(ATWATER_FACTORS) as MacroCode[];

/** Catalog order for nutrient lists and the provenance sheet. */
export function sortedCodes(codes: Iterable<NutrientCode>): NutrientCode[] {
  return [...codes].sort((a, b) => NUTRIENT_DEFS[a].sortOrder - NUTRIENT_DEFS[b].sortOrder);
}

export const CORE_CODES: NutrientCode[] = sortedCodes(NUTRIENT_CODES.filter((c) => NUTRIENT_DEFS[c].core));

export function isNutrientCode(value: string): value is NutrientCode {
  return Object.prototype.hasOwnProperty.call(NUTRIENT_DEFS, value);
}

/** Maps an FDC nutrient number onto an internal code, or null when we don't track it. */
export function codeForFdcNutrientId(fdcId: number): NutrientCode | null {
  for (const code of NUTRIENT_CODES) {
    if (NUTRIENT_DEFS[code].fdcNutrientIds.includes(fdcId)) return code;
  }
  return null;
}

/**
 * Categories surfaced first when browsing for a meal. These are the source's
 * own names — USDA's FNDDS groups foods by what people actually eat, and SR
 * Legacy carries the named restaurant items — so nothing here is invented.
 * Every other category is still reachable; this is only the order.
 */
export const FEATURED_MEAL_CATEGORIES: readonly string[] = [
  'Burgers',
  'Pizza',
  'Chicken fillet sandwiches',
  'Deli and cured meat sandwiches',
  'Egg/breakfast sandwiches',
  'Burritos and tacos',
  'Fast Foods',
  'Restaurant Foods',
  'Coffee',
  'Rice mixed dishes',
  'Pasta mixed dishes, excludes macaroni and cheese',
  'Meat mixed dishes',
  'Poultry mixed dishes',
  'Chicken, whole pieces',
  'Eggs and omelets',
  'Soups, broth-based',
  'French fries and other fried white potatoes',
  'Smoothies and grain drinks',
];
