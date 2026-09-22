/**
 * Integration tests run against a real Postgres, because row-level security is
 * the thing under test and no in-memory substitute enforces it. CI supplies
 * DATABASE_URL (a service container); locally an embedded server is started.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { createApp, type AppDeps } from '../src/app';
import { signTestToken, type AuthConfig } from '../src/auth';
import { createPool, withService } from '../src/db';
import { migrate } from '../src/migrate';

export const AUTH: AuthConfig = { jwtSecret: 'test-secret-that-is-long-enough-for-hs256' };

export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';

/** `Response.json()` is `unknown`; tests say what they expect back. */
export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export interface Harness {
  pool: Pool;
  app: ReturnType<typeof createApp>;
  tokenFor: (userId: string, issuedAt?: number) => Promise<string>;
  request: (userId: string, path: string, init?: RequestInit) => Promise<Response>;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
  userReleaseId: string;
}

const USER_RELEASE = '00000000-0000-4000-8000-000000000001';
const FDC_RELEASE = '00000000-0000-4000-8000-000000000002';

let port = 55_000 + Math.floor(Math.random() * 2000);

export async function startHarness(overrides: Partial<AppDeps> = {}): Promise<Harness> {
  let stopServer = async () => {};
  let connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined) {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'nt-pg-'));
    const chosenPort = port++;
    const server = new EmbeddedPostgres({
      databaseDir: path.join(dataDir, 'db'),
      user: 'postgres',
      password: 'postgres',
      port: chosenPort,
      persistent: false,
    });
    await server.initialise();
    await server.start();
    await server.createDatabase('nutrition');
    connectionString = `postgres://postgres:postgres@localhost:${chosenPort}/nutrition`;
    stopServer = async () => {
      await server.stop();
      rmSync(dataDir, { recursive: true, force: true });
    };
  }

  const pool = createPool({ connectionString });
  await migrate(pool);
  await seed(pool);

  const app = createApp({ pool, auth: AUTH, ...overrides });

  const tokenFor = (userId: string, issuedAt?: number) => signTestToken(userId, AUTH, issuedAt);

  return {
    pool,
    app,
    tokenFor,
    userReleaseId: USER_RELEASE,
    async request(userId, urlPath, init = {}) {
      const token = await tokenFor(userId);
      return app.request(urlPath, {
        ...init,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
      });
    },
    async reset() {
      await withService(pool, async (sql) => {
        await sql.query(`truncate log_entry, water_entry, water_preset, goal_profile,
                          user_settings, idempotency_key, sync_watermark, barcode_cache restart identity cascade`);
        // Catalog rows are fixtures too: each test seeds the foods it needs.
        await sql.query(`delete from food`);
      });
    },
    async stop() {
      await pool.end();
      await stopServer();
    },
  };
}

/** The catalog rows every test needs: nutrient definitions and two releases. */
async function seed(pool: Pool): Promise<void> {
  const { NUTRIENT_CODES, NUTRIENT_DEFS } = await import('@nt/core');
  await withService(pool, async (sql) => {
    for (const code of NUTRIENT_CODES) {
      const def = NUTRIENT_DEFS[code];
      await sql.query(
        `insert into nutrient_def (code, display_name, unit, fdc_nutrient_ids, sort_order)
         values ($1,$2,$3,$4,$5) on conflict (code) do nothing`,
        [code, def.displayName, def.unit, JSON.stringify(def.fdcNutrientIds), def.sortOrder],
      );
    }
    await sql.query(
      `insert into source_release (id, provider, dataset, version, is_active)
       values ($1,'user','custom','1',true), ($2,'fdc','sr_legacy','test',true)
       on conflict (id) do nothing`,
      [USER_RELEASE, FDC_RELEASE],
    );
  });
}

export async function insertCatalogFood(
  pool: Pool,
  food: { id: string; name: string; brand?: string | null; gtin?: string | null; tier?: string; energy?: string },
): Promise<void> {
  await withService(pool, async (sql) => {
    await sql.query(
      `insert into food (id, kind, owner_user_id, name, brand, gtin, source_release_id, source_ref, quality_tier)
       values ($1,'generic',null,$2,$3,$4,$5,$6,$7)`,
      [food.id, food.name, food.brand ?? null, food.gtin ?? null, FDC_RELEASE, food.id, food.tier ?? 'lab'],
    );
    await sql.query(
      `insert into food_nutrient (food_id, nutrient_code, amount_per_100g, derivation)
       values ($1,'energy_kcal',$2,'reported')`,
      [food.id, food.energy ?? '100'],
    );
  });
}
