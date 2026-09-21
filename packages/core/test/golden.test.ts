/**
 * Golden tests over real provider records committed under /fixtures.
 * Any change to canonical output shows up as a snapshot diff and fails.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromFdcDetail, fromFdcSearchHit, type FdcDetailRecord, type FdcSearchHit } from '../src/fdc-adapters';
import { normalizeFdcFood, normalizeOffProduct, sanityCheck, type CanonicalFood, type NormalizeResult, type OffProductRecord } from '../src/normalize';
import { dec } from '../src/decimal';

const FIXTURES = path.resolve(import.meta.dirname, '..', '..', '..', 'fixtures');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

function listFixtures(dir: string): string[] {
  return readdirSync(path.join(FIXTURES, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(FIXTURES, dir, f));
}

/** Every FDC fixture record, in a stable order, whatever wire shape it came in. */
function fdcRecords(): { sourceRef: string; result: NormalizeResult }[] {
  const seen = new Set<number>();
  const out: { sourceRef: string; result: NormalizeResult }[] = [];
  for (const file of listFixtures('usda')) {
    const body = readJson<{ foods?: FdcSearchHit[] } | FdcDetailRecord[]>(file);
    if (Array.isArray(body)) {
      for (const record of body) {
        if (seen.has(record.fdcId)) continue;
        seen.add(record.fdcId);
        out.push({ sourceRef: String(record.fdcId), result: normalizeFdcFood(fromFdcDetail(record)) });
      }
      continue;
    }
    for (const hit of body.foods ?? []) {
      if (seen.has(hit.fdcId)) continue;
      seen.add(hit.fdcId);
      out.push({ sourceRef: String(hit.fdcId), result: normalizeFdcFood(fromFdcSearchHit(hit)) });
    }
  }
  return out.sort((a, b) => Number(a.sourceRef) - Number(b.sourceRef));
}

function offRecords(): { sourceRef: string; result: NormalizeResult }[] {
  const out: { sourceRef: string; result: NormalizeResult }[] = [];
  for (const file of listFixtures('off')) {
    for (const product of readJson<{ products: OffProductRecord[] }>(file).products) {
      out.push({ sourceRef: product.code, result: normalizeOffProduct(product) });
    }
  }
  return out.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));
}

/** The snapshot shape: what actually lands in `food`, `food_nutrient` and `food_portion`. */
function canonicalRows(food: CanonicalFood) {
  return {
    name: food.name,
    kind: food.kind,
    tier: food.qualityTier,
    brand: food.brand,
    gtin: food.gtin,
    nutrients: Object.fromEntries(food.nutrients.map((n) => [n.code, `${n.amountPer100g} (${n.derivation})`])),
    portions: food.portions.map((p) => `${p.label} = ${p.gramWeight} g [${p.source}]`),
  };
}

const fdc = fdcRecords();
const off = offRecords();

describe('golden: FoodData Central', () => {
  it('has enough real records to be a golden set', () => {
    expect(fdc.length).toBeGreaterThanOrEqual(50);
  });

  it('canonicalizes 50 records identically to the committed snapshot', () => {
    const sample = fdc.slice(0, 50).map(({ sourceRef, result }) => ({
      sourceRef,
      ...(result.ok ? canonicalRows(result.food) : { quarantined: result.reasons }),
    }));
    expect(sample).toMatchSnapshot();
  });

  it('serves nothing that fails a sanity check', () => {
    for (const { sourceRef, result } of fdc) {
      if (!result.ok) continue;
      expect(sanityCheck(result.food.nutrients), sourceRef).toEqual([]);
    }
  });

  it('stores every value as a plain decimal string', () => {
    for (const { result } of fdc) {
      if (!result.ok) continue;
      for (const n of result.food.nutrients) expect(n.amountPer100g).toMatch(/^-?\d+(\.\d+)?$/);
      for (const p of result.food.portions) expect(dec(p.gramWeight).greaterThan(0)).toBe(true);
    }
  });

  it('omits energy only where the source reports neither energy nor a full macro set', () => {
    for (const { sourceRef, result } of fdc) {
      if (!result.ok) continue;
      const codes = new Set(result.food.nutrients.map((n) => n.code));
      if (codes.has('energy_kcal')) continue;
      const fullMacros = ['protein_g', 'carb_g', 'fat_g'].every((c) => codes.has(c as never));
      expect(fullMacros, `${sourceRef} has macros but no energy`).toBe(false);
    }
  });
});

describe('golden: Open Food Facts', () => {
  it('has a golden set of real crowd-sourced products', () => {
    expect(off.length).toBeGreaterThanOrEqual(20);
  });

  it('canonicalizes every product identically to the committed snapshot', () => {
    const sample = off.map(({ sourceRef, result }) => ({
      sourceRef,
      ...(result.ok ? canonicalRows(result.food) : { quarantined: result.reasons }),
    }));
    expect(sample).toMatchSnapshot();
  });

  it('tags every accepted product as crowd-sourced', () => {
    for (const { result } of off) {
      if (!result.ok) continue;
      expect(result.food.qualityTier).toBe('crowd');
    }
  });
});
