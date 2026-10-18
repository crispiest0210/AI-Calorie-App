/**
 * MacroBars gives each macro one screen-reader label that folds in the target
 * (or its absence) and the over-target state; the numbers are also visible.
 */
import { render, screen } from '@testing-library/react-native';
import type { GoalProgress, NutrientCode, NutrientTotals } from '@nt/core';
import { MacroBars } from '@/components/MacroBars';

const totals: NutrientTotals = { values: { protein_g: '98', carb_g: '210', fat_g: '60' }, incomplete: [] };

function goal(nutrientCode: NutrientCode, consumed: string, reference: string): GoalProgress {
  return {
    nutrientCode,
    kind: 'target',
    consumed,
    reference,
    remaining: null,
    ratio: Number(consumed) / Number(reference),
    state: Number(consumed) > Number(reference) ? 'over_target' : 'under_target',
    derivedFromPercent: false,
    incomplete: false,
  };
}

describe('MacroBars', () => {
  it('labels each macro with its target and shows value / target visibly', () => {
    render(<MacroBars totals={totals} progress={[goal('protein_g', '98', '131')]} />);
    expect(screen.getByLabelText('Protein: 98 of 131 g')).toBeTruthy();
    expect(screen.getByText('98 / 131 g')).toBeTruthy();
  });

  it('says no target is set for macros without a goal', () => {
    render(<MacroBars totals={totals} progress={[]} />);
    expect(screen.getByLabelText('Carbs: 210 g, no target set')).toBeTruthy();
    expect(screen.getByLabelText('Fat: 60 g, no target set')).toBeTruthy();
    expect(screen.getByText('210 g')).toBeTruthy();
  });

  it('announces a macro that is over its target', () => {
    render(<MacroBars totals={totals} progress={[goal('fat_g', '60', '50')]} />);
    expect(screen.getByLabelText('Fat: 60 of 50 g, over target')).toBeTruthy();
  });

  it('falls back to 0 when a macro is absent from the totals', () => {
    render(<MacroBars totals={{ values: {}, incomplete: [] }} progress={[]} />);
    expect(screen.getByLabelText('Protein: 0 g, no target set')).toBeTruthy();
  });
});
