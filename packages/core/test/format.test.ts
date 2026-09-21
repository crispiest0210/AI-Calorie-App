import { describe, expect, it } from 'vitest';
import {
  displayDecimals,
  energyA11yLabel,
  formatAmount,
  formatEnergy,
  formatGrams,
  formatMl,
  formatNutrient,
  formatRange,
  formatWithUnit,
  overBySummary,
  roundForDisplay,
} from '../src/format';

describe('display rounding', () => {
  it('rounds kcal to whole numbers and grams by size', () => {
    expect(displayDecimals('energy_kcal', '194.5')).toBe(0);
    expect(displayDecimals('protein_g', '8.45')).toBe(1);
    expect(displayDecimals('protein_g', '18.45')).toBe(0);
    expect(displayDecimals('sodium_mg', '2.4')).toBe(0);
    expect(roundForDisplay('8.45', 'protein_g')).toBe(8.4);
    expect(roundForDisplay('18.5', 'protein_g')).toBe(18);
  });

  it('groups thousands and shows an em dash for nothing', () => {
    expect(formatEnergy('1420.4')).toBe('1,420');
    expect(formatNutrient(null, 'energy_kcal')).toBe('—');
    expect(formatNutrient(undefined, 'energy_kcal')).toBe('—');
    expect(formatWithUnit('2.5', 'protein_g')).toBe('2.5 g');
    expect(formatWithUnit(null, 'protein_g')).toBe('—');
  });

  it('formats grams and millilitres', () => {
    expect(formatGrams('9.44')).toBe('9.4');
    expect(formatGrams('158.6')).toBe('159');
    expect(formatGrams(null)).toBe('—');
    expect(formatMl('249.6')).toBe('250');
    expect(formatMl(null)).toBe('—');
  });

  it('formats an amount in the unit it was entered in', () => {
    expect(formatAmount('150', 'g')).toBe('150 g');
    expect(formatAmount('200', 'ml')).toBe('200 mL');
    expect(formatAmount('250', 'kcal')).toBe('250 cal');
    expect(formatAmount('2', 'portion', '1 cup')).toBe('2 × 1 cup');
    expect(formatAmount('2', 'portion')).toBe('2 × portion');
  });

  it('formats a draft range', () => {
    expect(formatRange('520', '780', 'energy_kcal')).toBe('520–780 cal');
  });
});

describe('accessible and non-shaming copy', () => {
  it('describes the energy ring in words', () => {
    expect(energyA11yLabel('1420', '2100', '680')).toBe('Energy: 1,420 of 2,100 cal, 680 remaining');
    expect(energyA11yLabel('2220', '2100', '-120')).toBe('Energy: 2,220 of 2,100 cal, 120 over');
    expect(energyA11yLabel('1420', null, null)).toBe('Energy: 1,420 cal, no target set');
  });

  it('states an overshoot plainly, or not at all', () => {
    expect(overBySummary('-120', 'energy_kcal')).toBe('120 cal over');
    expect(overBySummary('680', 'energy_kcal')).toBeNull();
    expect(overBySummary('0', 'energy_kcal')).toBeNull();
  });
});
