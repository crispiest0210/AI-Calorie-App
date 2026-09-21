/**
 * Builds the bundled offline catalog (spec 2.3): a prebuilt SQLite file the app
 * ships with, so search and logging work with no network. Records that fail a
 * sanity check are quarantined into a report instead of being served (2.6.8).
 *
 *   pnpm catalog:seed                      # from the committed /fixtures slice
 *   pnpm catalog:import -- --dir=data/fdc  # from a monthly FDC bulk download
 */
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { NUTRIENT_CODES, NUTRIENT_DEFS } from '@nt/core';
import { applyPragmas, foods, runMigrations, schema, type Db, type RawSqlite } from '@nt/db';
import { loadBulk, loadFixtures, type SourcedRecord } from './sources';
import { stableId } from './stable-ids';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const DEFAULT_OUT = path.join(ROOT, 'apps', 'mobile', 'assets', 'catalog.sqlite');
/**
 * Spec 2.3 budgets the bundled catalog at "< 15 MB compressed", and 2.13
 * budgets the whole app download at 60 MB. Both are about what ships, so the
 * gate is the compressed size; the on-disk size is reported alongside it
 * because that is what the file costs on the device.
 */
const COMPRESSED_BUDGET_BYTES = 15 * 1024 * 1024;

interface Options {
  source: 'fixtures' | 'bulk';
  dir: string;
  out: string;
  version: string;
}

function parseArgs(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) flags.set(match[1]!, match[2]!);
  }
  const source = flags.get('source') === 'bulk' ? 'bulk' : 'fixtures';
  // Paths are relative to the repository root, not to whichever package
  // directory pnpm happens to run the script from.
  const resolve = (value: string) => (path.isAbsolute(value) ? value : path.join(ROOT, value));
  const dir = flags.get('dir');
  return {
    source,
    dir: dir === undefined ? path.join(ROOT, source === 'bulk' ? 'data/fdc' : 'fixtures') : resolve(dir),
    out: flags.get('out') === undefined ? DEFAULT_OUT : resolve(flags.get('out')!),
    // Versioned by what went into it, never by the build date: a rebuild from
    // the same datasets has to produce the same file for CI to verify it.
    version: flags.get('version') ?? 'pending',
  };
}

function openCatalog(file: string, appliedAt: number): { db: Db; sqlite: Database.Database } {
  rmSync(file, { force: true });
  mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  const raw: RawSqlite = {
    execute: (sql) => {
      sqlite.exec(sql);
    },
    select: (sql) => sqlite.prepare(sql).all() as never[],
  };
  applyPragmas(raw);
  runMigrations(raw, undefined, appliedAt);
  return { db: drizzle(sqlite, { schema }) as unknown as Db, sqlite };
}

export interface BuildReport {
  imported: number;
  quarantined: { sourceRef: string; provider: string; reasons: string[] }[];
  warnings: number;
  /** On-disk size of the SQLite file. */
  bytes: number;
  /** What it costs in the app download, which is the budgeted number. */
  compressedBytes: number;
  withPortions: number;
  byTier: Record<string, number>;
}

