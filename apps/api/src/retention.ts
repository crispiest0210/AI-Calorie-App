/**
 * The retention sweeper as a job (spec 2.8, review item R5): abandon drafts
 * nobody resolved, remove the images whose retention has run out, and only
 * then record them as deleted. The order is the guarantee — a row says
 * "deleted" only after the object store has said so, so a storage outage
 * leaves the row due and the next run tries again rather than forgetting it.
 */
import type { Pool } from 'pg';
import { withService } from './db';
import { markImagesDeleted, sweepExpiredImages } from './routes/photos';
import type { ImageStore } from './storage';

/** How often the server runs the sweep. Retention is 24 h; this is slack. */
export const SWEEP_INTERVAL_MS = 15 * 60_000;

/** One delete call per batch keeps a backlog from becoming one huge request. */
export const SWEEP_BATCH_SIZE = 100;

export interface RetentionReport {
  abandoned: number;
  deleted: number;
  /** Images still due because the store refused or was unreachable. */
  failed: number;
}

export async function runRetentionSweep(pool: Pool, store: ImageStore, now = new Date()): Promise<RetentionReport> {
  const sweep = await withService(pool, (sql) => sweepExpiredImages(sql, now));

  let deleted = 0;
  let failed = 0;
  for (let start = 0; start < sweep.deleted.length; start += SWEEP_BATCH_SIZE) {
    const batch = sweep.deleted.slice(start, start + SWEEP_BATCH_SIZE);
    try {
      await store.remove(batch.map((entry) => entry.storagePath));
    } catch {
      failed += batch.length;
      continue;
    }
    await withService(pool, (sql) => markImagesDeleted(sql, batch.map((entry) => entry.analysisId), now));
    deleted += batch.length;
  }

  return { abandoned: sweep.abandoned.length, deleted, failed };
}

/**
 * Runs the sweep now and then every `intervalMs`, never two at once. Returns a
 * stop function. A failed run is reported and the schedule carries on.
 */
export function startRetentionSweeper(
  pool: Pool,
  store: ImageStore,
  options: { intervalMs?: number; onReport?: (report: RetentionReport) => void; onError?: (error: unknown) => void } = {},
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      options.onReport?.(await runRetentionSweep(pool, store));
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), options.intervalMs ?? SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
