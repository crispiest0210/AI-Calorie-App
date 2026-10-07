/**
 * Phase 4 exit criteria, end to end against real Postgres:
 *   - 0 nutrient fields from the model
 *   - images deleted on schedule (verified by test)
 * plus the draft behaviour the review screen depends on.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { confidenceBand, type ModelResult } from '@nt/core';
import { withService, withUser } from '../src/db';
import * as photos from '../src/routes/photos';
import * as matching from '../src/routes/matching';
import { AnalysisError, type MealImageAnalyzer } from '../src/vision/adapter';
import { insertCatalogFood, json, startHarness, USER_A, USER_B, type Harness } from './harness';

let h: Harness;

const ANALYSIS = '55555555-5555-4555-8555-555555555551';
const RICE = '66666666-6666-4666-8666-666666666661';
const BROCCOLI = '66666666-6666-4666-8666-666666666662';

const IMAGE = { bytes: new Uint8Array([1]), mediaType: 'image/jpeg' as const };

const MODEL_SAID: ModelResult = {
  is_food: true,
  notes: 'Rice is partly hidden.',
  items: [
    {
      label: 'white rice',
      preparation: 'cooked',
      identification_confidence: 0.88,
      portion_grams: { estimate: 150, low: 110, high: 200 },
      portion_basis: 'compared to the fork',
      occluded: true,
    },
    {
      label: 'broccoli',
      identification_confidence: 0.3,
      portion_grams: { estimate: 70, low: 50, high: 95 },
    },
  ],
};

function analyzerSaying(result: ModelResult | AnalysisError): MealImageAnalyzer {
  return {
    analyzeMealImage: vi.fn().mockImplementation(async () => {
      if (result instanceof AnalysisError) throw result;
      return { result, model: 'test-model', promptVersion: 'test-v1', latencyMs: 1234, usage: { inputTokens: 1, outputTokens: 1 }, raw: result };
    }),
  };
}

async function seedAnalysis(userId = USER_A, id = ANALYSIS) {
  await withUser(h.pool, userId, (sql) => photos.createAnalysis(sql, userId, id, `${userId}/${id}.jpg`));
}

async function run(analyzer: MealImageAnalyzer, userId = USER_A, id = ANALYSIS) {
  const outcome = await withUser(h.pool, userId, (sql) =>
    photos.runAnalysis(sql, userId, id, {
      analyzer,
      image: IMAGE,
      matchThreshold: 0.35,
      match: (label, preparation) => matching.matchLabel(sql, label, preparation),
    }),
  );
  if (!outcome.ok) throw photos.failureToProblem(outcome.failure);
  return outcome.draft;
}

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});
beforeEach(async () => {
  await h.reset();
  await withService(h.pool, async (sql) => {
    await sql.query('truncate photo_analysis, photo_analysis_item, photo_analysis_quota cascade');
  });
  await insertCatalogFood(h.pool, { id: RICE, name: 'Rice, white, cooked, no added fat', energy: '130' });
  await insertCatalogFood(h.pool, { id: BROCCOLI, name: 'Broccoli, raw', energy: '34' });
});

describe('the draft', () => {
  beforeEach(() => seedAnalysis());

  it('matches the model’s words to real catalog foods', async () => {
    const draft = await run(analyzerSaying(MODEL_SAID));
    expect(draft.items).toHaveLength(2);
    expect(draft.items[0]!.candidates[0]!.foodId).toBe(RICE);
    expect(draft.items[0]!.matchStatus).toBe('matched');
  });

  it('stores no nutrient value anywhere in the draft', async () => {
    await run(analyzerSaying(MODEL_SAID));
    const { rows } = await h.pool.query('select * from photo_analysis_item');
    for (const row of rows) {
      const text = JSON.stringify(row).toLowerCase();
      expect(text).not.toMatch(/"(calories|energy_kcal|protein_g|carb_g|fat_g|sodium_mg)"/);
      expect(Object.keys(row)).not.toContain('calories');
    }
    // The candidates carry identity and a score, never nutrition.
    expect(new Set(Object.keys(rows[0].candidates[0]))).toEqual(new Set(['foodId', 'name', 'score', 'qualityTier']));
  });

  it('keeps the model’s uncertainty rather than flattening it', async () => {
    const draft = await run(analyzerSaying(MODEL_SAID));
    expect(draft.items[0]!.portionGrams).toMatchObject({ estimate: '150', low: '110', high: '200' });
    expect(draft.items[0]!.occluded).toBe(true);
    expect(draft.items[0]!.identification.band).toBe('likely');
    expect(draft.items[1]!.identification.band).toBe('unsure');
    expect(confidenceBand(0.3)).toBe('unsure');
  });

  it('widens a range that does not contain the model’s own estimate', async () => {
    const draft = await run(
      analyzerSaying({
        is_food: true,
        items: [{ label: 'white rice', identification_confidence: 0.8, portion_grams: { estimate: 300, low: 100, high: 200 } }],
      }),
    );
    expect(draft.items[0]!.portionGrams).toMatchObject({ low: '100', high: '300' });
  });

  it('marks an item unmatched when nothing in the catalog is close enough', async () => {
    const draft = await run(
      analyzerSaying({
        is_food: true,
        items: [{ label: 'zorblax gratin', identification_confidence: 0.7, portion_grams: { estimate: 100, low: 80, high: 120 } }],
      }),
    );
    expect(draft.items[0]!.matchStatus).toBe('unmatched');
    expect(draft.items[0]!.candidates).toEqual([]);
  });

  it('writes nothing to the log: a draft is a proposal, not an entry', async () => {
    await run(analyzerSaying(MODEL_SAID));
    const { rows } = await h.pool.query('select count(*)::int as n from log_entry');
    expect(rows[0].n).toBe(0);
  });

  it('records a failure against the analysis instead of losing it', async () => {
    await expect(run(analyzerSaying(new AnalysisError('not_food', 'a bicycle')))).rejects.toMatchObject({ code: 'not_food' });
    const { rows } = await h.pool.query('select status, failure_kind from photo_analysis where id = $1', [ANALYSIS]);
    expect(rows[0]).toMatchObject({ status: 'failed', failure_kind: 'not_food' });
  });

  it('turns a timeout into its own error code, not a generic one', async () => {
    await expect(run(analyzerSaying(new AnalysisError('timeout', 'slow')))).rejects.toMatchObject({ code: 'analysis_timeout' });
  });
});

describe('quota', () => {
  it('stops after the daily limit, counting failures too', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await withUser(h.pool, USER_A, async (sql) => {
      for (let i = 0; i < photos.DAILY_ANALYSIS_LIMIT; i += 1) await photos.checkQuota(sql, USER_A, today);
    });
    await expect(withUser(h.pool, USER_A, (sql) => photos.checkQuota(sql, USER_A, today))).rejects.toMatchObject({
      code: 'rate_limited',
    });
    // One user's spending does not affect another's.
    await expect(withUser(h.pool, USER_B, (sql) => photos.checkQuota(sql, USER_B, today))).resolves.toBeUndefined();
  });
});

describe('retention', () => {
  const HOUR = 3600_000;

  beforeEach(() => seedAnalysis());

  it('schedules the image for deletion when the draft is resolved', async () => {
    const now = new Date();
    await withUser(h.pool, USER_A, (sql) => photos.resolveAnalysis(sql, USER_A, ANALYSIS, 'confirmed', { now }));
    const { rows } = await h.pool.query('select status, image_expires_at from photo_analysis where id = $1', [ANALYSIS]);
    expect(rows[0].status).toBe('confirmed');
    expect(rows[0].image_expires_at.getTime() - now.getTime()).toBeCloseTo(photos.RETENTION_HOURS * HOUR, -3);
  });

  it('keeps the image when the user opted into a photo journal', async () => {
    await withUser(h.pool, USER_A, (sql) => photos.resolveAnalysis(sql, USER_A, ANALYSIS, 'confirmed', { keepImage: true }));
    const { rows } = await h.pool.query('select image_expires_at from photo_analysis where id = $1', [ANALYSIS]);
    expect(rows[0].image_expires_at).toBeNull();
  });

  it('deletes an image once its retention has run out', async () => {
    const resolvedAt = new Date(Date.now() - 2 * photos.RETENTION_HOURS * HOUR);
    await withUser(h.pool, USER_A, (sql) => photos.resolveAnalysis(sql, USER_A, ANALYSIS, 'confirmed', { now: resolvedAt }));

    const sweep = await withService(h.pool, (sql) => photos.sweepExpiredImages(sql));
    expect(sweep.deleted.map((entry) => entry.analysisId)).toContain(ANALYSIS);
    expect(sweep.deleted[0]!.storagePath).toBe(`${USER_A}/${ANALYSIS}.jpg`);

    await withService(h.pool, (sql) => photos.markImagesDeleted(sql, [ANALYSIS]));
    const { rows } = await h.pool.query('select storage_path, image_deleted_at from photo_analysis where id = $1', [ANALYSIS]);
    expect(rows[0].storage_path).toBeNull();
    expect(rows[0].image_deleted_at).not.toBeNull();
  });

  it('does not delete an image whose retention has not run out', async () => {
    await withUser(h.pool, USER_A, (sql) => photos.resolveAnalysis(sql, USER_A, ANALYSIS, 'confirmed'));
    const sweep = await withService(h.pool, (sql) => photos.sweepExpiredImages(sql));
    expect(sweep.deleted.map((entry) => entry.analysisId)).not.toContain(ANALYSIS);
  });

  it('abandons a draft nobody ever resolved, and then deletes its image', async () => {
    // Review item R5: the gap that retention originally missed.
    await withService(h.pool, async (sql) => {
      await sql.query(`update photo_analysis set created_at = now() - interval '48 hours' where id = $1`, [ANALYSIS]);
    });

    const sweep = await withService(h.pool, (sql) => photos.sweepExpiredImages(sql));
    expect(sweep.abandoned).toContain(ANALYSIS);
    expect(sweep.deleted.map((entry) => entry.analysisId)).toContain(ANALYSIS);

    const { rows } = await h.pool.query('select status from photo_analysis where id = $1', [ANALYSIS]);
    expect(rows[0].status).toBe('abandoned');
  });

  it('deletes on request, idempotently', async () => {
    await withUser(h.pool, USER_A, (sql) => photos.deleteImageNow(sql, USER_A, ANALYSIS));
    const first = await h.pool.query('select image_deleted_at from photo_analysis where id = $1', [ANALYSIS]);
    await withUser(h.pool, USER_A, (sql) => photos.deleteImageNow(sql, USER_A, ANALYSIS));
    const second = await h.pool.query('select image_deleted_at from photo_analysis where id = $1', [ANALYSIS]);
    expect(second.rows[0].image_deleted_at.getTime()).toBe(first.rows[0].image_deleted_at.getTime());
  });
});

describe('another user', () => {
  beforeEach(() => seedAnalysis());

  it('cannot read, resolve or delete someone else’s analysis', async () => {
    await expect(withUser(h.pool, USER_B, (sql) => photos.readDraft(sql, USER_B, ANALYSIS))).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      withUser(h.pool, USER_B, (sql) => photos.resolveAnalysis(sql, USER_B, ANALYSIS, 'confirmed')),
    ).rejects.toMatchObject({ code: 'not_found' });

    await withUser(h.pool, USER_B, (sql) => photos.deleteImageNow(sql, USER_B, ANALYSIS));
    const { rows } = await h.pool.query('select storage_path from photo_analysis where id = $1', [ANALYSIS]);
    expect(rows[0].storage_path).not.toBeNull();
  });

  it('is refused by the API surface too', async () => {
    const res = await h.request(USER_B, `/v1/photo-analyses/${ANALYSIS}`);
    expect(res.status).toBe(404);
    expect(await json<{ code: string }>(res)).toMatchObject({ code: 'not_found' });
  });
});
