import { describe, expect, it } from 'vitest';
import { candidateEnergy, matchLabel } from '../src/repositories/matcher';
import { catalogFood, freshDb } from './helpers';

describe('matchLabel', () => {
  it('ranks the closest catalog name first and marks it matched', () => {
    const { db } = freshDb();
    const apple = catalogFood(db, 'Apples, raw, with skin', { energy_kcal: '52' });
    catalogFood(db, 'Pineapple, raw', { energy_kcal: '50' });

    const result = matchLabel(db, 'apples');
    expect(result.status).toBe('matched');
    expect(result.candidates[0]!.food.id).toBe(apple);
  });

  it('reports unmatched when nothing in the catalog is close', () => {
    const { db } = freshDb();
    catalogFood(db, 'Apples, raw, with skin', { energy_kcal: '52' });

    const result = matchLabel(db, 'zzzqx');
    expect(result.status).toBe('unmatched');
    expect(result.candidates).toEqual([]);
  });

  it('honours the candidate limit', () => {
    const { db } = freshDb();
    for (const name of ['Rice, white', 'Rice, brown', 'Rice, wild', 'Rice, red']) catalogFood(db, name, { energy_kcal: '130' });

    expect(matchLabel(db, 'rice', undefined, { limit: 2 }).candidates.length).toBeLessThanOrEqual(2);
  });
});

describe('candidateEnergy', () => {
  it('reads energy per 100 g from the catalog', () => {
    const { db } = freshDb();
    const id = catalogFood(db, 'Banana, raw', { energy_kcal: '89' });
    expect(candidateEnergy(db, id)).toBe('89');
  });

  it('returns null when the food has no energy row or does not exist', () => {
    const { db } = freshDb();
    const id = catalogFood(db, 'Water, tap', { protein_g: '0' });
    expect(candidateEnergy(db, id)).toBeNull();
    expect(candidateEnergy(db, 'missing')).toBeNull();
  });
});
