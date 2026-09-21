/**
 * Snapshots a handful of real Open Food Facts products as golden fixtures for
 * the normalizer. OFF asks callers to identify themselves and limits reads to
 * 15/min, so this runs by hand and its output is committed.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, '..', '..', '..', 'fixtures', 'off');
const UA = 'nutrition-tracker/0.1 (golden fixtures; contact via repository)';
const FIELDS = 'code,product_name,brands,serving_size,serving_quantity,nutriments';

const QUERIES = [
  { name: 'breakfast-cereals', params: 'categories_tags_en=Breakfast cereals' },
  { name: 'greek-yogurts', params: 'categories_tags_en=Greek yogurts' },
  { name: 'peanut-butters', params: 'categories_tags_en=Peanut butters' },
  { name: 'olive-oils', params: 'categories_tags_en=Olive oils' },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const query of QUERIES) {
    const file = path.join(OUT, `${query.name}.json`);
    if (existsSync(file)) {
      console.log(`· ${query.name} (cached)`);
      continue;
    }
    const url = `https://world.openfoodfacts.org/api/v2/search?${query.params}&fields=${FIELDS}&page_size=5&sort_by=popularity_key`;
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`${query.name} → ${res.status}`);
    const body = await res.json();
    await writeFile(file, JSON.stringify({ products: body.products ?? [] }, null, 1) + '\n');
    console.log(`✓ ${query.name} (${(body.products ?? []).length})`);
    await new Promise((r) => setTimeout(r, 5000)); // stay under 15 reads/min
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
