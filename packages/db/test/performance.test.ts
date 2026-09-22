/**
 * The performance budgets in spec 2.13, measured against the real bundled
 * catalog — 13.5k foods, not a fixture.
 *
 * These run on a developer machine, so the budgets here are deliberately
 * tighter than the spec's: the spec's numbers are for a mid-range phone, and
 * the headroom is what makes them survivable there. A regression that eats the
 * headroom fails here rather than on someone's phone.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { localDateOf } from '@nt/core';
import { schema } from '../src/schema';
import type { Db } from '../src/db';
import { readDay } from '../src/day';
import * as foods from '../src/repositories/foods';
import * as entries from '../src/repositories/entries';

const CATALOG = path.resolve(import.meta.dirname, '..', '..', '..', 'apps', 'mobile', 'assets', 'catalog.sqlite');

/**
 * A mid-range Android phone is far slower than CI. Ten times is the rule of
 * thumb used here; the assertions leave that much room under the spec.
 */
const PHONE_SLOWDOWN = 10;
const SEARCH_BUDGET_MS = 100 / PHONE_SLOWDOWN;
const SAVE_BUDGET_MS = 50 / PHONE_SLOWDOWN;
const COLD_READ_BUDGET_MS = 2000 / PHONE_SLOWDOWN;

function openCatalog(): Db {
  const sqlite = new Database(CATALOG);
  sqlite.pragma('journal_mode = WAL');
  return drizzle(sqlite, { schema }) as unknown as Db;
}

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

function timed(work: () => unknown): number {
  const start = performance.now();
  work();
  return performance.now() - start;
}

describe.runIf(existsSync(CATALOG))('performance budgets', () => {
  const db = openCatalog();

  it('searches inside the per-keystroke budget, including broad queries', () => {
    const samples: number[] = [];
    const worst: { query: string; ms: number }[] = [];

    for (const term of ['chicken breast', 'rice', 'hamburger', 'coffee', 'broccoli', 'sandwich', 'peanut butter']) {
      for (let length = 2; length <= term.length; length += 1) {
        const query = term.slice(0, length);
        const ms = timed(() => foods.searchFoods(db, query));
        samples.push(ms);
        worst.push({ query, ms });
      }
    }

    worst.sort((a, b) => b.ms - a.ms);
    const p95 = percentile(samples, 0.95);
    expect(p95, `p95 ${p95.toFixed(1)}ms; slowest "${worst[0]!.query}" ${worst[0]!.ms.toFixed(1)}ms`).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it('refuses to rank a one-character query at all', () => {
    // The cheapest way to stay inside the budget for "c" is not to run it.
    expect(foods.toFtsQuery('c')).toBeNull();
    expect(foods.searchFoods(db, 'c')).toEqual([]);
    expect(foods.toFtsQuery('ch')).not.toBeNull();
  });

  it('reads a day fast enough for a cold start', () => {
    const ms = timed(() => readDay(db, localDateOf()));
    expect(ms).toBeLessThan(COLD_READ_BUDGET_MS);
  });

  it('browses a meal category within a frame', () => {
    const categories = foods.mealCategories(db);
    expect(categories.length).toBeGreaterThan(0);
    const ms = timed(() => foods.foodsInCategory(db, categories[0]!.category));
    expect(ms).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it('turns a search result into a loggable food within a frame', () => {
    const [first] = foods.searchFoods(db, 'rice');
    expect(first).toBeDefined();
    const ms = timed(() => foods.foodDetail(db, first!.id));
    expect(ms).toBeLessThan(SAVE_BUDGET_MS);
  });

  it('keeps recents and frequents cheap on a large catalog', () => {
    expect(timed(() => foods.recentFoods(db))).toBeLessThan(SEARCH_BUDGET_MS);
    expect(timed(() => foods.frequentFoods(db, 0))).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it('reads a day through an index rather than scanning the log', () => {
    // The budget only holds while this stays an index lookup; a dropped index
    // would still pass the timing tests on an empty log and fail on a full one.
    const plan = db.all<{ detail: string }>(
      sql`explain query plan select * from v_day_entry where local_date = ${localDateOf()}`,
    );
    const detail = plan.map((row) => row.detail).join(' ');
    expect(detail).toContain('log_entry_day_idx');
    expect(detail).not.toMatch(/SCAN log_entry\b/);
    void entries;
  });
});
