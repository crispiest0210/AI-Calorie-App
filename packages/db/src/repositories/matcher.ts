/**
 * Label → catalog candidates, on the device (spec 2.7, Matching).
 *
 * The ranking lives in `@nt/core` so the server ranks identically; this file
 * only supplies the candidates, from the bundled SQLite catalog.
 */
import { sql } from 'drizzle-orm';
import { MATCH_THRESHOLD, MAX_CANDIDATES, matchQueries, rankCandidates, type ScoredCandidate } from '@nt/core';
import type { Db } from '../db';
import { searchFoods, type FoodSummary } from './foods';

export { MATCH_THRESHOLD, MAX_CANDIDATES };

export interface MatchResult {
  candidates: ScoredCandidate<FoodSummary>[];
  status: 'matched' | 'unmatched';
}

export interface MatchOptions {
  threshold?: number;
  limit?: number;
  searchLimit?: number;
}

export function matchLabel(db: Db, label: string, preparation?: string, options: MatchOptions = {}): MatchResult {
  const searchLimit = options.searchLimit ?? 40;
  const seen = new Map<string, FoodSummary>();

  for (const query of matchQueries(label)) {
    for (const food of searchFoods(db, query, searchLimit)) {
      if (!seen.has(food.id)) seen.set(food.id, food);
    }
    if (seen.size >= searchLimit) break;
  }

  return rankCandidates(label, preparation, [...seen.values()], options);
}

/** Energy per 100 g for a candidate, read from food_nutrient — never from the model. */
export function candidateEnergy(db: Db, foodId: string): string | null {
  const row = db.get<{ amount: string }>(
    sql`select amount_per_100g as amount from food_nutrient where food_id = ${foodId} and nutrient_code = 'energy_kcal'`,
  );
  return row?.amount ?? null;
}
