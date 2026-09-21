import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertCatalogFood, json, startHarness, USER_A, USER_B, type Harness } from './harness';

interface FoodRow {
  id: string;
  name: string;
  qualityTier: string;
  nutrientsPer100g: Record<string, string>;
  source: { provider: string; dataset: string | null; citationUrl: string | null };
}

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});
beforeEach(async () => {
  await h.reset();
});

describe('conventions', () => {
  it('serves health without a token', async () => {
    const res = await h.app.request('/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('refuses every other route without a valid token', async () => {
    expect((await h.app.request('/v1/sync/pull')).status).toBe(401);
    const bad = await h.app.request('/v1/sync/pull', { headers: { authorization: 'Bearer nonsense' } });
    expect(bad.status).toBe(401);
    const problem = await bad.json();
    expect(problem).toMatchObject({ code: 'unauthorized', status: 401, title: expect.any(String) });
    expect(bad.headers.get('content-type')).toContain('application/problem+json');
  });

  it('reports validation failures as problem+json', async () => {
    const res = await h.request(USER_A, '/v1/sync/push', { method: 'POST', body: JSON.stringify({ changes: 'nope' }) });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'validation_failed' });
  });

  it('rejects a malformed cursor', async () => {
    const res = await h.request(USER_A, '/v1/sync/pull?cursor=-4');
    expect(res.status).toBe(422);
  });
});

describe('food catalog', () => {
  beforeEach(async () => {
    await insertCatalogFood(h.pool, { id: '33333333-3333-4333-8333-333333333331', name: 'Rice, cooked, NFS', tier: 'survey', energy: '129' });
    await insertCatalogFood(h.pool, { id: '33333333-3333-4333-8333-333333333332', name: 'Rice noodles, cooked', tier: 'lab', energy: '108' });
    await insertCatalogFood(h.pool, { id: '33333333-3333-4333-8333-333333333333', name: 'Rice noodles, cooked', tier: 'survey', energy: '107' });
  });

  it('ranks the plain food first and collapses cross-dataset duplicates', async () => {
    const res = await h.request(USER_A, '/v1/foods/search?q=rice');
    expect(res.status).toBe(200);
    const { results } = await json<{ results: FoodRow[] }>(res);
    expect(results[0]!.name).toBe('Rice, cooked, NFS');
    expect(results.filter((r) => r.name === 'Rice noodles, cooked')).toHaveLength(1);
    expect(results.find((r) => r.name === 'Rice noodles, cooked')!.qualityTier).toBe('lab');
  });

  it('returns nutrients as decimal strings, never floats', async () => {
    const res = await h.request(USER_A, '/v1/foods/33333333-3333-4333-8333-333333333331');
    const food = await json<FoodRow>(res);
    expect(food.nutrientsPer100g.energy_kcal).toBe('129');
    expect(typeof food.nutrientsPer100g.energy_kcal).toBe('string');
  });

  it('cites the source record', async () => {
    const res = await h.request(USER_A, '/v1/foods/33333333-3333-4333-8333-333333333331');
    const food = await json<FoodRow>(res);
    expect(food.source).toMatchObject({ provider: 'fdc', dataset: 'sr_legacy' });
    expect(food.source.citationUrl).toContain('fdc.nal.usda.gov');
  });

  it('404s an unknown food and an empty search', async () => {
    expect((await h.request(USER_A, '/v1/foods/33333333-3333-4333-8333-33333333dead')).status).toBe(404);
    const { results } = await json<{ results: FoodRow[] }>(await h.request(USER_A, '/v1/foods/search?q=%20'));
    expect(results).toEqual([]);
  });
});

describe('barcode', () => {
  it('finds a catalog product and caches the lookup', async () => {
    await insertCatalogFood(h.pool, {
      id: '44444444-4444-4444-8444-444444444441',
      name: 'Oat bar',
      gtin: '00049000028911',
      energy: '410',
    });
    const res = await h.request(USER_A, '/v1/foods/barcode/049000028911');
    expect(res.status).toBe(200);
    expect((await json<FoodRow>(res)).name).toBe('Oat bar');

    const cached = await h.pool.query('select gtin, food_id from barcode_cache');
    expect(cached.rows[0].gtin).toBe('00049000028911');
  });

  it('remembers a miss so the upstream is not asked twice', async () => {
    let calls = 0;
    const solo = await startHarness({
      fetchBarcode: async () => {
        calls += 1;
        return null;
      },
    });
    try {
      expect((await solo.request(USER_A, '/v1/foods/barcode/1234567890123')).status).toBe(404);
      expect((await solo.request(USER_A, '/v1/foods/barcode/1234567890123')).status).toBe(404);
      expect(calls).toBe(1);
    } finally {
      await solo.stop();
    }
  });

  it('rejects something that is not a barcode', async () => {
    expect((await h.request(USER_A, '/v1/foods/barcode/abc')).status).toBe(422);
  });
});

describe('rate limits', () => {
  it('returns 429 with Retry-After once the search budget is spent', async () => {
    let res = new Response();
    for (let i = 0; i < 61; i += 1) res = await h.request(USER_B, '/v1/foods/search?q=rice');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect(await res.json()).toMatchObject({ code: 'rate_limited' });
  });
});
