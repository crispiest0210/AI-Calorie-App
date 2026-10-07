/**
 * The API (spec 4). One Hono app, deployable as a Supabase Edge Function or on
 * Node; every route but health requires a bearer token, and every handler runs
 * inside a transaction that declares the caller so RLS applies.
 */
import { Hono } from 'hono';
import type { Pool } from 'pg';
import { MATCH_THRESHOLD, pullResponse, pushRequest } from '@nt/core';
import { bearerToken, verifyToken, type AuthConfig, type AuthenticatedUser } from './auth';
import { withUser } from './db';
import { ApiError, problemResponse } from './errors';
import { RateLimiter } from './rate-limit';
import { replay, remember } from './idempotency';
import * as sync from './routes/sync';
import * as foods from './routes/foods';
import * as me from './routes/me';
import * as photos from './routes/photos';
import * as matching from './routes/matching';
import type { MealImageAnalyzer } from './vision/adapter';

export interface AppDeps {
  pool: Pool;
  auth: AuthConfig;
  limiter?: RateLimiter;
  /** Upstream barcode lookup; omitted in tests and offline development. */
  fetchBarcode?: (gtin: string) => Promise<Awaited<ReturnType<typeof foods.detail>> | null>;
  /** Photo analysis; absent means the photo routes report it unavailable. */
  analyzer?: MealImageAnalyzer;
  /** Reads an uploaded image back for analysis. */
  readImage?: (storagePath: string) => Promise<{ bytes: Uint8Array; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }>;
  /** Hands out a signed upload URL for the private bucket. */
  createUploadUrl?: (storagePath: string) => Promise<{ uploadUrl: string; expiresAt: string }>;
}

