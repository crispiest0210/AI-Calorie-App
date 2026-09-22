/**
 * The Amount step (spec 5.2): number field, unit picker limited to what the
 * source actually supports, a live nutrient preview, and the source badge.
 * Entering logs and closes.
 */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CORE_CODES,
  MEAL_SLOTS,
  MEAL_SLOT_LABELS,
  NUTRIENT_DEFS,
  availableUnits,
  defaultAmount,
  formatWithUnit,
  gramsToUnit,
  localDateOf,
  resolveGrams,
  scalePer100g,
  type AmountUnit,
  type MealSlot,
} from '@nt/core';
import { entries as entriesRepo, foods as foodsRepo } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { spacing, useTheme } from '@/theme';
import { successFeedback } from '@/hooks/useHaptics';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { NumberField } from '@/components/NumberField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SourceBadge } from '@/components/SourceBadge';

const UNIT_LABELS: Record<AmountUnit, string> = { g: 'grams', ml: 'mL', portion: 'servings', kcal: 'cal' };

const FAILURE_COPY: Record<string, string> = {
  amount_not_positive: 'Enter an amount above zero.',
  density_unknown: 'This food has no density, so mL cannot be converted to grams.',
  portion_unknown: 'Pick a portion.',
  energy_unit_needs_quick_add: 'Use Quick add to log calories on their own.',
};

export default function AmountScreen() {
  const db = useDb();
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ foodId: string; mealSlot?: string; date?: string; entryId?: string }>();
  const date = params.date ?? localDateOf();

  const food = useDbQuery((database) => foodsRepo.foodDetail(database, params.foodId), [params.foodId]);
  const lastAmount = useDbQuery((database) => foodsRepo.lastAmountFor(database, params.foodId), [params.foodId]);

  const [mealSlot, setMealSlot] = useState<MealSlot>(
    MEAL_SLOTS.includes(params.mealSlot as MealSlot) ? (params.mealSlot as MealSlot) : 'breakfast',
  );

  /**
   * How the amount is seeded, in order of what the person most likely means:
   * what they logged last for this food, else one of the source's servings,
   * else 100 g. Grams are always one tap away in the picker.
   */
  const seed = useMemo(() => {
    if (lastAmount !== null) {
      return {
        unit: lastAmount.amountUnit as AmountUnit,
        portionId: lastAmount.portionId,
        value: lastAmount.amountValue,
      };
    }
    return food === null ? { unit: 'g' as AmountUnit, portionId: null, value: '100' } : defaultAmount(food);
  }, [lastAmount, food]);

  const [unit, setUnit] = useState<AmountUnit>(seed.unit);
  const [portionId, setPortionId] = useState<string | null>(seed.portionId);
  const [value, setValue] = useState<string>(seed.value);
  const [seeded, setSeeded] = useState(false);

  // The food and its portions arrive from the first database read, which lands
  // after the first render, so the seed is applied once it is actually known.
  useEffect(() => {
    if (seeded || food === null) return;
    setUnit(seed.unit);
    setPortionId(seed.portionId);
    setValue(seed.value);
    setSeeded(true);
  }, [seeded, food, seed]);

  const units = useMemo(() => (food === null ? ['g' as const] : availableUnits(food)), [food]);
  const resolved = useMemo(() => {
    if (food === null) return null;
    return resolveGrams({ value: value === '' ? '0' : value, unit, portionId }, food);
  }, [food, value, unit, portionId]);

  const preview = useMemo(() => {
    if (food === null || resolved === null || !resolved.ok) return null;
    return scalePer100g(food.nutrientsPer100g, resolved.grams);
  }, [food, resolved]);

  if (food === null) {
    return (
      <Screen>
        <Card>
          <Text tone="muted">That food is no longer in the catalog.</Text>
        </Card>
      </Screen>
    );
  }

  const canSave = resolved !== null && resolved.ok;

  const save = () => {
    if (resolved === null || !resolved.ok) return;
    entriesRepo.logFood(db, {
      foodId: food.id,
      foodName: food.name,
      sourceReleaseId: food.sourceReleaseId,
      mealSlot,
      amountValue: value,
      amountUnit: unit,
      portionId: unit === 'portion' ? portionId : null,
      grams: resolved.grams,
      gramsProvenance: resolved.provenance,
      nutrientsPer100g: food.nutrientsPer100g,
      at: date === localDateOf() ? new Date() : new Date(`${date}T12:00:00`),
    });
    successFeedback();
    router.dismissAll();
  };

  return (
    <Screen>
      <Card style={{ gap: spacing.md }}>
        <Text variant="title">{food.name}</Text>
        {food.brand !== null && (
          <Text variant="label" tone="muted">
            {food.brand}
          </Text>
        )}
        <SourceBadge tier={food.qualityTier} onPress={() => router.push({ pathname: '/provenance', params: { foodId: food.id } })} />
        <Text variant="caption" tone="faint">
          {food.sourceRef === null ? 'Your own entry' : `Source record ${food.sourceRef} · tap the badge for the full source`}
        </Text>
      </Card>

      <Card style={{ gap: spacing.lg }}>
        <NumberField
          label="Amount"
          value={value}
          onChange={setValue}
          suffix={UNIT_LABELS[unit]}
          step={unit === 'portion' ? 1 : 10}
          autoFocus
        />

        <SegmentedControl
          label="Unit"
          options={units.map((u) => ({ value: u, label: UNIT_LABELS[u] }))}
          value={unit}
          onChange={(next) => {
            const grams = resolved?.ok === true ? resolved.grams : null;
            setUnit(next);
            if (next === 'portion' && portionId === null && food.portions[0]) setPortionId(food.portions[0].id);
            if (grams !== null) {
              const converted = gramsToUnit(grams, next, food, next === 'portion' ? portionId ?? food.portions[0]?.id ?? null : null);
              if (converted !== null) setValue(converted);
            }
          }}
        />

        {unit === 'portion' && food.portions.length > 0 && (
          <SegmentedControl
            label="Serving"
            options={food.portions.map((p) => ({ value: p.id, label: `${p.label} · ${p.gramWeight} g` }))}
            value={portionId ?? food.portions[0]!.id}
            onChange={setPortionId}
          />
        )}

        <SegmentedControl
          label="Meal"
          options={MEAL_SLOTS.map((slot) => ({ value: slot, label: MEAL_SLOT_LABELS[slot] }))}
          value={mealSlot}
          onChange={setMealSlot}
        />

        {resolved !== null && !resolved.ok && (
          <Text variant="label" tone="over">
            {FAILURE_COPY[resolved.reason] ?? 'That amount cannot be resolved.'}
          </Text>
        )}
      </Card>

      {preview !== null && (
        <Card style={{ gap: spacing.sm }}>
          <Text variant="label" tone="muted">
            This entry adds
          </Text>
          {CORE_CODES.map((code) => (
            <View key={code} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="label" tone="muted">
                {NUTRIENT_DEFS[code].displayName}
              </Text>
              <Text variant="label" numeric tone={preview[code] === undefined ? 'faint' : 'default'}>
                {preview[code] === undefined ? 'not reported' : formatWithUnit(preview[code], code)}
              </Text>
            </View>
          ))}
          <Text variant="caption" tone="faint" style={{ marginTop: spacing.xs }}>
            Computed from the source record, not estimated.
          </Text>
        </Card>
      )}

      <View style={{ padding: spacing.lg }}>
        <Button label="Add to log" onPress={save} disabled={!canSave} />
      </View>
      <View style={{ height: 1, backgroundColor: colors.border }} />
    </Screen>
  );
}
