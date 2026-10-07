import { describe, expect, it } from 'vitest';
import { MATCH_THRESHOLD, matchQueries, rankCandidates, scoreCandidate, tokenizeLabel } from '../src/matching';

describe('tokenizeLabel', () => {
  it('lowercases, splits on punctuation and drops single characters', () => {
    expect(tokenizeLabel('Chicken, broilers & a Breast (raw)')).toEqual(['chicken', 'broilers', 'breast', 'raw']);
  });
});

describe('scoreCandidate', () => {
  it('scores zero when no food word matches, even if preparation does', () => {
    expect(scoreCandidate('grilled salmon', undefined, 'Chicken, grilled')).toBe(0);
  });

  it('scores zero for an empty label', () => {
    expect(scoreCandidate('', undefined, 'Apple')).toBe(0);
  });

  it('boosts a matching preparation but never lets it carry the match', () => {
    const plain = scoreCandidate('chicken breast', undefined, 'Chicken breast raw');
    const withPrep = scoreCandidate('chicken breast', 'raw', 'Chicken breast raw');
    expect(withPrep).toBeGreaterThan(plain);
  });

  it('prefers a plain name over one padded with qualifiers', () => {
    const plain = scoreCandidate('apple', undefined, 'Apple');
    const padded = scoreCandidate('apple', undefined, 'Apple pie filling with added sugar and spices canned');
    expect(plain).toBeGreaterThan(padded);
  });

  it('never exceeds 1', () => {
    expect(scoreCandidate('raw apple', 'raw', 'Apple raw')).toBeLessThanOrEqual(1);
  });
});

describe('matchQueries', () => {
  it('goes from the full label to food words to the last food word', () => {
    expect(matchQueries('grilled chicken breast')).toEqual(['grilled chicken breast', 'chicken breast', 'breast']);
  });

  it('does not repeat itself for a single plain word', () => {
    expect(matchQueries('apple')).toEqual(['apple']);
  });
});

describe('rankCandidates', () => {
  const foods = [
    { id: 'a', name: 'Chicken, broilers or fryers, breast, skinless, raw' },
    { id: 'b', name: 'Chicken breast' },
    { id: 'c', name: 'Beef, ground' },
  ];

  it('ranks the plainer name first, drops non-matches and reports matched', () => {
    const result = rankCandidates('chicken breast', undefined, foods);
    expect(result.status).toBe('matched');
    expect(result.candidates.map((c) => c.food.id)).toEqual(['b', 'a']);
  });

  it('reports unmatched when nothing scores above the threshold', () => {
    const result = rankCandidates('tofu', undefined, foods);
    expect(result).toEqual({ candidates: [], status: 'unmatched' });
  });

  it('honours the limit and a custom threshold', () => {
    const result = rankCandidates('chicken breast', undefined, foods, { limit: 1, threshold: 2 });
    expect(result.candidates).toHaveLength(1);
    expect(result.status).toBe('unmatched');
    expect(MATCH_THRESHOLD).toBeLessThan(1);
  });
});
