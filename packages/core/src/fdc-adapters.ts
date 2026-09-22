/**
 * FoodData Central hands the same food back in three shapes — search hits,
 * detail records and bulk-download rows. Each is mapped onto one neutral
 * record here so `normalizeFdcFood` only ever sees one shape.
 */
import type { FdcFoodRecord, FdcNutrientRow, FdcPortionRow } from './normalize';

export interface FdcSearchHit {
  fdcId: number;
  description: string;
  dataType: string;
  foodNutrients?: ReadonlyArray<{ nutrientId: number; unitName: string; value: number | string | null }>;
  brandOwner?: string | null;
  brandName?: string | null;
  gtinUpc?: string | null;
  servingSize?: number | null;
  servingSizeUnit?: string | null;
  householdServingFullText?: string | null;
}

export interface FdcDetailRecord {
  fdcId: number;
  /** Bulk survey rows carry no dataType; the loader supplies it. */
  dataType: string;
  description: string;
  foodNutrients?: ReadonlyArray<{ nutrient?: { id: number; unitName: string } | null; amount?: number | string | null }>;
  foodPortions?: ReadonlyArray<{
    amount?: number | null;
    modifier?: string | null;
    portionDescription?: string | null;
    gramWeight: number | string;
    measureUnit?: { name?: string | null } | null;
  }>;
  brandOwner?: string | null;
  brandName?: string | null;
  gtinUpc?: string | null;
  servingSize?: number | null;
  servingSizeUnit?: string | null;
  householdServingFullText?: string | null;
  /** FNDDS grouping; Foundation and SR Legacy use `foodCategory` instead. */
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string | null } | null;
  foodCategory?: { description?: string | null } | string | null;
}

function categoryOf(record: { wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string | null } | null; foodCategory?: { description?: string | null } | string | null }): string | null {
  const wweia = record.wweiaFoodCategory?.wweiaFoodCategoryDescription;
  if (typeof wweia === 'string' && wweia.trim() !== '') return wweia.trim();
  const category = record.foodCategory;
  if (typeof category === 'string') return category.trim() || null;
  const described = category?.description;
  return typeof described === 'string' && described.trim() !== '' ? described.trim() : null;
}

function head(record: FdcSearchHit | FdcDetailRecord) {
  return {
    fdcId: record.fdcId,
    description: record.description,
    dataType: record.dataType,
    brandOwner: record.brandOwner ?? null,
    brandName: record.brandName ?? null,
    gtinUpc: record.gtinUpc ?? null,
    servingSize: record.servingSize ?? null,
    servingSizeUnit: record.servingSizeUnit ?? null,
    householdServingFullText: record.householdServingFullText ?? null,
  };
}

export function fromFdcSearchHit(hit: FdcSearchHit): FdcFoodRecord {
  const foodNutrients: FdcNutrientRow[] = (hit.foodNutrients ?? []).map((n) => ({
    nutrientId: n.nutrientId,
    amount: n.value ?? null,
    unitName: n.unitName,
  }));
  return { ...head(hit), category: null, foodNutrients };
}

export function fromFdcDetail(record: FdcDetailRecord): FdcFoodRecord {
  const foodNutrients: FdcNutrientRow[] = [];
  for (const row of record.foodNutrients ?? []) {
    if (!row.nutrient) continue;
    foodNutrients.push({ nutrientId: row.nutrient.id, amount: row.amount ?? null, unitName: row.nutrient.unitName });
  }
  const foodPortions: FdcPortionRow[] = (record.foodPortions ?? []).map((p) => ({
    amount: p.amount ?? null,
    modifier: p.modifier ?? null,
    portionDescription: p.portionDescription ?? null,
    measureUnitName: p.measureUnit?.name ?? null,
    gramWeight: p.gramWeight,
  }));
  return { ...head(record), category: categoryOf(record), foodNutrients, foodPortions };
}
