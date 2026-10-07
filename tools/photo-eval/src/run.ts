/**
 * The eval runner (spec 6.1, AI evaluation).
 *
 *   pnpm eval:photo                        # replay recorded responses, free
 *   pnpm eval:photo -- --live              # call the model, costs money
 *   pnpm eval:photo -- --baseline=out.json # write a new baseline
 *
 * Replay is the default on purpose. A recorded run makes the eval free,
 * deterministic and runnable in CI, which is what lets it gate a prompt change;
 * live mode is for establishing a baseline against a new model.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ANALYSIS_PROMPT } from '@nt/core';
import { matcher, schema, type Db } from '@nt/db';
import { labeledSet, recordedRun, type LabeledSet, type RecordedResponse } from './types';
import { compareToBaseline, scoreMeal, summarize, type EvalReport } from './metrics';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const DEFAULT_SET = path.join(import.meta.dirname, '..', 'fixtures');
const CATALOG = path.join(ROOT, 'apps', 'mobile', 'assets', 'catalog.sqlite');

/** A prompt change must change this, or a baseline comparison is meaningless. */
export const PROMPT_VERSION = `v1:${hash(ANALYSIS_PROMPT)}`;

function hash(text: string): string {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) value = (Math.imul(31, value) + text.charCodeAt(i)) | 0;
  return (value >>> 0).toString(16).padStart(8, '0');
}

export function openCatalog(file = CATALOG): Db {
  const sqlite = new Database(file, { readonly: true });
  return drizzle(sqlite, { schema }) as unknown as Db;
}

export interface RunOptions {
  setDir: string;
  live: boolean;
  baselineOut: string | null;
  baselineIn: string | null;
  model: string;
}

export function parseArgs(argv: readonly string[]): RunOptions {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) flags.set(match[1]!, match[2] ?? 'true');
  }
  return {
    setDir: flags.get('set') ?? DEFAULT_SET,
    live: flags.get('live') === 'true',
    baselineOut: flags.get('baseline') ?? null,
    baselineIn: flags.get('against') ?? null,
    model: flags.get('model') ?? 'claude-opus-5',
  };
}

export function loadSet(setDir: string): LabeledSet {
  return labeledSet.parse(JSON.parse(readFileSync(path.join(setDir, 'set.json'), 'utf8')));
}

export function loadRecordings(setDir: string): Map<string, RecordedResponse> {
  const byMeal = new Map<string, RecordedResponse>();
  const dir = path.join(setDir, 'recordings');
  if (!existsSync(dir)) return byMeal;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const run = recordedRun.parse(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
    for (const response of run.responses) byMeal.set(response.mealId, response);
  }
  return byMeal;
}

/**
 * Scores a set against responses that already exist. The matcher runs for
 * real against the real catalog — matching is as much of what is being
 * evaluated as the model is.
 */
export function evaluate(input: {
  db: Db;
  set: LabeledSet;
  responses: Map<string, RecordedResponse>;
  model: string;
  promptVersion: string;
}): EvalReport {
  const outcomes = input.set.meals.flatMap((meal) => {
    const response = input.responses.get(meal.id);
    if (response === undefined) return [];
    return [
      scoreMeal({
        meal,
        raw: response.raw,
        latencyMs: response.latencyMs ?? null,
        candidatesFor: (label, preparation) =>
          matcher.matchLabel(input.db, label, preparation).candidates.map((candidate) => candidate.food.id),
      }),
    ];
  });

  return summarize({ setName: input.set.name, model: input.model, promptVersion: input.promptVersion, outcomes });
}

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

export function formatReport(report: EvalReport): string {
  const lines = [
    `set            ${report.setName}`,
    `model          ${report.model}  prompt ${report.promptVersion}`,
    `meals / items  ${report.meals} / ${report.items}`,
    '',
    `top-1 match    ${percent(report.top1Accuracy)}`,
    `top-3 match    ${percent(report.top3Accuracy)}`,
    `unmatched      ${percent(report.unmatchedRate)}`,
    `grams MdAPE    ${percent(report.gramsMdAPE)}   (spec 1 target: <= 30%)`,
    `range covered  ${percent(report.rangeCoverage)}`,
    `extra / missed ${report.extraItems} / ${report.missedItems}`,
    '',
    `schema fails   ${report.schemaViolations}   (must be 0)`,
    `nutrient leaks ${report.nutrientFieldViolations}   (must be 0)`,
    `is_food wrong  ${report.isFoodErrors}`,
  ];
  if (report.latencyP95Ms !== null) {
    lines.push('', `latency p50/p95 ${report.latencyP50Ms}ms / ${report.latencyP95Ms}ms   (spec 2.13: p95 < 12000ms)`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const set = loadSet(options.setDir);

  if (options.live) {
    console.error(
      'Live mode calls the model once per meal and costs money.\n' +
        'It is not wired into this runner yet: record responses with\n' +
        '  pnpm --filter @nt/api run record-eval -- --set=<dir>\n' +
        'and then replay them here.',
    );
    process.exit(2);
  }

  const responses = loadRecordings(options.setDir);
  if (responses.size === 0) {
    console.error(`No recorded responses under ${path.join(options.setDir, 'recordings')}.`);
    process.exit(1);
  }

  const db = openCatalog();
  const report = evaluate({ db, set, responses, model: options.model, promptVersion: PROMPT_VERSION });
  console.log(formatReport(report));

  const baseline = options.baselineIn !== null && existsSync(options.baselineIn)
    ? (JSON.parse(readFileSync(options.baselineIn, 'utf8')) as EvalReport)
    : null;
  const verdict = compareToBaseline(report, baseline);

  if (options.baselineOut !== null) {
    writeFileSync(options.baselineOut, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nbaseline written to ${options.baselineOut}`);
  }

  if (!verdict.passed) {
    console.error(`\nFAILED:\n  ${verdict.failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nPASSED');
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  await main();
}
