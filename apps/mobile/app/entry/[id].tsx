/**
 * Entry detail (spec 5.2): what it contributed, where the numbers came from,
 * and the controls to change amount, meal or delete it.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  CORE_CODES,
  MEAL_SLOTS,
  MEAL_SLOT_LABELS,
  NUTRIENT_DEFS,
  entryNutrients,
  formatTimeOfDay,
  formatWithUnit,
  resolveGrams,
  type MealSlot,
} from '@nt/core';
import { entries as entriesRepo, foods as foodsRepo } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { spacing } from '@/theme';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { NumberField } from '@/components/NumberField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SourceBadge } from '@/components/SourceBadge';

export default function EntryDetailScreen() {
  const db = useDb();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const entry = useDbQuery((database) => entriesRepo.entryById(database, id), [id]);
  const food = useDbQuery((database) => (entry?.foodId == null ? null : foodsRepo.foodDetail(database, entry.foodId)), [entry?.foodId]);
  const [amount, setAmount] = useState<string | null>(null);

  if (entry === null) {
    return (
      <Screen>
        <Card>
          <Text tone="muted">This entry has been removed.</Text>
        </Card>
      </Screen>
    );
  }

  const contributed = entryNutrients(entry);
  const value = amount ?? entry.amountValue;
  const dirty = amount !== null && amount !== entry.amountValue;

  const saveAmount = () => {
    if (!dirty) return;
    if (entry.entryKind === 'quick_add') {
      entriesRepo.updateEntry(db, entry.id, { amountValue: value, nutrientsAbsolute: { ...contributed, energy_kcal: value } });
      setAmount(null);
      return;
    }
    if (food === null) return;
    const resolved = resolveGrams({ value, unit: entry.amountUnit, portionId: entry.portionId }, food);
    if (!resolved.ok) return;
    entriesRepo.updateEntry(db, entry.id, {
      amountValue: value,
      grams: resolved.grams,
      // An AI estimate the user edits becomes an adjusted amount (spec 5.3).
      gramsProvenance: entry.gramsProvenance === 'ai_estimate' ? 'ai_adjusted' : resolved.provenance,
    });
    setAmount(null);
  };

  return (
    <Screen>
      <Card style={{ gap: spacing.sm }}>
        <Text variant="title">{entry.foodName}</Text>
        {entry.foodBrand !== null && (
          <Text variant="label" tone="muted">
            {entry.foodBrand}
          </Text>
        )}
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <SourceBadge
            tier={entry.qualityTier ?? (entry.entryKind === 'quick_add' ? 'user' : null)}
            onPress={() => router.push({ pathname: '/provenance', params: { entryId: entry.id } })}
          />
          <Text variant="caption" tone="faint">
            logged {formatTimeOfDay(entry.loggedAt)}
          </Text>
        </View>
      </Card>

      <Card style={{ gap: spacing.lg }}>
        <NumberField
          label={entry.entryKind === 'quick_add' ? 'Energy' : `Amount (${entry.portionLabel ?? entry.amountUnit})`}
          value={value}
          onChange={setAmount}
          suffix={entry.entryKind === 'quick_add' ? 'cal' : entry.amountUnit}
          step={entry.amountUnit === 'portion' ? 1 : 10}
        />
        <SegmentedControl
          label="Meal"
          options={MEAL_SLOTS.map((slot) => ({ value: slot, label: MEAL_SLOT_LABELS[slot] }))}
          value={entry.mealSlot}
          onChange={(slot: MealSlot) => entriesRepo.updateEntry(db, entry.id, { mealSlot: slot })}
        />
        {dirty && <Button label="Save amount" onPress={saveAmount} />}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading">This entry contributes</Text>
        {CORE_CODES.map((code) => (
          <View key={code} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="label" tone="muted">
              {NUTRIENT_DEFS[code].displayName}
            </Text>
            <Text variant="label" numeric tone={contributed[code] === undefined ? 'faint' : 'default'}>
              {contributed[code] === undefined ? 'not reported' : formatWithUnit(contributed[code], code)}
            </Text>
          </View>
        ))}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading">Where these numbers come from</Text>
        <Text variant="label" tone="muted">
          {entry.entryKind === 'quick_add'
            ? 'You typed these values; nothing was looked up.'
            : 'Snapshot of the source record taken when this was logged, so later catalog updates never change this day.'}
        </Text>
        <Button
          label="See every source"
          variant="secondary"
          onPress={() => router.push({ pathname: '/provenance', params: { entryId: entry.id } })}
        />
      </Card>

      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <Button
          label="Delete entry"
          variant="secondary"
          onPress={() => {
            entriesRepo.deleteEntry(db, entry.id);
            router.back();
          }}
        />
      </View>
    </Screen>
  );
}