type Env = { Variables: { user: AuthenticatedUser } };

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>();
  const limiter = deps.limiter ?? new RateLimiter();

  app.onError((error, c) => {
    if (error instanceof ApiError) return problemResponse(c, error);
    console.error('unhandled', error);
    return problemResponse(c, new ApiError('server_error'));
  });

  app.get('/v1/health', (c) => c.json({ status: 'ok' }));

  app.use('/v1/*', async (c, next) => {
    if (c.req.path === '/v1/health') return next();
    const user = await verifyToken(bearerToken(c.req.header('authorization')), deps.auth);
    c.set('user', user);
    await next();
  });

  app.get('/v1/foods/search', async (c) => {
    const user = c.get('user');
    limiter.check(user.id, 'search');
    const query = c.req.query('q') ?? '';
    const limit = Number.parseInt(c.req.query('limit') ?? '25', 10);
    const results = await withUser(deps.pool, user.id, (sql) =>
      foods.search(sql, query, Number.isFinite(limit) ? limit : 25),
    );
    return c.json({ results });
  });

  app.get('/v1/foods/barcode/:gtin', async (c) => {
    const user = c.get('user');
    limiter.check(user.id, 'barcode');
    const food = await withUser(deps.pool, user.id, (sql) =>
      foods.lookupBarcode(sql, c.req.param('gtin'), { ...(deps.fetchBarcode ? { fetchUpstream: deps.fetchBarcode } : {}) }),
    );
    // Thrown out here, after the transaction that recorded the miss committed.
    if (food === null) throw new ApiError('not_found', 'no product for that barcode');
    return c.json(food);
  });

  app.get('/v1/foods/:id', async (c) => {
    const user = c.get('user');
    const food = await withUser(deps.pool, user.id, (sql) => foods.detail(sql, c.req.param('id')));
    return c.json(food);
  });

  app.post('/v1/sync/push', async (c) => {
    const user = c.get('user');
    limiter.check(user.id, 'sync');
    const parsed = pushRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError('validation_failed', parsed.error.issues[0]?.message);

    const key = c.req.header('idempotency-key');
    const response = await withUser(deps.pool, user.id, async (sql) => {
      const previous = await replay(sql, user.id, key);
      if (previous !== null) return previous;
      const result = await sync.push(sql, user.id, parsed.data);
      await remember(sql, user.id, key, result);
      return result;
    });
    return c.json(response);
  });

  app.get('/v1/sync/pull', async (c) => {
    const user = c.get('user');
    limiter.check(user.id, 'sync');
    const cursor = Number.parseInt(c.req.query('cursor') ?? '0', 10);
    if (!Number.isFinite(cursor) || cursor < 0) throw new ApiError('validation_failed', 'cursor must be a non-negative integer');
    const result = await withUser(deps.pool, user.id, (sql) => sync.pull(sql, user.id, cursor));
    return c.json(pullResponse.parse(result));
  });

  app.post('/v1/photos/upload-url', async (c) => {
    const user = c.get('user');
    if (deps.createUploadUrl === undefined) throw new ApiError('upstream_unavailable', 'photo analysis is not configured');

    const analysisId = crypto.randomUUID();
    const storagePath = `${user.id}/${analysisId}.jpg`;
    const signed = await deps.createUploadUrl(storagePath);
    await withUser(deps.pool, user.id, (sql) => photos.createAnalysis(sql, user.id, analysisId, storagePath));
    return c.json({ analysisId, uploadUrl: signed.uploadUrl, expiresAt: signed.expiresAt });
  });

  app.post('/v1/photo-analyses/:id/run', async (c) => {
    const user = c.get('user');
    if (deps.analyzer === undefined || deps.readImage === undefined) {
      throw new ApiError('upstream_unavailable', 'photo analysis is not configured');
    }
    const analysisId = c.req.param('id');

    const storagePath = await withUser(deps.pool, user.id, async (sql) => {
      // The quota is taken before the model is called, so a failed analysis
      // still costs the caller a slot — otherwise a bad image is free to retry
      // forever (review item R12).
      await photos.checkQuota(sql, user.id, new Date().toISOString().slice(0, 10));
      const { rows } = await sql.query<{ storage_path: string | null }>(
        'select storage_path from photo_analysis where id = $1 and user_id = $2',
        [analysisId, user.id],
      );
      if (rows[0] === undefined) throw new ApiError('not_found', 'no such analysis');
      if (rows[0].storage_path === null) throw new ApiError('not_found', 'this image has been deleted');
      return rows[0].storage_path;
    });

    const image = await deps.readImage(storagePath);
    const outcome = await withUser(deps.pool, user.id, (sql) =>
      photos.runAnalysis(sql, user.id, analysisId, {
        analyzer: deps.analyzer!,
        image,
        matchThreshold: MATCH_THRESHOLD,
        match: (label, preparation) => matching.matchLabel(sql, label, preparation),
      }),
    );
    // Thrown out here, after the transaction recording the failure committed.
    if (!outcome.ok) throw photos.failureToProblem(outcome.failure);
    return c.json(outcome.draft);
  });

  app.get('/v1/photo-analyses/:id', async (c) => {
    const user = c.get('user');
    const draft = await withUser(deps.pool, user.id, (sql) => photos.readDraft(sql, user.id, c.req.param('id')));
    return c.json(draft);
  });

  app.post('/v1/photo-analyses/:id/resolve', async (c) => {
    const user = c.get('user');
    const body = (await c.req.json().catch(() => ({}))) as { status?: string; keepImage?: boolean };
    if (body.status !== 'confirmed' && body.status !== 'abandoned') {
      throw new ApiError('validation_failed', 'status must be confirmed or abandoned');
    }
    await withUser(deps.pool, user.id, (sql) =>
      photos.resolveAnalysis(sql, user.id, c.req.param('id'), body.status as 'confirmed' | 'abandoned', {
        keepImage: body.keepImage === true,
      }),
    );
    return c.body(null, 204);
  });

  app.delete('/v1/photos/:id', async (c) => {
    const user = c.get('user');
    await withUser(deps.pool, user.id, (sql) => photos.deleteImageNow(sql, user.id, c.req.param('id')));
    return c.body(null, 204);
  });

  app.get('/v1/me/export', async (c) => {
    const user = c.get('user');
    const document = await withUser(deps.pool, user.id, (sql) => me.exportAll(sql, user.id));
    return c.json(document);
  });

  app.delete('/v1/me', async (c) => {
    const user = c.get('user');
    await withUser(deps.pool, user.id, (sql) => me.deleteAccount(sql, user.id, user.issuedAt));
    return c.body(null, 204);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

