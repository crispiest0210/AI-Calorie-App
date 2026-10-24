import { describe, expect, it } from 'vitest';
import { matchQueries } from '@nt/core';
import { matchLabel } from '../src/routes/matching';
import type { Sql } from '../src/db';

type Row = { id: string; name: string; quality_tier: string };

/** A catalog stub that answers each search needle with canned rows. */
function catalog(byNeedle: Record<string, Row[]>) {
  const needles: string[] = [];
  const sql = {
    query: async (_text: string, params: unknown[]) => {
      const needle = params[0] as string;
      needles.push(needle);
      return { rows: (byNeedle[needle] ?? []).map((r) => ({ brand: null, kind: 'food', energy: null, ...r })) };
    },
  } as unknown as Sql;
  return { sql, needles };
}

const rice = { id: 'f1', name: 'Rice, white, cooked', quality_tier: 'lab' };
const brownRice = { id: 'f2', name: 'Rice, brown, cooked', quality_tier: 'lab' };

describe('matchLabel', () => {
  it('tries each broader query in turn and lowercases the needle', async () => {
    const { sql, needles } = catalog({});
    await matchLabel(sql, 'Grilled Chicken Breast', undefined);
    expect(needles).toEqual(matchQueries('Grilled Chicken Breast').map((q) => q.toLowerCase()));
    expect(needles.length).toBeGreaterThan(1);
  });

  it('returns each food once even when several queries find it', async () => {
    const { sql } = catalog({ 'cooked rice': [rice], 'rice': [rice, brownRice] });
    const candidates = await matchLabel(sql, 'cooked rice', undefined);
    const ids = candidates.map((c) => c.foodId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('f1');
  });

  it('maps ranked candidates to the server shape', async () => {
    const { sql } = catalog({ rice: [rice] });
    const [first] = await matchLabel(sql, 'rice', undefined);
    expect(first).toMatchObject({ foodId: 'f1', name: 'Rice, white, cooked', qualityTier: 'lab' });
    expect(first!.score).toBeGreaterThan(0);
  });

  it('honours the limit', async () => {
    const { sql } = catalog({ rice: [rice, brownRice] });
    expect(await matchLabel(sql, 'rice', undefined, 1)).toHaveLength(1);
  });

  it('returns nothing when the catalog has no candidates', async () => {
    const { sql } = catalog({});
    expect(await matchLabel(sql, 'dragonfruit', undefined)).toEqual([]);
  });
});
