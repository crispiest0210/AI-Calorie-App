import { describe, expect, it } from 'vitest';
import { MAX_PUSH_ROWS, problemDetails, pullResponse, pushRequest, syncFood, syncRow, SYNCED_TABLES } from '../src/sync-contracts';

const id = '3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b';
const id2 = '7a1c9d2e-6b5f-4c8d-9e0a-1b2c3d4e5f60';
const base = { id, updatedAt: 1_789_000_000_000, deletedAt: null };

const logEntry = {
  ...base,
  localDate: '2026-09-20',
  loggedAt: 1_789_000_000_000,
  tzOffsetMin: -420,
  mealSlot: 'lunch',
  entryKind: 'food',
  foodId: id2,
  amountValue: '150',
  amountUnit: 'g',
  portionId: null,
  grams: '150',
  gramsProvenance: 'user',
  foodNameSnapshot: 'Rice',
  sourceReleaseId: null,
  nutrientsPer100g: { energy_kcal: '130' },
  nutrientsAbsolute: null,
  note: null,
};

const food = {
  ...base,
  kind: 'custom',
  name: 'Granola',
  brand: null,
  gtin: null,
  qualityTier: 'user',
  sourceRef: null,
  densityGPerMl: null,
  nutrients: [{ nutrientCode: 'energy_kcal', amountPer100g: '450', derivation: 'label' }],
  portions: [{ id: id2, label: '1 bowl', gramWeight: '60', source: 'user', position: 0 }],
};

describe('sync contracts', () => {
  it('syncs exactly the five user-owned tables', () => {
    expect([...SYNCED_TABLES]).toEqual(['log_entry', 'water_entry', 'water_preset', 'goal_profile', 'food']);
  });

  it('accepts a log entry row and rejects float amounts', () => {
    expect(syncRow.safeParse({ table: 'log_entry', row: logEntry }).success).toBe(true);
    expect(syncRow.safeParse({ table: 'log_entry', row: { ...logEntry, amountValue: 150 } }).success).toBe(false);
  });

  it('rejects a row whose payload does not match its table tag', () => {
    expect(syncRow.safeParse({ table: 'water_entry', row: logEntry }).success).toBe(false);
    expect(syncRow.safeParse({ table: 'catalog_food', row: logEntry }).success).toBe(false);
  });

  it('requires uuid ids and integer timestamps', () => {
    expect(syncRow.safeParse({ table: 'log_entry', row: { ...logEntry, id: 'e1' } }).success).toBe(false);
    expect(syncRow.safeParse({ table: 'log_entry', row: { ...logEntry, updatedAt: 1.5 } }).success).toBe(false);
  });

  it('carries a food with or without a recipe', () => {
    expect(syncFood.safeParse(food).success).toBe(true);
    expect(syncFood.safeParse({ ...food, recipe: null }).success).toBe(true);
    const recipe = {
      servings: '4',
      totalCookedGrams: null,
      ingredients: [{ id, ingredientFoodId: id2, grams: '200', position: 0 }],
    };
    expect(syncFood.safeParse({ ...food, recipe }).success).toBe(true);
    expect(syncFood.safeParse({ ...food, recipe: { ...recipe, servings: 4 } }).success).toBe(false);
  });

  it('caps a push batch at MAX_PUSH_ROWS', () => {
    const change = { table: 'log_entry', row: logEntry };
    expect(pushRequest.safeParse({ changes: Array(MAX_PUSH_ROWS).fill(change) }).success).toBe(true);
    expect(pushRequest.safeParse({ changes: Array(MAX_PUSH_ROWS + 1).fill(change) }).success).toBe(false);
  });

  it('accepts a pull response whose changes carry a serverRev', () => {
    const change = { table: 'log_entry', row: logEntry, serverRev: 7 };
    expect(pullResponse.safeParse({ changes: [change], nextCursor: 7, hasMore: false }).success).toBe(true);
    const { serverRev: _omit, ...withoutRev } = change;
    expect(pullResponse.safeParse({ changes: [withoutRev], nextCursor: 7, hasMore: false }).success).toBe(false);
  });

  it('only allows known problem codes', () => {
    const problem = { type: 'about:blank', title: 'Gone', status: 410, code: 'sync_cursor_expired' };
    expect(problemDetails.safeParse(problem).success).toBe(true);
    expect(problemDetails.safeParse({ ...problem, code: 'teapot' }).success).toBe(false);
  });
});
