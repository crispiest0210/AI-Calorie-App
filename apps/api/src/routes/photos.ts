/**
 * Photo analysis endpoints (spec 4.2, 4.3).
 *
 * The shape of this module is the AI boundary: `run` asks the model what and
 * how much, asks the catalog which foods those words could mean, and stores a
 * draft. Nothing it writes is a nutrient value, and nothing it writes is in
 * the log — the user confirms, and then the app logs foods the ordinary way.
 */
import { confidenceBand, normalizePortion, type ModelResult } from '@nt/core';
import { ApiError } from '../errors';
import type { Sql } from '../db';
import { AnalysisError, type MealImage, type MealImageAnalyzer } from '../vision/adapter';

/** Review item R12: cost control, and a ceiling on abuse. */
export const DAILY_ANALYSIS_LIMIT = 30;

/** Spec 2.8: the server copy goes 24 hours after the draft is resolved. */
export const RETENTION_HOURS = 24;

/** Spec 2.8/R5: a draft nobody ever resolved is abandoned, not kept forever. */
export const ABANDON_AFTER_HOURS = 24;

export interface DraftItem {
  itemId: string;
  label: string;
  description: string | null;
  preparation: string | null;
  identification: { confidence: number; band: string };
  portionGrams: { estimate: string; low: string; high: string; basis: string | null };
  occluded: boolean;
  matchStatus: 'matched' | 'unmatched';
  candidates: { foodId: string; name: string; score: number; qualityTier: string }[];
}

export interface PhotoDraft {
  analysisId: string;
  status: string;
  model: string | null;
  items: DraftItem[];
  notes: string | null;
}

export async function checkQuota(sql: Sql, userId: string, today: string): Promise<void> {
  const { rows } = await sql.query<{ used: number }>(
    `insert into photo_analysis_quota (user_id, local_day, used) values ($1, $2, 1)
     on conflict (user_id, local_day) do update set used = photo_analysis_quota.used + 1
     returning used`,
    [userId, today],
  );
  if ((rows[0]?.used ?? 0) > DAILY_ANALYSIS_LIMIT) {
    throw new ApiError('rate_limited', `at most ${DAILY_ANALYSIS_LIMIT} photo analyses a day`);
  }
}

export async function createAnalysis(sql: Sql, userId: string, id: string, storagePath: string): Promise<void> {
  await sql.query(
    `insert into photo_analysis (id, user_id, status, storage_path) values ($1,$2,'pending',$3)`,
    [id, userId, storagePath],
  );
}

export interface MatchFn {
  (label: string, preparation: string | undefined): Promise<{ foodId: string; name: string; score: number; qualityTier: string }[]>;
}

export interface RunOptions {
  analyzer: MealImageAnalyzer;
  image: MealImage;
  /** Matching runs against the catalog, not the model. */
  match: MatchFn;
  matchThreshold: number;
  now?: Date;
}

export type RunOutcome =
  | { ok: true; draft: PhotoDraft }
  | { ok: false; failure: 'not_food' | 'timeout' | 'schema' | 'refused' | 'upstream' };

/**
 * Returns the failure rather than throwing it. The caller's transaction has to
 * commit for the `failed` row to survive — throwing from in here would roll
 * back the very record of the failure, and the analysis would look pending
 * forever.
 */
export async function runAnalysis(sql: Sql, userId: string, analysisId: string, options: RunOptions): Promise<RunOutcome> {
  const owned = await sql.query<{ id: string; status: string }>(
    'select id, status from photo_analysis where id = $1 and user_id = $2',
    [analysisId, userId],
  );
  if (owned.rows[0] === undefined) throw new ApiError('not_found', 'no such analysis');

  let outcome;
  try {
    outcome = await options.analyzer.analyzeMealImage(options.image);
  } catch (error) {
    const kind = error instanceof AnalysisError ? error.kind : 'upstream';
    await sql.query(
      `update photo_analysis set status = 'failed', failure_kind = $2, analyzed_at = now() where id = $1`,
      [analysisId, kind],
    );
    return { ok: false, failure: kind };
  }

  const draft = await storeDraft(sql, analysisId, outcome.result, {
    model: outcome.model,
    promptVersion: outcome.promptVersion,
    latencyMs: outcome.latencyMs,
    match: options.match,
    matchThreshold: options.matchThreshold,
  });
  return { ok: true, draft };
}

/** Maps an analysis failure onto the problem code the app maps to copy. */
export function failureToProblem(failure: Exclude<RunOutcome, { ok: true }>['failure']): ApiError {
  if (failure === 'not_food') return new ApiError('not_food', 'this photo does not appear to show food');
  if (failure === 'timeout') return new ApiError('analysis_timeout', 'the analysis took too long');
  return new ApiError('upstream_unavailable', 'the analysis service could not be reached');
}

