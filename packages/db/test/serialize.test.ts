import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@nt/core';
import { entries, water } from '../src';
import { serializeRow } from '../src/sync/serialize';
import { catalogFood, customFood, freshDb, RELEASE_ID } from './helpers';

describe('serializeRow', () => {
  it('returns null for a row that has vanished', () => {
    const { db } = freshDb();
    for (const table of ['log_entry', 'water_entry', 'water_preset', 'goal_profile', 'food'] as const) {
      expect(serializeRow(db, table, uuidv7())).toBeNull();
    }
  });

  it('never serializes catalog foods, which are server-owned', () => {
    const { db } = freshDb();
    const id = catalogFood(db, 'Rice, cooked', { energy_kcal: '130' });
    expect(serializeRow(db, 'food', id)).toBeNull();
  });

  it('ships a custom food with its nutrients and no recipe block', () => {
    const { db } = freshDb();
    const id = customFood(db, 'My granola', { energy_kcal: '450', protein_g: '10' });
    const wire = serializeRow(db, 'food', id);
    expect(wire?.table).toBe('food');
    const row = (wire as { row: { kind: string; name: string; recipe: unknown; nutrients: { nutrientCode: string }[] } }).row;
    expect(row).toMatchObject({ kind: 'custom', name: 'My granola', recipe: null });
    expect(row.nutrients.map((n) => n.nutrientCode).sort()).toEqual(['energy_kcal', 'protein_g']);
  });

  it('shapes water and log entries, parsing stored nutrient JSON', () => {
    const { db } = freshDb();
    const waterId = water.addWater(db, 250, new Date('2026-03-01T12:00:00Z'));
    expect(serializeRow(db, 'water_entry', waterId)).toMatchObject({ table: 'water_entry', row: { id: waterId, amountMl: 250, deletedAt: null } });

    const foodId = catalogFood(db, 'Rice, cooked', { energy_kcal: '130' });
    const entryId = entries.logFood(db, {
      foodId,
      foodName: 'Rice, cooked',
      sourceReleaseId: RELEASE_ID,
      mealSlot: 'lunch',
      amountValue: '200',
      amountUnit: 'g',
      grams: '200',
      gramsProvenance: 'user',
      nutrientsPer100g: { energy_kcal: '130' },
    });
    const wire = serializeRow(db, 'log_entry', entryId) as { row: { nutrientsPer100g: Record<string, string> | null; grams: string } };
    expect(wire.row.grams).toBe('200');
    expect(wire.row.nutrientsPer100g).toEqual({ energy_kcal: '130' });
  });
});
