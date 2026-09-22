/**
 * Properties the engine must hold for any input, not just the cases we thought
 * of (spec 6.1). These are the invariants the whole product rests on.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dec, num } from '../src/decimal';
import { CORE_CODES, type NutrientCode } from '../src/nutrients';
import { scalePer100g, type NutrientMap } from '../src/nutrient-map';
import { MEAL_SLOTS, entryNutrients, type EngineEntry, type MealSlot } from '../src/entries';
import { dayTotals, sumNutrients, totalsForEntries } from '../src/totals';
import { resolveGrams } from '../src/units';

const amount = fc.integer({ min: 1, max: 1_000_000 }).map((n) => num(dec(n).div(100)));
const nutrientValue = fc.integer({ min: 0, max: 100_000 }).map((n) => num(dec(n).div(100)));

const nutrientMap: fc.Arbitrary<NutrientMap> = fc
  .uniqueArray(fc.constantFrom(...CORE_CODES), { minLength: 1 })
  .chain((codes) =>
    fc.tuple(...codes.map(() => nutrientValue)).map((values) => {
      const map: NutrientMap = {};
      codes.forEach((code, i) => {
        map[code as NutrientCode] = values[i]!;
      });
      return map;
    }),
  );

const entry: fc.Arbitrary<EngineEntry> = fc
  .tuple(fc.uuid(), fc.constantFrom(...MEAL_SLOTS), amount, nutrientMap)
  .map(([id, mealSlot, grams, per100g]) => ({
    id,
    mealSlot: mealSlot as MealSlot,
    entryKind: 'food' as const,
    grams,
    nutrientsPer100g: per100g,
    nutrientsAbsolute: null,
  }));

describe('engine properties', () => {
  it('totals do not depend on entry order', () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 12 }), fc.array(fc.nat(), { maxLength: 12 }), (entries, keys) => {
        const shuffled = entries
          .map((e, i) => ({ e, k: keys[i] ?? i }))
          .sort((a, b) => a.k - b.k)
          .map(({ e }) => e);
        expect(totalsForEntries(shuffled).values).toEqual(totalsForEntries(entries).values);
      }),
    );
  });

  it('scaling the amount by k scales every nutrient by k', () => {
    fc.assert(
      fc.property(nutrientMap, amount, fc.integer({ min: 1, max: 50 }), (per100g, grams, k) => {
        const once = scalePer100g(per100g, grams);
        const scaled = scalePer100g(per100g, num(dec(grams).times(k)));
        for (const code of Object.keys(once) as NutrientCode[]) {
          expect(dec(scaled[code]!).equals(dec(once[code]!).times(k))).toBe(true);
        }
      }),
    );
  });

  it('the day total equals the sum of its meal totals', () => {
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 15 }), (entries) => {
        const day = dayTotals(entries);
        const rebuilt = sumNutrients(MEAL_SLOTS.map((slot) => day.byMeal[slot].values));
        for (const code of CORE_CODES) {
          expect(dec(rebuilt.values[code] ?? '0').equals(dec(day.total.values[code] ?? '0'))).toBe(true);
        }
      }),
    );
  });

  it('an entry contributes exactly what it is scaled to', () => {
    fc.assert(
      fc.property(entry, (e) => {
        expect(totalsForEntries([e]).values).toMatchObject(entryNutrients(e));
      }),
    );
  });

  it('grams resolution is linear in the amount', () => {
    const portions = [{ id: 'p', label: '1 cup', gramWeight: '158', source: 'fdc' as const }];
    fc.assert(
      fc.property(amount, fc.integer({ min: 1, max: 20 }), (value, k) => {
        const single = resolveGrams({ value, unit: 'portion', portionId: 'p' }, { densityGPerMl: null, portions });
        const multiple = resolveGrams({ value: num(dec(value).times(k)), unit: 'portion', portionId: 'p' }, { densityGPerMl: null, portions });
        expect(single.ok && multiple.ok).toBe(true);
        if (!single.ok || !multiple.ok) return;
        expect(dec(multiple.grams).equals(dec(single.grams).times(k))).toBe(true);
      }),
    );
  });

  it('a total is never a float artefact', () => {
    fc.assert(
      fc.property(fc.array(nutrientValue, { minLength: 1, maxLength: 30 }), (values) => {
        const totals = sumNutrients(values.map((v) => ({ energy_kcal: v })));
        const expected = values.reduce((acc, v) => acc.plus(dec(v)), dec(0));
        expect(totals.values.energy_kcal).toBe(num(expected));
      }),
    );
  });
});
