import { describe, expect, it } from 'vitest';
import { candidateEnergy, matchLabel } from '../src/repositories/matcher';
import { catalogFood, freshDb } from './helpers';

describe('matcher', () => {
  it('matches a label to the catalog food and reports it as matched', () => {
    const { db } = freshDb();
    const banana = catalogFood(db, 'Banana, raw', { energy_kcal: '89' });
    catalogFood(db, 'Apples, raw', { energy_kcal: '52' });

    const result = matchLabel(db, 'banana');
    expect(result.status).toBe('matched');
    expect(result.candidates[0]?.food.id).toBe(banana);
    expect(result.candidates.every((c) => c.food.name !== 'Apples, raw')).toBe(true);
  });

  it('is unmatched when nothing in the catalog resembles the label', () => {
    const { db } = freshDb();
    catalogFood(db, 'Banana, raw', { energy_kcal: '89' });

    expect(matchLabel(db, 'quinoa')).toEqual({ candidates: [], status: 'unmatched' });
  });

  it('caps the returned candidates at the requested limit', () => {
    const { db } = freshDb();
    catalogFood(db, 'Rice, white, cooked', { energy_kcal: '130' });
    catalogFood(db, 'Rice, brown, cooked', { energy_kcal: '123' });
    catalogFood(db, 'Rice, wild, cooked', { energy_kcal: '101' });

    expect(matchLabel(db, 'rice', undefined, { limit: 2 }).candidates).toHaveLength(2);
  });

  it('reads energy per 100 g from the catalog, and null for an unknown food', () => {
    const { db } = freshDb();
    const banana = catalogFood(db, 'Banana, raw', { energy_kcal: '89' });
    const water = catalogFood(db, 'Water', { protein_g: '0' });

    expect(candidateEnergy(db, banana)).toBe('89');
    expect(candidateEnergy(db, water)).toBeNull();
    expect(candidateEnergy(db, 'missing')).toBeNull();
  });
});
