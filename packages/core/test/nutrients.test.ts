import { describe, expect, it } from 'vitest';
import { CORE_CODES, NUTRIENT_CODES, NUTRIENT_DEFS, codeForFdcNutrientId, isNutrientCode, sortedCodes } from '../src/nutrients';

describe('nutrient vocabulary', () => {
  it('defines every code exactly once with a unique sort order', () => {
    const orders = NUTRIENT_CODES.map((c) => NUTRIENT_DEFS[c].sortOrder);
    expect(new Set(orders).size).toBe(NUTRIENT_CODES.length);
    expect(NUTRIENT_CODES.every((c) => NUTRIENT_DEFS[c].code === c)).toBe(true);
  });

  it('maps FDC nutrient ids onto internal codes', () => {
    expect(codeForFdcNutrientId(1008)).toBe('energy_kcal');
    expect(codeForFdcNutrientId(1093)).toBe('sodium_mg');
    expect(codeForFdcNutrientId(9999)).toBeNull();
  });

  it('claims no FDC id twice', () => {
    const seen = new Set<number>();
    for (const code of NUTRIENT_CODES) {
      for (const id of NUTRIENT_DEFS[code].fdcNutrientIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  });

  it('shows energy as "cal" while storing kilocalories', () => {
    // US nutrition labels call one kilocalorie a "Calorie"; showing "kcal"
    // reads as a different unit to the people using this.
    expect(NUTRIENT_DEFS.energy_kcal.unit).toBe('kcal');
    expect(NUTRIENT_DEFS.energy_kcal.displayUnit).toBe('cal');
    for (const code of NUTRIENT_CODES) {
      if (code === 'energy_kcal') continue;
      expect(NUTRIENT_DEFS[code].displayUnit).toBe(NUTRIENT_DEFS[code].unit);
    }
  });

  it('narrows unknown strings', () => {
    expect(isNutrientCode('protein_g')).toBe(true);
    expect(isNutrientCode('vitamin_z')).toBe(false);
  });

  it('sorts into catalog order and lists the core six', () => {
    expect(sortedCodes(['sodium_mg', 'energy_kcal', 'protein_g'])).toEqual(['energy_kcal', 'protein_g', 'sodium_mg']);
    expect(CORE_CODES).toEqual(['energy_kcal', 'protein_g', 'carb_g', 'fat_g', 'fiber_g', 'sodium_mg']);
  });
});
