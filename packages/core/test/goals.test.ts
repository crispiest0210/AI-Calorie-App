import { describe, expect, it } from 'vitest';
import {
  energyTargetOf,
  goalProgress,
  profileForDate,
  progressForProfile,
  resolveProfile,
  resolveTarget,
  waterProgress,
  type GoalProfile,
} from '../src/goals';
import { sumNutrients } from '../src/totals';

const profile: GoalProfile = {
  id: 'g1',
  effectiveFrom: '2026-09-01',
  waterTargetMl: 2500,
  targets: [
    { nutrientCode: 'energy_kcal', kind: 'target', value: '2100', valueLow: null, valueHigh: null, basis: 'absolute' },
    { nutrientCode: 'protein_g', kind: 'target', value: '25', valueLow: null, valueHigh: null, basis: 'pct_energy' },
    { nutrientCode: 'fiber_g', kind: 'min', value: null, valueLow: '30', valueHigh: null, basis: 'absolute' },
    { nutrientCode: 'sodium_mg', kind: 'max', value: null, valueLow: null, valueHigh: '2300', basis: 'absolute' },
    { nutrientCode: 'carb_g', kind: 'range', value: null, valueLow: '40', valueHigh: '55', basis: 'pct_energy' },
  ],
};

const newer: GoalProfile = { ...profile, id: 'g2', effectiveFrom: '2026-09-15', waterTargetMl: 3000 };

describe('goal profiles', () => {
  it('picks the profile in force on a date', () => {
    expect(profileForDate([profile, newer], '2026-09-10')?.id).toBe('g1');
    expect(profileForDate([profile, newer], '2026-09-20')?.id).toBe('g2');
    expect(profileForDate([profile, newer], '2026-08-31')).toBeNull();
    expect(profileForDate([], '2026-09-20')).toBeNull();
  });

  it('reads the energy target off a profile', () => {
    expect(energyTargetOf(profile)).toBe('2100');
    expect(energyTargetOf(null)).toBeNull();
    expect(energyTargetOf({ ...profile, targets: [] })).toBeNull();
    expect(energyTargetOf({ ...profile, targets: [{ nutrientCode: 'energy_kcal', kind: 'target', value: null, valueLow: null, valueHigh: null, basis: 'absolute' }] })).toBeNull();
  });
});

describe('resolveTarget', () => {
  it('leaves absolute targets alone', () => {
    const resolved = resolveTarget(profile.targets[2]!, '2100');
    expect(resolved).toMatchObject({ low: '30', derivedFromPercent: false });
  });

  it('turns percent-of-energy into grams with 4/4/9', () => {
    const protein = resolveTarget(profile.targets[1]!, '2100');
    expect(protein.value).toBe('131.25');
    expect(protein.derivedFromPercent).toBe(true);
    const carb = resolveTarget(profile.targets[4]!, '2100');
    expect(carb.low).toBe('210');
    expect(carb.high).toBe('288.75');
  });

  it('refuses to resolve a percent target with no energy anchor', () => {
    expect(resolveTarget(profile.targets[1]!, null)).toMatchObject({ value: null, low: null, high: null });
  });

  it('refuses a percent target on a nutrient that carries no energy', () => {
    const bogus = { nutrientCode: 'sodium_mg', kind: 'max', value: null, valueLow: null, valueHigh: '10', basis: 'pct_energy' } as const;
    expect(resolveTarget(bogus, '2100')).toMatchObject({ high: null });
  });

  it('resolves a whole profile, or nothing at all', () => {
    expect(resolveProfile(profile)).toHaveLength(5);
    expect(resolveProfile(null)).toEqual([]);
  });
});

describe('goalProgress', () => {
  const totals = sumNutrients([{ energy_kcal: '1400', protein_g: '80', fiber_g: '30', sodium_mg: '2500', carb_g: '100' }]);

  it('reports remaining and ratio for a target', () => {
    const [energy] = progressForProfile(totals, profile);
    expect(energy).toMatchObject({ remaining: '700', state: 'under_target' });
    expect(energy!.ratio).toBeCloseTo(1400 / 2100, 10);
  });

  it('calls a met minimum at_target and a busted cap over_target', () => {
    const progress = progressForProfile(totals, profile);
    expect(progress.find((p) => p.nutrientCode === 'fiber_g')!.state).toBe('at_target');
    expect(progress.find((p) => p.nutrientCode === 'sodium_mg')).toMatchObject({ state: 'over_target', remaining: '-200' });
  });

  it('treats a range below its low edge as under target', () => {
    const carb = progressForProfile(totals, profile).find((p) => p.nutrientCode === 'carb_g')!;
    expect(carb.state).toBe('under_target');
  });

  it('falls back to the low edge when a range has no high', () => {
    const resolved = resolveTarget({ nutrientCode: 'fat_g', kind: 'range', value: null, valueLow: '50', valueHigh: null, basis: 'absolute' }, null);
    expect(goalProgress(sumNutrients([{ fat_g: '60' }]), resolved)).toMatchObject({ reference: '50', state: 'over_target' });
  });

  it('marks a goal unknown when nothing anchors it', () => {
    const resolved = resolveTarget(profile.targets[1]!, null);
    expect(goalProgress(totals, resolved)).toMatchObject({ state: 'unknown', reference: null, remaining: null, ratio: null });
  });

  it('carries the incomplete flag through', () => {
    const partial = sumNutrients([{ energy_kcal: '100' }, { energy_kcal: '50' }]);
    expect(goalProgress(partial, resolveTarget(profile.targets[0]!, '2100')).incomplete).toBe(false);
    expect(goalProgress(partial, resolveTarget(profile.targets[2]!, '2100')).incomplete).toBe(true);
  });

  it('treats a nutrient nothing contributed as zero consumed', () => {
    const resolved = resolveTarget({ nutrientCode: 'sugars_g', kind: 'max', value: null, valueLow: null, valueHigh: '50', basis: 'absolute' }, null);
    expect(goalProgress(sumNutrients([{ energy_kcal: '100' }]), resolved)).toMatchObject({ consumed: '0', remaining: '50' });
  });

  it('handles a zero reference without dividing by it', () => {
    const zero = resolveTarget({ nutrientCode: 'energy_kcal', kind: 'target', value: '0', valueLow: null, valueHigh: null, basis: 'absolute' }, '0');
    expect(goalProgress(sumNutrients([{ energy_kcal: '0' }]), zero)).toMatchObject({ ratio: null, state: 'at_target' });
  });

  it('returns nothing for a day with no profile', () => {
    expect(progressForProfile(totals, null)).toEqual([]);
  });
});

describe('waterProgress', () => {
  it('reports remaining against the target', () => {
    expect(waterProgress(1500, 2500)).toEqual({ consumedMl: 1500, targetMl: 2500, remainingMl: 1000, ratio: 0.6 });
  });

  it('reports no target when none is set', () => {
    expect(waterProgress(1500, null)).toMatchObject({ targetMl: null, ratio: null });
    expect(waterProgress(1500, 0)).toMatchObject({ targetMl: null, ratio: null });
  });
});
