/**
 * The API as a Node process: the Hono app, the image store, the vision model
 * and the retention sweeper, wired from the environment. Tests build the app
 * with `createApp` directly; this file is only the deployment shape.
 *
 *   DATABASE_URL               Postgres, connecting as the non-owner API role
 *   SUPABASE_JWT_SECRET        verifies access tokens (HS256)
 *   SUPABASE_URL               } photo storage; both or neither. Without them
 *   SUPABASE_SERVICE_ROLE_KEY  } photo analysis reports itself unavailable.
 *   PHOTO_BUCKET               bucket name, default `meal-photos`
 *   ANTHROPIC_API_KEY          the vision model; absent disables analysis
 *   PHOTO_MODEL                optional model override
 *   PORT                       default 8787
 */
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createPool } from './db';
import { startRetentionSweeper } from './retention';
import { SupabaseImageStore, type ImageStore } from './storage';
import { ClaudeMealImageAnalyzer } from './vision/claude';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

const pool = createPool({ connectionString: required('DATABASE_URL') });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const images: ImageStore | undefined =
  supabaseUrl && serviceKey
    ? new SupabaseImageStore({ url: supabaseUrl, serviceKey, bucket: process.env.PHOTO_BUCKET ?? 'meal-photos' })
    : undefined;

const analyzer = process.env.ANTHROPIC_API_KEY
  ? new ClaudeMealImageAnalyzer({ ...(process.env.PHOTO_MODEL ? { model: process.env.PHOTO_MODEL } : {}) })
  : undefined;

const app = createApp({
  pool,
  auth: { jwtSecret: required('SUPABASE_JWT_SECRET') },
  ...(images ? { images } : {}),
  ...(analyzer ? { analyzer } : {}),
});

// Counts only: no paths, ids or content in server logs (spec 2.8).
const stopSweeper = images
  ? startRetentionSweeper(pool, images, {
      onReport: (report) => {
        if (report.abandoned + report.deleted + report.failed > 0) console.info('retention sweep', report);
      },
      onError: () => console.error('retention sweep failed'),
    })
  : () => undefined;

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.info(`api listening on :${info.port}`, { photos: images !== undefined, analysis: analyzer !== undefined });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopSweeper();
    server.close();
    void pool.end();
  });
}
