/**
 * Scoring a model's label against a catalog food name (spec 2.7, Matching).
 *
 * This lives in core because both stores need it and they must agree: the
 * device matches against its bundled SQLite and the server against Postgres,
 * and a label that ranks one way on one side and differently on the other
 * would make the review screen change its mind when the network appeared.
 * Each side supplies candidates its own way; the ranking is this function.
 */

/**
 * Below this the app refuses to guess and makes the person choose. The cost of
 * a wrong match is a wrong day of numbers; the cost of an unmatched item is
 * one search.
 */
export const MATCH_THRESHOLD = 0.35;
export const MAX_CANDIDATES = 3;

/** Words describing cooking rather than the food; they boost, never carry. */
export const PREPARATION_TERMS = new Set([
  'raw', 'cooked', 'grilled', 'roasted', 'baked', 'fried', 'boiled', 'steamed',
  'braised', 'broiled', 'poached', 'smoked', 'canned', 'dried', 'fresh',
  'skinless', 'boneless', 'breaded', 'battered', 'sauteed', 'seared',
]);

export function tokenizeLabel(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}

/**
 * How well a catalog name answers the model's label.
 *
 * Food words carry the score; preparation words only break ties, because
 * "chicken breast" matching "Chicken, broilers, breast, raw" is a good match
 * that happens to have the preparation wrong — something the person can see
 * and correct, unlike a wrong food.
 */
export function scoreCandidate(label: string, preparation: string | undefined, foodName: string): number {
  const labelTokens = tokenizeLabel(label);
  if (labelTokens.length === 0) return 0;

  const nameTokens = new Set(tokenizeLabel(foodName));
  const foodWords = labelTokens.filter((token) => !PREPARATION_TERMS.has(token));
  const prepWords = [...labelTokens.filter((token) => PREPARATION_TERMS.has(token)), ...tokenizeLabel(preparation ?? '')];

  const wanted = foodWords.length > 0 ? foodWords : labelTokens;
  const matchedFood = wanted.filter((token) => nameTokens.has(token)).length;
  if (matchedFood === 0) return 0;

  const coverage = matchedFood / wanted.length;
  const prepMatched = prepWords.filter((token) => nameTokens.has(token)).length;
  const prepBoost = prepWords.length === 0 ? 0 : (prepMatched / prepWords.length) * 0.15;

  // A name padded with qualifiers answers a short label less well than a plain
  // one, so length works against the score a little.
  const brevity = Math.min(1, 6 / Math.max(1, nameTokens.size)) * 0.1;

  return Math.min(1, coverage * 0.75 + prepBoost + brevity);
}

/** The searches to try for a label, broadest last. */
export function matchQueries(label: string): string[] {
  const all = tokenizeLabel(label);
  const foodWords = all.filter((token) => !PREPARATION_TERMS.has(token));
  const queries = [label];
  if (foodWords.length > 0 && foodWords.length < all.length) queries.push(foodWords.join(' '));
  if (foodWords.length > 1) queries.push(foodWords[foodWords.length - 1]!);
  return queries;
}

export interface ScoredCandidate<T> {
  food: T;
  score: number;
}

/** Ranks and trims candidates, and says whether the best one is good enough. */
export function rankCandidates<T extends { id: string; name: string }>(
  label: string,
  preparation: string | undefined,
  candidates: readonly T[],
  options: { threshold?: number; limit?: number } = {},
): { candidates: ScoredCandidate<T>[]; status: 'matched' | 'unmatched' } {
  const threshold = options.threshold ?? MATCH_THRESHOLD;
  const scored = candidates
    .map((food) => ({ food, score: scoreCandidate(label, preparation, food.name) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length)
    .slice(0, options.limit ?? MAX_CANDIDATES);

  return { candidates: scored, status: scored.length > 0 && scored[0]!.score >= threshold ? 'matched' : 'unmatched' };
}
