/**
 * Pulls a seed slice of FoodData Central into committed fixtures so the bundled
 * catalog can be rebuilt in CI with no API key. The production path is the
 * monthly *bulk* download (see build-catalog.ts --source=bulk); this script
 * only assembles the starter catalog and the golden test records.
 *
 * Usage: FDC_API_KEY=... node src/fetch-usda.mjs
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const KEY = process.env.FDC_API_KEY ?? 'DEMO_KEY';
const BASE = 'https://api.nal.usda.gov/fdc/v1';
const OUT = path.join(import.meta.dirname, '..', '..', '..', 'fixtures', 'usda');

/** Cooked staples the Foundation set does not carry; SR Legacy and FNDDS do. */
const SR_QUERIES = [
  'rice cooked',
  'chicken breast roasted',
  'oats',
  'bread whole wheat',
  'pasta cooked',
  'egg cooked',
  'milk',
  'yogurt greek plain',
  'cheese cheddar',
  'beans black cooked',
  'potato baked',
  'ground beef cooked',
  'peanut butter',
  'olive oil',
  'banana raw',
];

/** Foods worth a detail fetch, which is the only place household portions live. */
const DETAIL_LIMIT = 120;

async function api(pathname, body) {
  const url = `${BASE}${pathname}?api_key=${KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function cached(name, produce) {
  const file = path.join(OUT, name);
  if (existsSync(file)) {
    console.log(`· ${name} (cached)`);
    return JSON.parse(await readFile(file, 'utf8'));
  }
  const data = await produce();
  await writeFile(file, JSON.stringify(data, null, 1) + '\n');
  console.log(`✓ ${name}`);
  return data;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const foundation = [];
  for (const pageNumber of [1, 2]) {
    const page = await cached(`foundation-p${pageNumber}.json`, () =>
      api('/foods/search', { query: '*', dataType: ['Foundation'], pageSize: 200, pageNumber }),
    );
    foundation.push(...page.foods);
  }

  const srFoods = [];
  for (const query of SR_QUERIES) {
    const slug = query.replace(/\W+/g, '-');
    const page = await cached(`sr-${slug}.json`, () =>
      api('/foods/search', { query, dataType: ['SR Legacy', 'Survey (FNDDS)'], pageSize: 12 }),
    );
    srFoods.push(...page.foods);
  }

  const ranked = [...srFoods, ...foundation];
  const ids = [...new Set(ranked.map((f) => f.fdcId))].slice(0, DETAIL_LIMIT);
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    await cached(`detail-${String(i / 20).padStart(2, '0')}.json`, () =>
      api('/foods', { fdcIds: batch, format: 'full' }),
    );
  }

  console.log(`foundation=${foundation.length} sr=${srFoods.length} detailed=${ids.length}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