export function buildCatalog(records: readonly SourcedRecord[], options: Options): BuildReport {
  // A fixed instant, derived from the release version, keeps rebuilds identical.
  const now = Date.parse(`${options.version}T00:00:00Z`) || 0;
  const { db, sqlite } = openCatalog(options.out, now);

  for (const code of NUTRIENT_CODES) {
    const def = NUTRIENT_DEFS[code];
    db.insert(schema.nutrientDef)
      .values({ code, displayName: def.displayName, unit: def.unit, fdcNutrientIds: JSON.stringify(def.fdcNutrientIds), sortOrder: def.sortOrder })
      .run();
  }

  const releases = new Map<string, string>();
  const releaseFor = (provider: 'fdc' | 'off' | 'user') => {
    const existing = releases.get(provider);
    if (existing) return existing;
    const id = stableId('release', `${provider}:${options.version}`);
    db.insert(schema.sourceRelease)
      .values({
        id,
        provider,
        dataset: provider === 'fdc' ? options.source : provider === 'off' ? 'barcode_cache' : 'custom',
        version: options.version,
        releasedOn: /^\d{4}-\d{2}-\d{2}$/.test(options.version) ? options.version : null,
        importedAt: now,
        // Search only ever reads the active release; rollback re-points it (R1).
        isActive: 1,
      })
      .run();
    releases.set(provider, id);
    return id;
  };

  // Foods the user types in are their own provenance, not USDA's. The release
  // row has to exist before one can be saved, so the catalog ships with it.
  releaseFor('user');

  const report: BuildReport = { imported: 0, quarantined: [], warnings: 0, bytes: 0, compressedBytes: 0, withPortions: 0, byTier: {} };
  const seenGtin = new Set<string>();

  db.transaction((tx) => {
    for (const record of records) {
      if (!record.result.ok) {
        report.quarantined.push({ sourceRef: record.sourceRef, provider: record.provider, reasons: record.result.reasons });
        continue;
      }
      const canonical = record.result.food;
      // The catalog has one row per barcode; a duplicate is a data problem, not a food.
      if (canonical.gtin !== null) {
        if (seenGtin.has(canonical.gtin)) {
          report.quarantined.push({ sourceRef: record.sourceRef, provider: record.provider, reasons: [`duplicate gtin ${canonical.gtin}`] });
          continue;
        }
        seenGtin.add(canonical.gtin);
      }
      const foodId = stableId(record.provider, record.sourceRef);
      foods.insertFood(tx, canonical, {
        id: foodId,
        sourceReleaseId: releaseFor(record.provider),
        synced: false,
        now,
        portionId: (index) => stableId('portion', `${foodId}:${index}`),
      });
      report.imported += 1;
      if (canonical.portions.length > 0) report.withPortions += 1;
      report.warnings += record.result.warnings.length;
      report.byTier[canonical.qualityTier] = (report.byTier[canonical.qualityTier] ?? 0) + 1;
    }
  });

  sqlite.exec("insert into food_fts(food_fts) values('optimize');");
  sqlite.exec('vacuum;');
  sqlite.close();
  report.bytes = statSync(options.out).size;
  report.compressedBytes = gzipSync(readFileSync(options.out), { level: 9 }).length;
  return report;
}

/** The dataset releases that went in, so the version names its own inputs. */
function versionOf(options: Options): string {
  if (options.source === 'fixtures') return 'fixtures-seed';
  const dates = readdirSync(options.dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => /(\d{4}-\d{2}(?:-\d{2})?)/.exec(f)?.[1] ?? f.replace(/\.json$/, ''))
    .sort();
  return dates.join('+') || 'bulk';
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  const options = parsed.version === 'pending' ? { ...parsed, version: versionOf(parsed) } : parsed;
  const records = options.source === 'bulk' ? loadBulk(options.dir) : loadFixtures(options.dir);
  if (records.length === 0) {
    console.error(`No records found in ${options.dir}. For --source=bulk, download the FDC JSON files first.`);
    process.exit(1);
  }

  const report = buildCatalog(records, options);
  const quarantineFile = path.join(path.dirname(options.out), 'catalog-quarantine.json');
  writeFileSync(quarantineFile, JSON.stringify(report.quarantined, null, 2) + '\n');

  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
  const servingShare = report.imported === 0 ? 0 : Math.round((report.withPortions / report.imported) * 100);
  console.log(`source      ${options.source} (${options.dir})`);
  console.log(`imported    ${report.imported} foods  ${JSON.stringify(report.byTier)}`);
  console.log(`servings    ${report.withPortions} foods have at least one household portion (${servingShare}%)`);
  console.log(`quarantined ${report.quarantined.length} → ${path.relative(ROOT, quarantineFile)}`);
  console.log(`warnings    ${report.warnings}`);
  console.log(`output      ${path.relative(ROOT, options.out)} — ${mb(report.compressedBytes)} MB in the download, ${mb(report.bytes)} MB on disk`);

  if (report.compressedBytes > COMPRESSED_BUDGET_BYTES) {
    console.error(`Catalog is ${mb(report.compressedBytes)} MB compressed, over the 15 MB budget in spec 2.3.`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) main();

export { parseArgs };
