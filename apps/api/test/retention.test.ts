/**
 * Phase 4 exit criterion: "images deleted on schedule (verified by test)".
 * These go through the real routes and the real sweeper job against Postgres,
 * with an in-memory object store standing in for the bucket — so "deleted"
 * means the object is gone, not only that a column says so.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModelResult } from '@nt/core';
import { withService } from '../src/db';
import { runRetentionSweep, startRetentionSweeper, SWEEP_BATCH_SIZE } from '../src/retention';
import { RETENTION_HOURS, ABANDON_AFTER_HOURS } from '../src/routes/photos';
import { MemoryImageStore } from '../src/storage';
import type { MealImageAnalyzer } from '../src/vision/adapter';
import { json, startHarness, USER_A, USER_B, type Harness } from './harness';

const HOUR = 3600_000;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);

const EMPTY_PLATE: ModelResult = { is_food: true, items: [] };
const analyzer: MealImageAnalyzer = {
  analyzeMealImage: async () => ({
    result: EMPTY_PLATE, model: 'test-model', promptVersion: 'test-v1', latencyMs: 1,
    usage: { inputTokens: 1, outputTokens: 1 }, raw: EMPTY_PLATE,
  }),
};

const store = new MemoryImageStore();
let h: Harness;

beforeAll(async () => {
  h = await startHarness({ images: store, analyzer });
});
afterAll(async () => {
  await h.stop();
});
beforeEach(async () => {
  await h.reset();
  await withService(h.pool, (sql) => sql.query('truncate photo_analysis, photo_analysis_item, photo_analysis_quota cascade'));
  store.objects.clear();
  store.failing = false;
});

/** Upload-url, then the device's PUT, then run: what the app does. */
async function analyzedPhoto(userId = USER_A): Promise<{ analysisId: string; path: string }> {
  const res = await h.request(userId, '/v1/photos/upload-url', { method: 'POST' });
  expect(res.status).toBe(200);
  const { analysisId } = await json<{ analysisId: string }>(res);
  const path = `${userId}/${analysisId}.jpg`;
  store.put(path, JPEG);

  const run = await h.request(userId, `/v1/photo-analyses/${analysisId}/run`, { method: 'POST' });
  expect(run.status).toBe(200);
  return { analysisId, path };
}

async function resolve(analysisId: string, body: Record<string, unknown>, userId = USER_A) {
  const res = await h.request(userId, `/v1/photo-analyses/${analysisId}/resolve`, { method: 'POST', body: JSON.stringify(body) });
  expect(res.status).toBe(204);
}

async function row(analysisId: string) {
  const { rows } = await h.pool.query('select status, storage_path, image_deleted_at from photo_analysis where id = $1', [analysisId]);
  return rows[0];
}

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR);

describe('the scheduled sweep', () => {
  it('removes a confirmed meal’s photo from the bucket once retention runs out', async () => {
    const { analysisId, path } = await analyzedPhoto();
    await resolve(analysisId, { status: 'confirmed' });

    // Inside the window: nothing happens.
    expect(await runRetentionSweep(h.pool, store, hoursFromNow(RETENTION_HOURS - 1))).toMatchObject({ deleted: 0 });
    expect(store.objects.has(path)).toBe(true);

    // Past it: the object goes, and then the row says so.
    expect(await runRetentionSweep(h.pool, store, hoursFromNow(RETENTION_HOURS + 1))).toMatchObject({ deleted: 1, failed: 0 });
    expect(store.objects.has(path)).toBe(false);
    expect(await row(analysisId)).toMatchObject({ status: 'confirmed', storage_path: null });
    expect((await row(analysisId)).image_deleted_at).not.toBeNull();

    // The draft outlives its photo, and asking to analyse it again says why.
    const again = await h.request(USER_A, `/v1/photo-analyses/${analysisId}/run`, { method: 'POST' });
    expect(again.status).toBe(404);
  });

  it('abandons a draft nobody resolved and removes its photo in the same run', async () => {
    const { analysisId, path } = await analyzedPhoto();
    const report = await runRetentionSweep(h.pool, store, hoursFromNow(ABANDON_AFTER_HOURS + 1));
    expect(report).toMatchObject({ abandoned: 1, deleted: 1 });
    expect(store.objects.has(path)).toBe(false);
    expect(await row(analysisId)).toMatchObject({ status: 'abandoned', storage_path: null });
  });

  it('never removes a photo the user chose to keep', async () => {
    const { analysisId, path } = await analyzedPhoto();
    await resolve(analysisId, { status: 'confirmed', keepImage: true });
    await runRetentionSweep(h.pool, store, hoursFromNow(24 * 365));
    expect(store.objects.has(path)).toBe(true);
  });

  it('keeps a photo due through a storage outage and removes it on the next run', async () => {
    const { analysisId, path } = await analyzedPhoto();
    await resolve(analysisId, { status: 'abandoned' });

    store.failing = true;
    expect(await runRetentionSweep(h.pool, store, hoursFromNow(RETENTION_HOURS + 1))).toMatchObject({ deleted: 0, failed: 1 });
    expect(await row(analysisId)).toMatchObject({ storage_path: path, image_deleted_at: null });

    store.failing = false;
    expect(await runRetentionSweep(h.pool, store, hoursFromNow(RETENTION_HOURS + 2))).toMatchObject({ deleted: 1, failed: 0 });
    expect(store.objects.has(path)).toBe(false);
  });

  it('works through a backlog larger than one batch', async () => {
    const count = SWEEP_BATCH_SIZE + 5;
    await withService(h.pool, async (sql) => {
      for (let i = 0; i < count; i += 1) {
        const id = crypto.randomUUID();
        const path = `${USER_A}/${id}.jpg`;
        store.put(path, JPEG);
        await sql.query(
          `insert into photo_analysis (id, user_id, status, storage_path, image_expires_at) values ($1,$2,'confirmed',$3, now())`,
          [id, USER_A, path],
        );
      }
    });
    expect(await runRetentionSweep(h.pool, store, hoursFromNow(1))).toMatchObject({ deleted: count });
    expect(store.objects.size).toBe(0);
  });

  it('runs on start and on its interval until stopped', async () => {
    const { analysisId, path } = await analyzedPhoto();
    await withService(h.pool, (sql) =>
      sql.query(`update photo_analysis set image_expires_at = now() - interval '1 minute' where id = $1`, [analysisId]),
    );

    const reports: unknown[] = [];
    const stop = startRetentionSweeper(h.pool, store, { intervalMs: 60_000, onReport: (report) => reports.push(report) });
    await expect.poll(() => reports.length).toBeGreaterThan(0);
    stop();
    expect(store.objects.has(path)).toBe(false);
  });
});

