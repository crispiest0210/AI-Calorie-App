import { describe, expect, it } from 'vitest';
import { atwaterEnergy, kcalToKj, kjToKcal, resolveEnergy } from '../src/energy';

describe('energy', () => {
  it('converts kJ and kcal', () => {
    expect(kjToKcal('418.4')).toBe('100');
    expect(kcalToKj('100')).toBe('418.4');
  });

  it('computes Atwater energy from macros', () => {
    expect(atwaterEnergy({ protein_g: '10', carb_g: '20', fat_g: '5' })).toBe('165');
    expect(atwaterEnergy({ fiber_g: '3' })).toBeNull();
    expect(atwaterEnergy({})).toBeNull();
    // A partial macro set derives nothing rather than a number that reads as fact.
    expect(atwaterEnergy({ protein_g: '10', fat_g: '5' })).toBeNull();
  });

  it('prefers reported kcal, then kJ, then Atwater', () => {
    expect(resolveEnergy({ kcal: '120', macros: { protein_g: '10' } })).toEqual({ kcal: '120', derivation: 'reported' });
    expect(resolveEnergy({ kcal: null, kj: '418.4', macros: {} })).toEqual({ kcal: '100', derivation: 'converted' });
    expect(resolveEnergy({ macros: { protein_g: '10', carb_g: '0', fat_g: '0' } })).toEqual({ kcal: '40', derivation: 'derived' });
    expect(resolveEnergy({ macros: {} })).toEqual({ kcal: null, derivation: null });
  });
});
