import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_LIMIT, MIN_SEARCH_LENGTH, normalizeGtin, search } from '../src/routes/foods';
import type { Sql } from '../src/db';

describe('normalizeGtin', () => {
  it('pads UPC-A and EAN-13 to 14 digits so they compare equal', () => {
    expect(normalizeGtin('049000028911')).toBe('00049000028911');
    expect(normalizeGtin('0049000028911')).toBe('00049000028911');
  });

  it('ignores spaces and hyphens in a scanned code', () => {
    expect(normalizeGtin('0 49000-02891 1')).toBe('00049000028911');
  });

  it('keeps an already-14-digit code unchanged', () => {
    expect(normalizeGtin('10049000028918')).toBe('10049000028918');
  });

  it('rejects empty, non-numeric and over-long input', () => {
    expect(normalizeGtin('')).toBeNull();
    expect(normalizeGtin('abc')).toBeNull();
    expect(normalizeGtin('123456789012345')).toBeNull();
  });
});

describe('search limits', () => {
  function recorder() {
    const calls: unknown[][] = [];
    const sql = {
      query: async (_text: string, params: unknown[]) => {
        calls.push(params);
        return { rows: [] };
      },
    } as unknown as Sql;
    return { sql, calls };
  }

  it('does not query for a needle shorter than the minimum', async () => {
    const { sql, calls } = recorder();
    expect(await search(sql, 'a'.repeat(MIN_SEARCH_LENGTH - 1))).toEqual([]);
    expect(await search(sql, '   ')).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('trims and lowercases the query and builds the prefix pattern', async () => {
    const { sql, calls } = recorder();
    await search(sql, '  Rice ');
    expect(calls[0]).toEqual(['rice', 'rice%', MAX_SEARCH_LIMIT]);
  });

  it('clamps the limit between 1 and the maximum', async () => {
    const { sql, calls } = recorder();
    await search(sql, 'rice', 1000);
    await search(sql, 'rice', 0);
    await search(sql, 'rice', 7);
    expect(calls.map((c) => c[2])).toEqual([MAX_SEARCH_LIMIT, 1, 7]);
  });
});
