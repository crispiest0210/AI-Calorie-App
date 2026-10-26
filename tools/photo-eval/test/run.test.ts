/**
 * The runner's plumbing: flag parsing, reading a set and its recordings, and
 * the report text people paste into a prompt-change PR.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatReport, loadRecordings, loadSet, parseArgs } from '../src/run';
import type { EvalReport } from '../src/metrics';

describe('parseArgs', () => {
  it('defaults to a free replay with no baseline files', () => {
    const options = parseArgs([]);
    expect(options.live).toBe(false);
    expect(options.baselineOut).toBeNull();
    expect(options.baselineIn).toBeNull();
    expect(options.model).toBe('claude-opus-5');
  });

  it('reads valued and bare flags and ignores anything else', () => {
    const options = parseArgs(['--live', '--baseline=out.json', '--against=old.json', '--model=m', '--set=/s', 'stray']);
    expect(options).toMatchObject({
      live: true,
      baselineOut: 'out.json',
      baselineIn: 'old.json',
      model: 'm',
      setDir: '/s',
    });
  });
});

describe('loading a set', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'photo-eval-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const response = (mealId: string, model: string) => ({
    mealId,
    model,
    promptVersion: 'v1:test',
    recordedAt: '2026-01-01T00:00:00Z',
    raw: {},
  });

  it('parses set.json and fills in isFood', () => {
    writeFileSync(
      path.join(dir, 'set.json'),
      JSON.stringify({ name: 's', catalogVersion: '1', meals: [{ id: 'm', items: [{ foodId: 'f', grams: 5 }] }] }),
    );
    expect(loadSet(dir).meals[0]!.isFood).toBe(true);
  });

  it('rejects a set with a non-positive weighed amount', () => {
    writeFileSync(
      path.join(dir, 'set.json'),
      JSON.stringify({ name: 's', catalogVersion: '1', meals: [{ id: 'm', items: [{ foodId: 'f', grams: 0 }] }] }),
    );
    expect(() => loadSet(dir)).toThrow();
  });

  it('returns no recordings when the directory is missing', () => {
    expect(loadRecordings(dir).size).toBe(0);
  });

  it('merges recordings in filename order, so a later file wins, and skips non-json files', () => {
    const recordings = path.join(dir, 'recordings');
    mkdirSync(recordings);
    writeFileSync(path.join(recordings, 'a.json'), JSON.stringify({ setName: 's', responses: [response('m1', 'old'), response('m2', 'old')] }));
    writeFileSync(path.join(recordings, 'b.json'), JSON.stringify({ setName: 's', responses: [response('m1', 'new')] }));
    writeFileSync(path.join(recordings, 'notes.txt'), 'not json');

    const byMeal = loadRecordings(dir);
    expect([...byMeal.keys()].sort()).toEqual(['m1', 'm2']);
    expect(byMeal.get('m1')!.model).toBe('new');
    expect(byMeal.get('m2')!.model).toBe('old');
  });
});

describe('formatReport', () => {
  const report: EvalReport = {
    setName: 'demo',
    model: 'm',
    promptVersion: 'v1:abc',
    meals: 2,
    items: 4,
    top1Accuracy: 0.5,
    top3Accuracy: 0.75,
    unmatchedRate: 0,
    gramsMdAPE: null,
    rangeCoverage: 1,
    extraItems: 1,
    missedItems: 2,
    schemaViolations: 0,
    nutrientFieldViolations: 0,
    isFoodErrors: 0,
    latencyP50Ms: null,
    latencyP95Ms: null,
    outcomes: [],
  };

  it('prints percentages, with a dash for a metric that has no data', () => {
    const text = formatReport(report);
    expect(text).toContain('top-1 match    50.0%');
    expect(text).toContain('top-3 match    75.0%');
    expect(text).toContain('unmatched      0.0%');
    expect(text).toContain('grams MdAPE    —');
    expect(text).toContain('extra / missed 1 / 2');
  });

  it('adds a latency line only when latencies were recorded', () => {
    expect(formatReport(report)).not.toContain('latency');
    expect(formatReport({ ...report, latencyP50Ms: 800, latencyP95Ms: 2400 })).toContain('latency p50/p95 800ms / 2400ms');
  });
});
