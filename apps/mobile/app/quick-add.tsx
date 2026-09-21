/**
 * Quick add (F5's escape hatch): absolute numbers the user types when there is
 * no food record. The entry is tagged "You" and marked incomplete for every
 * nutrient left blank, so it never pretends to be a full record.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MEAL_SLOTS, MEAL_SLOT_LABELS, NUTRIENT_DEFS, localDateOf, num, type MealSlot, type NutrientMap } from '@nt/core';
import { entries as entriesRepo } from '@nt/db';
import { useDb } from '@/db/provider';
import { spacing } from '@/theme';
import { successFeedback } from '@/hooks/useHaptics';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { NumberField } from '@/components/NumberField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { LabelledTextInput } from '@/components/LabelledTextInput';

const FIELDS = ['energy_kcal', 'protein_g', 'carb_g', 'fat_g'] as const;

export default function QuickAddScreen() {
  const db = useDb();
  const router = useRouter();
  const params = useLocalSearchParams<{ mealSlot?: string; date?: string }>();
  const date = params.date ?? localDateOf();

  const [mealSlot, setMealSlot] = useState<MealSlot>(
    MEAL_SLOTS.includes(params.mealSlot as MealSlot) ? (params.mealSlot as MealSlot) : 'snack',
  );
  const [label, setLabel] = useState('');
  const [values, setValues] = useState<Record<string, string>>({ energy_kcal: '' });

  const energy = values.energy_kcal ?? '';
  const canSave = energy.trim() !== '' && Number.parseFloat(energy) > 0;

  const save = () => {
    const nutrients: NutrientMap = {};
    for (const code of FIELDS) {
      const raw = values[code];
      if (raw === undefined || raw.trim() === '') continue;
      const parsed = Number.parseFloat(raw);
      if (!Number.isFinite(parsed)) continue;
      nutrients[code] = num(raw);
    }
    entriesRepo.logQuickAdd(db, {
      mealSlot,
      nutrients,
      label,
      at: date === localDateOf() ? new Date() : new Date(`${date}T12:00:00`),
    });
    successFeedback();
    router.dismissAll();
  };

  return (
    <Screen>
      <Card style={{ gap: spacing.lg }}>
        <LabelledTextInput label="Name (optional)" value={label} onChangeText={setLabel} placeholder="Cafeteria lunch" />
        {FIELDS.map((code) => (
          <NumberField
            key={code}
            label={`${NUTRIENT_DEFS[code].displayName}${code === 'energy_kcal' ? '' : ' (optional)'}`}
            value={values[code] ?? ''}
            onChange={(next) => setValues((prev) => ({ ...prev, [code]: next }))}
            suffix={NUTRIENT_DEFS[code].unit}
            step={code === 'energy_kcal' ? 50 : 5}
          />
        ))}
        <SegmentedControl
          label="Meal"
          options={MEAL_SLOTS.map((slot) => ({ value: slot, label: MEAL_SLOT_LABELS[slot] }))}
          value={mealSlot}
          onChange={setMealSlot}
        />
        <Text variant="caption" tone="faint">
          Anything left blank stays missing, and the day is marked incomplete for it rather than counting it as zero.
        </Text>
      </Card>

      <View style={{ padding: spacing.lg }}>
        <Button label="Add to log" onPress={save} disabled={!canSave} />
      </View>
    </Screen>
  );
}
