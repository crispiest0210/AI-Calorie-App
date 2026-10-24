import { describe, expect, it } from 'vitest';
import { dayTotals, localDateOf } from '@nt/core';
import { progressFor, readDay } from '../src/day';
import * as entries from '../src/repositories/entries';
import * as goalsRepo from '../src/repositories/goals';
import * as water from '../src/repositories/water';
import { freshDb } from './helpers';

const energyTarget = (value: string) => ({
  nutrientCode: 'energy_kcal' as const,
  kind: 'target' as const,
  value,
  valueLow: null,
  valueHigh: null,
  basis: 'absolute' as const,
});

describe('readDay', () => {
  it('has no goals, no progress and no water target on a fresh database', () => {
    const { db } = freshDb();
    const day = readDay(db, localDateOf());
    expect(day.goals).toBeNull();
    expect(day.progress).toEqual([]);
    expect(day.water).toEqual({ consumedMl: 0, targetMl: null, remainingMl: null, ratio: null });
    expect(day.waterEntries).toEqual([]);
  });

  it('measures logged water and energy against the goals in force', () => {
    const { db } = freshDb();
    goalsRepo.saveGoals(db, { waterTargetMl: 2000, targets: [energyTarget('2000')], effectiveFrom: '2000-01-01' });
    entries.logQuickAdd(db, { mealSlot: 'lunch', nutrients: { energy_kcal: '500' }, label: 'Lunch' });
    water.addWater(db, 500);
    water.addWater(db, 250);

    const day = readDay(db, localDateOf());
    expect(day.goals?.waterTargetMl).toBe(2000);
    expect(day.water).toEqual({ consumedMl: 750, targetMl: 2000, remainingMl: 1250, ratio: 0.375 });
    expect(day.waterEntries).toHaveLength(2);
    expect(day.progress).toHaveLength(1);
    expect(day.progress[0]).toMatchObject({ nutrientCode: 'energy_kcal', consumed: '500', reference: '2000', state: 'under_target', ratio: 0.25 });
  });

  it('reads a past day against the profile that applied then', () => {
    const { db } = freshDb();
    goalsRepo.saveGoals(db, { waterTargetMl: 2000, targets: [energyTarget('1800')], effectiveFrom: '2026-01-01' });
    goalsRepo.saveGoals(db, { waterTargetMl: 3000, targets: [energyTarget('2400')], effectiveFrom: '2026-06-01' });

    expect(readDay(db, '2026-03-01').water.targetMl).toBe(2000);
    expect(readDay(db, '2026-03-01').progress[0]!.reference).toBe('1800');
    expect(readDay(db, '2026-07-01').water.targetMl).toBe(3000);
    expect(readDay(db, '2026-07-01').progress[0]!.reference).toBe('2400');
  });
});

describe('progressFor', () => {
  it('picks the profile for the date and returns no progress before the first one', () => {
    const { db } = freshDb();
    goalsRepo.saveGoals(db, { waterTargetMl: null, targets: [energyTarget('2000')], effectiveFrom: '2026-01-01' });
    const profiles = goalsRepo.allGoalProfiles(db);
    const totals = dayTotals([]);

    expect(progressFor(totals, profiles, '2026-02-01')[0]).toMatchObject({ nutrientCode: 'energy_kcal', consumed: '0', reference: '2000' });
    expect(progressFor(totals, profiles, '2025-12-31')).toEqual([]);
  });
});
