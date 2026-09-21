/**
 * Downloads the FoodData Central bulk datasets — the production path in spec
 * 2.5, and what gives the catalog household portions and composite meals.
 * No API key: these are plain public downloads.
 *
 *   pnpm catalog:fetch && pnpm catalog:build
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const OUT = path.join(import.meta.dirname, '..', '..', '..', 'data', 'fdc');
const BASE = 'https://fdc.nal.usda.gov/fdc-datasets';

/**
 * Pinned releases. Bumping one of these is a deliberate catalog change: it
 * moves every nutrient number, so it belongs in a commit of its own.
 */
export const DATASETS = [
  'FoodData_Central_foundation_food_json_2026-04-30',
  'FoodData_Central_survey_food_json_2024-10-31',
  'FoodData_Central_sr_legacy_food_json_2018-04',
];

async function exists(file) {
  return stat(file).then(() => true).catch(() => false);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const before = new Set(await readdir(OUT));

  for (const name of DATASETS) {
    const zip = path.join(OUT, `${name}.zip`);
    const marker = path.join(OUT, `${name}.done`);
    if (await exists(marker)) {
      console.log(`· ${name} (cached)`);
      continue;
    }

    console.log(`↓ ${name}`);
    const response = await fetch(`${BASE}/${name}.zip`);
    if (!response.ok || response.body === null) throw new Error(`${name} → ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(zip));

    await run('unzip', ['-o', '-q', zip, '-d', OUT]);
    await rm(zip);
    await createWriteStream(marker).close();
  }

  const after = await readdir(OUT);
  const added = after.filter((f) => f.endsWith('.json') && !before.has(f));
  console.log(`ready: ${after.filter((f) => f.endsWith('.json')).length} dataset files${added.length > 0 ? ` (${added.length} new)` : ''}`);
}

main().catch((error) => {
  console.error(error.message);
  console.error('If `unzip` is missing, install it or unzip the files into data/fdc by hand.');
  process.exit(1);
});
