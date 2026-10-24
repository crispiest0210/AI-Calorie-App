import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SyncRow } from '@nt/core';
import * as outbox from '../src/repositories/outbox';
import { applyRow } from '../src/sync/apply';
import { foodNutrient, foodPortion, goalProfile, goalTarget, waterEntry, waterPreset } from '../src/schema';
import { RELEASE_ID, freshDb } from './helpers';

const context = { userSourceReleaseId: RELEASE_ID };
const ID = '11111111-1111-4111-8111-111111111111';
const PORTION = '22222222-2222-4222-8222-222222222222';

function apply(db: ReturnType<typeof freshDb>['db'], change: SyncRow, serverRev: number): void {
  db.transaction((tx) => applyRow(tx, { ...change, serverRev }, context));
}

describe('applyRow', () => {
  it('upserts water rows with the server revision and never enqueues them', () => {
    const { db } = freshDb();
    const entry = { id: ID, localDate: '2026-03-01', loggedAt: 1000, amountMl: 250, updatedAt: 5, deletedAt: null };
    apply(db, { table: 'water_entry', row: entry }, 3);
    apply(db, { table: 'water_entry', row: { ...entry, amountMl: 500, updatedAt: 9 } }, 4);
    apply(db, { table: 'water_preset', row: { id: PORTION, label: null, amountMl: 330, position: 1, updatedAt: 5, deletedAt: 7 } }, 6);

    const rows = db.select().from(waterEntry).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amountMl: 500, serverRev: 4, updatedAt: 9 });
    expect(db.select().from(waterPreset).get()).toMatchObject({ amountMl: 330, serverRev: 6, deletedAt: 7 });
    expect(outbox.pendingCount(db)).toBe(0);
  });

  it('replaces a goal profile’s targets wholesale', () => {
    const { db } = freshDb();
    const target = (nutrientCode: string, value: string) => ({ nutrientCode, kind: 'target' as const, value, valueLow: null, valueHigh: null, basis: 'absolute' as const });
    const profile = { id: ID, effectiveFrom: '2026-03-01', waterTargetMl: 2000, updatedAt: 1, deletedAt: null };
    apply(db, { table: 'goal_profile', row: { ...profile, targets: [target('energy_kcal', '2000'), target('protein_g', '100')] } as never }, 1);
    apply(db, { table: 'goal_profile', row: { ...profile, targets: [target('energy_kcal', '1800')] } as never }, 2);

    expect(db.select().from(goalProfile).get()).toMatchObject({ waterTargetMl: 2000, serverRev: 2 });
    const targets = db.select().from(goalTarget).where(eq(goalTarget.goalProfileId, ID)).all();
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ nutrientCode: 'energy_kcal', value: '1800' });
  });

  it('replaces a food’s nutrients and portions and points it at the user release', () => {
    const { db } = freshDb();
    const food = (nutrients: { nutrientCode: string; amountPer100g: string; derivation: string }[], portions: { id: string; label: string; gramWeight: string; source: string; position: number }[]) =>
      ({
        id: ID, updatedAt: 1, deletedAt: null, kind: 'custom', name: 'Oats', brand: null, gtin: null, qualityTier: 'label',
        sourceRef: null, densityGPerMl: null, nutrients, portions, recipe: null,
      }) as never;
    apply(db, { table: 'food', row: food([{ nutrientCode: 'energy_kcal', amountPer100g: '380', derivation: 'reported' }, { nutrientCode: 'protein_g', amountPer100g: '13', derivation: 'reported' }], [{ id: PORTION, label: 'cup', gramWeight: '80', source: 'user', position: 0 }]) }, 1);
    apply(db, { table: 'food', row: food([{ nutrientCode: 'energy_kcal', amountPer100g: '370', derivation: 'reported' }], []) }, 2);

    const nutrients = db.select().from(foodNutrient).where(eq(foodNutrient.foodId, ID)).all();
    expect(nutrients).toHaveLength(1);
    expect(nutrients[0]).toMatchObject({ nutrientCode: 'energy_kcal', amountPer100g: '370' });
    expect(db.select().from(foodPortion).where(eq(foodPortion.foodId, ID)).all()).toHaveLength(0);
    expect(outbox.pendingCount(db)).toBe(0);
  });
});