export async function storeDraft(
  sql: Sql,
  analysisId: string,
  result: ModelResult,
  meta: { model: string; promptVersion: string; latencyMs: number; match: MatchFn; matchThreshold: number },
): Promise<PhotoDraft> {
  await sql.query(
    `update photo_analysis
     set status = 'analyzed', model = $2, prompt_version = $3, latency_ms = $4,
         is_food = $5, notes = $6, analyzed_at = now()
     where id = $1`,
    [analysisId, meta.model, meta.promptVersion, meta.latencyMs, result.is_food, result.notes ?? null],
  );
  await sql.query('delete from photo_analysis_item where analysis_id = $1', [analysisId]);

  const items: DraftItem[] = [];
  for (const [position, item] of result.items.entries()) {
    const portion = normalizePortion(item.portion_grams);
    const candidates = (await meta.match(item.label, item.preparation)).slice(0, 3);
    // No candidate clears the bar, so the app will make the person choose.
    // There is deliberately no fallback that invents nutrition (spec 2.7).
    const matchStatus = candidates.length > 0 && candidates[0]!.score >= meta.matchThreshold ? 'matched' : 'unmatched';

    const { rows } = await sql.query<{ id: string }>(
      `insert into photo_analysis_item
         (id, analysis_id, position, label, description, preparation, confidence,
          grams_estimate, grams_low, grams_high, portion_basis, occluded, match_status, candidates)
       values (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id`,
      [
        analysisId, position, item.label, item.description ?? null, item.preparation ?? null,
        item.identification_confidence, portion.estimate, portion.low, portion.high,
        item.portion_basis ?? null, item.occluded ?? false, matchStatus, JSON.stringify(candidates),
      ],
    );

    items.push({
      itemId: rows[0]!.id,
      label: item.label,
      description: item.description ?? null,
      preparation: item.preparation ?? null,
      identification: { confidence: item.identification_confidence, band: confidenceBand(item.identification_confidence) },
      portionGrams: { estimate: portion.estimate, low: portion.low, high: portion.high, basis: item.portion_basis ?? null },
      occluded: item.occluded ?? false,
      matchStatus,
      candidates,
    });
  }

  return { analysisId, status: 'analyzed', model: meta.model, items, notes: result.notes ?? null };
}

export async function readDraft(sql: Sql, userId: string, analysisId: string): Promise<PhotoDraft> {
  const { rows } = await sql.query(
    'select id, status, model, notes from photo_analysis where id = $1 and user_id = $2',
    [analysisId, userId],
  );
  const analysis = rows[0];
  if (analysis === undefined) throw new ApiError('not_found', 'no such analysis');

  const items = await sql.query(
    `select id, label, description, preparation, confidence, grams_estimate, grams_low, grams_high,
            portion_basis, occluded, match_status, candidates
     from photo_analysis_item where analysis_id = $1 order by position`,
    [analysisId],
  );

  return {
    analysisId: analysis.id,
    status: analysis.status,
    model: analysis.model,
    notes: analysis.notes,
    items: items.rows.map((row) => ({
      itemId: row.id,
      label: row.label,
      description: row.description,
      preparation: row.preparation,
      identification: { confidence: Number(row.confidence), band: confidenceBand(Number(row.confidence)) },
      portionGrams: {
        estimate: String(row.grams_estimate),
        low: String(row.grams_low),
        high: String(row.grams_high),
        basis: row.portion_basis,
      },
      occluded: row.occluded,
      matchStatus: row.match_status,
      candidates: row.candidates,
    })),
  };
}

/**
 * Records what the user did with the draft and schedules the image for
 * deletion. Confirming does not write log entries here: the device writes them
 * locally and syncs them, like every other entry.
 */
export async function resolveAnalysis(
  sql: Sql,
  userId: string,
  analysisId: string,
  status: 'confirmed' | 'abandoned',
  options: { keepImage?: boolean; now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const expiresAt = options.keepImage === true ? null : new Date(now.getTime() + RETENTION_HOURS * 3600_000);

  const { rowCount } = await sql.query(
    `update photo_analysis set status = $3, resolved_at = $4, image_expires_at = $5
     where id = $1 and user_id = $2`,
    [analysisId, userId, status, now, expiresAt],
  );
  if (rowCount === 0) throw new ApiError('not_found', 'no such analysis');
}

export async function deleteImageNow(sql: Sql, userId: string, analysisId: string, now = new Date()): Promise<void> {
  // Idempotent by design (spec 4.2): deleting an already-deleted image is fine.
  await sql.query(
    `update photo_analysis set image_deleted_at = coalesce(image_deleted_at, $3), storage_path = null
     where id = $1 and user_id = $2`,
    [analysisId, userId, now],
  );
}

export interface SweepResult {
  abandoned: string[];
  deleted: { analysisId: string; storagePath: string }[];
}

/**
 * The retention sweeper (spec 2.8, review item R5). Two jobs: abandon drafts
 * nobody ever resolved, and delete images whose retention has run out. It
 * returns the storage paths so the caller can remove the objects; a row is
 * only marked deleted once that has happened.
 */
export async function sweepExpiredImages(sql: Sql, now = new Date()): Promise<SweepResult> {
  const abandonBefore = new Date(now.getTime() - ABANDON_AFTER_HOURS * 3600_000);

  const abandoned = await sql.query<{ id: string }>(
    `update photo_analysis
     set status = 'abandoned', resolved_at = $1, image_expires_at = $1
     where status in ('pending','analyzed','failed') and created_at < $2
     returning id`,
    [now, abandonBefore],
  );

  const due = await sql.query<{ id: string; storage_path: string }>(
    `select id, storage_path from photo_analysis
     where image_deleted_at is null and storage_path is not null
       and image_expires_at is not null and image_expires_at <= $1`,
    [now],
  );

  return {
    abandoned: abandoned.rows.map((row) => row.id),
    deleted: due.rows.map((row) => ({ analysisId: row.id, storagePath: row.storage_path })),
  };
}

/** Called once the object store has actually removed the file. */
export async function markImagesDeleted(sql: Sql, analysisIds: readonly string[], now = new Date()): Promise<void> {
  if (analysisIds.length === 0) return;
  await sql.query(
    `update photo_analysis set image_deleted_at = $2, storage_path = null where id = any($1::uuid[])`,
    [[...analysisIds], now],
  );
}