describe('DELETE /v1/photos/:id', () => {
  it('removes the photo from the bucket now, not at the next sweep', async () => {
    const { analysisId, path } = await analyzedPhoto();
    const res = await h.request(USER_A, `/v1/photos/${analysisId}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(store.objects.has(path)).toBe(false);
    expect(await row(analysisId)).toMatchObject({ storage_path: null });

    // Idempotent.
    expect((await h.request(USER_A, `/v1/photos/${analysisId}`, { method: 'DELETE' })).status).toBe(204);
  });

  it('reports a storage outage, and the sweeper finishes the job', async () => {
    const { analysisId, path } = await analyzedPhoto();
    store.failing = true;
    const res = await h.request(USER_A, `/v1/photos/${analysisId}`, { method: 'DELETE' });
    expect(res.status).toBe(502);

    store.failing = false;
    await runRetentionSweep(h.pool, store);
    expect(store.objects.has(path)).toBe(false);
  });

  it('cannot remove another user’s photo', async () => {
    const { analysisId, path } = await analyzedPhoto(USER_A);
    expect((await h.request(USER_B, `/v1/photos/${analysisId}`, { method: 'DELETE' })).status).toBe(204);
    expect(store.objects.has(path)).toBe(true);
  });
});

describe('DELETE /v1/me', () => {
  it('removes every photo and analysis the user had, and nobody else’s', async () => {
    const mine = await analyzedPhoto(USER_A);
    const kept = await analyzedPhoto(USER_A);
    await resolve(kept.analysisId, { status: 'confirmed', keepImage: true });
    const theirs = await analyzedPhoto(USER_B);

    const res = await h.request(USER_A, '/v1/me', { method: 'DELETE' });
    expect(res.status).toBe(204);

    expect(store.objects.has(mine.path)).toBe(false);
    expect(store.objects.has(kept.path)).toBe(false);
    expect(store.objects.has(theirs.path)).toBe(true);

    const { rows } = await h.pool.query('select user_id from photo_analysis');
    expect(rows.map((r) => r.user_id)).toEqual([USER_B]);
    const quota = await h.pool.query('select user_id from photo_analysis_quota');
    expect(quota.rows.map((r) => r.user_id)).toEqual([USER_B]);
  });

  it('deletes nothing when the photos cannot be removed, so a retry is safe', async () => {
    const { analysisId, path } = await analyzedPhoto(USER_A);
    store.failing = true;

    const res = await h.request(USER_A, '/v1/me', { method: 'DELETE' });
    expect(res.status).toBe(502);
    expect(await row(analysisId)).toMatchObject({ storage_path: path });

    store.failing = false;
    expect((await h.request(USER_A, '/v1/me', { method: 'DELETE' })).status).toBe(204);
    expect(store.objects.has(path)).toBe(false);
  });
});
