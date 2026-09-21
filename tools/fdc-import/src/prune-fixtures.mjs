/**
 * FDC responses carry ~80 nutrients and a lot of metadata we never read.
 * Fixtures are pruned to the fields the normalizer uses so the committed
 * seed data stays small and diffs stay readable.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const USDA = path.join(import.meta.dirname, '..', '..', '..', 'fixtures', 'usda');

/** Internal codes plus 1062 (energy kJ), which is only a fallback. */
const KEEP_NUTRIENTS = new Set([1008, 2048, 2047, 1062, 1003, 1004, 1005, 1050, 1079, 2033, 2000, 1063, 1258, 1093, 1092, 1087, 1089, 1253, 1162]);

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '').map((k) => [k, obj[k]]));

const HEAD = ['fdcId', 'description', 'dataType', 'brandOwner', 'brandName', 'gtinUpc', 'servingSize', 'servingSizeUnit', 'householdServingFullText'];

function pruneSearchHit(food) {
  return {
    ...pick(food, HEAD),
    foodNutrients: (food.foodNutrients ?? [])
      .filter((n) => KEEP_NUTRIENTS.has(n.nutrientId) && n.value !== undefined && n.value !== null)
      .map((n) => ({ nutrientId: n.nutrientId, unitName: n.unitName, value: n.value })),
  };
}

function pruneDetail(food) {
  return {
    ...pick(food, HEAD),
    foodNutrients: (food.foodNutrients ?? [])
      .filter((n) => KEEP_NUTRIENTS.has(n.nutrient?.id) && n.amount !== undefined && n.amount !== null)
      .map((n) => ({ nutrient: { id: n.nutrient.id, unitName: n.nutrient.unitName }, amount: n.amount })),
    foodPortions: (food.foodPortions ?? []).map((p) => ({
      ...pick(p, ['amount', 'modifier', 'portionDescription', 'gramWeight']),
      ...(p.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? { measureUnit: { name: p.measureUnit.name } } : {}),
    })),
  };
}

async function main() {
  for (const name of await readdir(USDA)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(USDA, name);
    const body = JSON.parse(await readFile(file, 'utf8'));
    const pruned = Array.isArray(body)
      ? body.map(pruneDetail)
      : { foods: (body.foods ?? []).map(pruneSearchHit) };
    await writeFile(file, JSON.stringify(pruned, null, 1) + '\n');
    console.log(`✓ ${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
