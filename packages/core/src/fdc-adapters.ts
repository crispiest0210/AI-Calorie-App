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
  description: string;
  dataType: string;
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
  return { ...head(hit), foodNutrients };
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
  return { ...head(record), foodNutrients, foodPortions };
}
