/**
 * Turning a server draft into something loggable (spec 5.3).
 *
 * Everything the model said is a proposal. This module decides what the review
 * screen may show, what it must make the user resolve, and what the totals are
 * — and every calorie in those totals comes from the local catalog, keyed by
 * the food the user has accepted.
 */
import { dec, num, type ConfidenceBand, type Num, type NutrientMap } from '@nt/core';
import { foods as foodsRepo, type Db, type FoodDetail } from '@nt/db';

export interface DraftCandidate {
  foodId: string;
  name: string;
  score: number;
  qualityTier: string;
}

export interface ServerDraftItem {
  itemId: string;
  label: string;
  description: string | null;
  preparation: string | null;
  identification: { confidence: number; band: ConfidenceBand };
  portionGrams: { estimate: string; low: string; high: string; basis: string | null };
  occluded: boolean;
  matchStatus: 'matched' | 'unmatched';
  candidates: DraftCandidate[];
}

export interface ServerDraft {
  analysisId: string;
  status: string;
  model: string | null;
  notes: string | null;
  items: ServerDraftItem[];
}

export interface ReviewItem extends ServerDraftItem {
  /** The food the user has settled on, if any. Null means unresolved. */
  chosenFoodId: string | null;
  /** Grams as they currently stand; starts at the model's estimate. */
  grams: Num;
  /** True until the amount is edited — drives the "Estimated" badge (5.3). */
  gramsUntouched: boolean;
  /** Nutrition for the chosen food, read from the local catalog. */
  food: FoodDetail | null;
}

export function toReviewItems(db: Db, draft: ServerDraft): ReviewItem[] {
  return draft.items.map((item) => {
    /*
     * A confident match is pre-selected so the common case is one tap. An
     * "unsure" one is not, even when a candidate scored well: the spec makes
     * the user resolve those, and pre-selecting would quietly decide for them.
     */
    const autoChosen =
      item.matchStatus === 'matched' && item.identification.band !== 'unsure' ? (item.candidates[0]?.foodId ?? null) : null;

    return {
      ...item,
      chosenFoodId: autoChosen,
      grams: item.portionGrams.estimate,
      gramsUntouched: true,
      food: autoChosen === null ? null : foodsRepo.foodDetail(db, autoChosen),
    };
  });
}

/** Spec 5.3: unsure or unmatched items must be resolved before Confirm. */
export function needsResolving(item: ReviewItem): boolean {
  return item.chosenFoodId === null || item.food === null;
}

export function canConfirm(items: readonly ReviewItem[]): boolean {
  return items.length > 0 && items.every((item) => !needsResolving(item));
}

export interface EnergyRange {
  low: Num;
  high: Num;
  /** Set once every item is accepted; the header shows one number then. */
  exact: Num | null;
}

/**
 * The draft's energy, as a range while anything is still estimated.
 *
 * The range comes from the model's low and high grams multiplied by the
 * *catalog's* energy — never from anything the model said about calories,
 * which it was never asked for.
 */
export function draftEnergy(items: readonly ReviewItem[]): EnergyRange {
  let low = dec(0);
  let high = dec(0);
  let exact = dec(0);
  let allSettled = items.length > 0;

  for (const item of items) {
    const per100g = item.food?.nutrientsPer100g.energy_kcal;
    if (per100g === undefined) {
      allSettled = false;
      continue;
    }
    const perGram = dec(per100g).div(100);
    exact = exact.plus(perGram.times(dec(item.grams)));

    if (item.gramsUntouched) {
      low = low.plus(perGram.times(dec(item.portionGrams.low)));
      high = high.plus(perGram.times(dec(item.portionGrams.high)));
      allSettled = false;
    } else {
      // An edited amount is the user's number, not an estimate; it does not
      // widen the range.
      low = low.plus(perGram.times(dec(item.grams)));
      high = high.plus(perGram.times(dec(item.grams)));
    }
  }

  return { low: num(low), high: num(high), exact: allSettled ? num(exact) : null };
}

/** What logging one accepted item looks like, once the user confirms. */
export interface ConfirmedEntry {
  foodId: string;
  foodName: string;
  sourceReleaseId: string;
  grams: Num;
  gramsProvenance: 'ai_estimate' | 'ai_adjusted';
  nutrientsPer100g: NutrientMap;
  aiGramsLow: Num;
  aiGramsHigh: Num;
}

export function toConfirmedEntries(items: readonly ReviewItem[]): ConfirmedEntry[] {
  return items.flatMap((item) => {
    if (item.food === null) return [];
    return [{
      foodId: item.food.id,
      foodName: item.food.name,
      sourceReleaseId: item.food.sourceReleaseId,
      grams: item.grams,
      // Spec 5.3: editing the amount changes provenance and drops the badge.
      gramsProvenance: item.gramsUntouched ? ('ai_estimate' as const) : ('ai_adjusted' as const),
      nutrientsPer100g: item.food.nutrientsPer100g,
      aiGramsLow: item.portionGrams.low,
      aiGramsHigh: item.portionGrams.high,
    }];
  });
}
