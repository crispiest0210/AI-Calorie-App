import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCatalog, parseArgs } from '../src/build-catalog';
import { fdcRecordsFrom, loadFixtures } from '../src/sources';

const FIXTURES = path.resolve(import.meta.dirname, '..', '..', '..', 'fixtures');

function tempOut(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'catalog-')), 'catalog.sqlite');
}

describe('argument parsing', () => {
  it('defaults to the committed fixture slice', () => {
    expect(parseArgs([])).toMatchObject({ source: 'fixtures' });
    expect(parseArgs(['--source=bulk', '--dir=/tmp/x', '--version=14.3'])).toMatchObject({ source: 'bulk', dir: '/tmp/x', version: '14.3' });
    expect(parseArgs(['nonsense'])).toMatchObject({ source: 'fixtures' });
  });
});

describe('record shapes', () => {
  it('reads search hits, detail arrays and bulk envelopes alike', () => {
    const hit = { fdcId: 1, description: 'A', dataType: 'Foundation', foodNutrients: [{ nutrientId: 1008, unitName: 'KCAL', value: 100 }] };
    expect(fdcRecordsFrom({ foods: [hit] })).toHaveLength(1);
    const detail = { fdcId: 2, description: 'B', dataType: 'SR Legacy', foodNutrients: [{ nutrient: { id: 1008, unitName: 'KCAL' }, amount: 50 }] };
    expect(fdcRecordsFrom([detail])).toHaveLength(1);
    expect(fdcRecordsFrom({ FoundationFoods: [detail] })).toHaveLength(1);
    expect(fdcRecordsFrom({ FoundationFoods: [{ notAFood: true }] })).toHaveLength(0);
    expect(fdcRecordsFrom({ nothing: 1 })).toHaveLength(0);
  });
});

describe('buildCatalog', () => {
  const out = tempOut();
  const records = loadFixtures(FIXTURES);
  const report = buildCatalog(records, { source: 'fixtures', dir: FIXTURES, out, version: 'test' });

  it('imports the committed fixtures', () => {
    expect(report.imported).toBeGreaterThan(400);
    expect(report.byTier.lab).toBeGreaterThan(0);
    expect(report.byTier.crowd).toBe(20);
  });

  it('quarantines implausible records rather than serving them', () => {
    expect(report.quarantined.length).toBeGreaterThan(0);
    expect(report.quarantined.every((q) => q.reasons.length > 0)).toBe(true);
  });

  it('stays well inside the 15 MB bundle budget', () => {
    expect(report.bytes).toBeLessThan(15 * 1024 * 1024);
  });

  it('produces a searchable catalog with exactly one active release per provider', () => {
    const db = new Database(out, { readonly: true });
    const releases = db.prepare('select provider, is_active from source_release').all() as { provider: string; is_active: number }[];
    expect(releases.every((r) => r.is_active === 1)).toBe(true);
    // 'user' is shipped so a custom food has somewhere to attribute itself.
    expect(new Set(releases.map((r) => r.provider))).toEqual(new Set(['fdc', 'off', 'user']));

    const hits = db.prepare(`select food.name from food_fts join food on food.id = food_fts.food_id where food_fts match '"broc"*' limit 5`).all();
    expect(hits.length).toBeGreaterThan(0);

    const orphans = db.prepare('select count(*) as n from food_nutrient where food_id not in (select id from food)').get() as { n: number };
    expect(orphans.n).toBe(0);
    db.close();
  });

  it('rebuilds byte for byte, so the committed catalog can be verified in CI', () => {
    const first = tempOut();
    const second = tempOut();
    const reportA = buildCatalog(records, { source: 'fixtures', dir: FIXTURES, out: first, version: 'fixtures-seed' });
    const reportB = buildCatalog(records, { source: 'fixtures', dir: FIXTURES, out: second, version: 'fixtures-seed' });
    expect(reportB.imported).toBe(reportA.imported);
    expect(reportB.quarantined.map((q) => q.sourceRef)).toEqual(reportA.quarantined.map((q) => q.sourceRef));
    expect(createHash('sha256').update(readFileSync(second)).digest('hex')).toBe(
      createHash('sha256').update(readFileSync(first)).digest('hex'),
    );
  });

  it('refuses a second row for the same barcode', () => {
    const branded = (name: string) => ({
      provider: 'off' as const,
      sourceRef: name,
      result: {
        ok: true as const,
        warnings: [],
        food: {
          kind: 'branded' as const,
          name,
          brand: null,
          gtin: '03017620422003',
          qualityTier: 'crowd' as const,
          sourceRef: name,
          densityGPerMl: null,
          category: null,
          nutrients: [{ code: 'energy_kcal' as const, amountPer100g: '100', derivation: 'reported' as const }],
          portions: [],
        },
      },
    });
    const dupReport = buildCatalog([branded('First'), branded('Second')], { source: 'fixtures', dir: FIXTURES, out: tempOut(), version: 'test' });
    expect(dupReport.imported).toBe(1);
    expect(dupReport.quarantined[0]!.reasons[0]).toContain('duplicate gtin');
  });

  afterAll(() => rmSync(path.dirname(out), { recursive: true, force: true }));
});
