/**
 * Where catalog records come from. Two paths, one canonical output:
 *  - `fixtures`: the committed slice under /fixtures, so CI and a fresh clone
 *    can build a working catalog with no API key.
 *  - `bulk`: the monthly FoodData Central bulk download, which is the
 *    production path (spec 2.5 — mirror the bulk files, don't call per request).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  fromFdcDetail,
  fromFdcSearchHit,
  normalizeFdcFood,
  normalizeOffProduct,
  type FdcDetailRecord,
  type FdcSearchHit,
  type NormalizeResult,
  type OffProductRecord,
} from '@nt/core';

export interface SourcedRecord {
  provider: 'fdc' | 'off';
  sourceRef: string;
  result: NormalizeResult;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

function jsonFiles(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f));
}

/**
 * Bulk files name their dataset in the wrapping key, and the rows inside do
 * not repeat it — so the key is where `dataType` comes from.
 */
const BULK_DATA_TYPES: Record<string, string> = {
  FoundationFoods: 'Foundation',
  SRLegacyFoods: 'SR Legacy',
  SurveyFoods: 'Survey (FNDDS)',
  BrandedFoods: 'Branded',
};

/** FDC hands the same food back as a search hit, a detail record, or a bulk row. */
export function fdcRecordsFrom(body: unknown): { ref: string; result: NormalizeResult }[] {
  const out: { ref: string; result: NormalizeResult }[] = [];
  const push = (record: FdcSearchHit | FdcDetailRecord, detail: boolean) => {
    const neutral = detail ? fromFdcDetail(record as FdcDetailRecord) : fromFdcSearchHit(record as FdcSearchHit);
    out.push({ ref: String(record.fdcId), result: normalizeFdcFood(neutral) });
  };

  if (Array.isArray(body)) {
    for (const record of body as FdcDetailRecord[]) push(record, true);
    return out;
  }
  const obj = body as Record<string, unknown>;
  if (Array.isArray(obj.foods)) {
    for (const record of obj.foods as FdcSearchHit[]) push(record, false);
    return out;
  }
  // Bulk downloads nest under the dataset name, e.g. { FoundationFoods: [...] }.
  for (const [key, value] of Object.entries(obj)) {
    if (!Array.isArray(value)) continue;
    const dataType = BULK_DATA_TYPES[key];
    for (const record of value as FdcDetailRecord[]) {
      if (typeof record?.fdcId !== 'number') continue;
      push(dataType === undefined ? record : { ...record, dataType: record.dataType ?? dataType }, true);
    }
  }
  return out;
}

export function loadFixtures(root: string): SourcedRecord[] {
  const out: SourcedRecord[] = [];
  const seen = new Set<string>();

  for (const file of jsonFiles(path.join(root, 'usda'))) {
    for (const { ref, result } of fdcRecordsFrom(readJson(file))) {
      if (seen.has(`fdc:${ref}`)) continue;
      seen.add(`fdc:${ref}`);
      out.push({ provider: 'fdc', sourceRef: ref, result });
    }
  }
  for (const file of jsonFiles(path.join(root, 'off'))) {
    for (const product of readJson<{ products: OffProductRecord[] }>(file).products) {
      if (seen.has(`off:${product.code}`)) continue;
      seen.add(`off:${product.code}`);
      out.push({ provider: 'off', sourceRef: product.code, result: normalizeOffProduct(product) });
    }
  }
  return out;
}

export function loadBulk(dir: string): SourcedRecord[] {
  const out: SourcedRecord[] = [];
  const seen = new Set<string>();
  for (const file of jsonFiles(dir)) {
    for (const { ref, result } of fdcRecordsFrom(readJson(file))) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      out.push({ provider: 'fdc', sourceRef: ref, result });
    }
  }
  return out;
}
