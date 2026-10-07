/**
 * Label → catalog candidates, on the server. Same ranking as the device
 * (`@nt/core`), different candidate source: Postgres full-text rather than
 * bundled FTS5.
 */
import { matchQueries, rankCandidates } from '@nt/core';
import type { Sql } from '../db';
import { search } from './foods';

export interface ServerCandidate {
  foodId: string;
  name: string;
  score: number;
  qualityTier: string;
}

export async function matchLabel(
  sql: Sql,
  label: string,
  preparation: string | undefined,
  limit = 3,
): Promise<ServerCandidate[]> {
  const seen = new Map<string, { id: string; name: string; qualityTier: string }>();
  for (const query of matchQueries(label)) {
    for (const food of await search(sql, query, 25)) {
      if (!seen.has(food.id)) seen.set(food.id, { id: food.id, name: food.name, qualityTier: food.qualityTier });
    }
    if (seen.size >= 25) break;
  }

  return rankCandidates(label, preparation, [...seen.values()], { limit }).candidates.map((candidate) => ({
    foodId: candidate.food.id,
    name: candidate.food.name,
    score: candidate.score,
    qualityTier: candidate.food.qualityTier,
  }));
}
