import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fdcRecordsFrom, loadBulk, loadFixtures } from '../src/sources';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sources-'));
  dirs.push(dir);
  return dir;
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const detail = (fdcId: number, extra: object = {}) => ({
  fdcId,
  description: `Food ${fdcId}`,
  foodNutrients: [{ nutrient: { id: 1008, unitName: 'KCAL' }, amount: 100 }],
  ...extra,
});

describe('fdcRecordsFrom bulk dataType', () => {
  it('takes dataType from the wrapping key when the row omits it', () => {
    const [record] = fdcRecordsFrom({ SRLegacyFoods: [detail(7)] });
    expect(record?.ref).toBe('7');
    expect(record?.result.ok).toBe(true);
    if (record?.result.ok) expect(record.result.food.qualityTier).toBeDefined();
  });

  it('keeps a dataType the row already states', () => {
    const withKey = fdcRecordsFrom({ BrandedFoods: [detail(8, { dataType: 'Foundation' })] });
    const without = fdcRecordsFrom({ Foundation: [detail(8, { dataType: 'Foundation' })] });
    expect(withKey[0]?.result).toEqual(without[0]?.result);
  });

  it('skips non-array values and rows without a numeric fdcId', () => {
    const records = fdcRecordsFrom({ FoundationFoods: [detail(1), null, { fdcId: '2' }], meta: { a: 1 } });
    expect(records.map((r) => r.ref)).toEqual(['1']);
  });
});

describe('loadBulk', () => {
  it('returns nothing for a missing directory', () => {
    expect(loadBulk(path.join(tempDir(), 'absent'))).toEqual([]);
  });

  it('reads json files in name order, ignores other files and de-duplicates by fdcId', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ FoundationFoods: [detail(2), detail(3)] }));
    writeFileSync(path.join(dir, 'a.json'), JSON.stringify([detail(1, { dataType: 'Foundation' }), detail(2, { dataType: 'Foundation' })]));
    writeFileSync(path.join(dir, 'notes.txt'), 'not json');
    const records = loadBulk(dir);
    expect(records.map((r) => r.sourceRef)).toEqual(['1', '2', '3']);
    expect(records.every((r) => r.provider === 'fdc')).toBe(true);
  });
});

describe('loadFixtures', () => {
  const product = (code: string, name = 'Plain yogurt') => ({ code, product_name: name, nutriments: { 'energy-kcal_100g': 60 } });

  it('returns nothing when neither fixture directory exists', () => {
    expect(loadFixtures(tempDir())).toEqual([]);
  });

  it('lists usda records before off products and de-duplicates within each provider', () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'usda'));
    mkdirSync(path.join(root, 'off'));
    writeFileSync(path.join(root, 'usda', 'a.json'), JSON.stringify([detail(5, { dataType: 'Foundation' })]));
    writeFileSync(path.join(root, 'usda', 'b.json'), JSON.stringify([detail(5, { dataType: 'Foundation' })]));
    writeFileSync(path.join(root, 'off', 'a.json'), JSON.stringify({ products: [product('123'), product('123')] }));
    const records = loadFixtures(root);
    expect(records.map((r) => `${r.provider}:${r.sourceRef}`)).toEqual(['fdc:5', 'off:123']);
  });

  it('keeps an fdc id and an off code that share the same text as separate records', () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'usda'));
    mkdirSync(path.join(root, 'off'));
    writeFileSync(path.join(root, 'usda', 'a.json'), JSON.stringify([detail(42, { dataType: 'Foundation' })]));
    writeFileSync(path.join(root, 'off', 'a.json'), JSON.stringify({ products: [product('42')] }));
    expect(loadFixtures(root).map((r) => r.provider)).toEqual(['fdc', 'off']);
  });

  it('keeps unnamed off products as rejected results rather than dropping them', () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'off'));
    writeFileSync(path.join(root, 'off', 'a.json'), JSON.stringify({ products: [product('9', '  ')] }));
    const [record] = loadFixtures(root);
    expect(record?.result.ok).toBe(false);
  });
});
