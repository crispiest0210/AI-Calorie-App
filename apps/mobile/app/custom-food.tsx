/**
 * Custom food from a nutrition label (F7). Values are typed per serving or per
 * 100 g and converted here; the food is tagged "You" so its tier is always
 * visible next to USDA data.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { NUTRIENT_DEFS, customFoodFromLabel, num, type LabelBasis, type NutrientMap } from '@nt/core';
import { foods as foodsRepo } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { spacing } from '@/theme';
import { successFeedback } from '@/hooks/useHaptics';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { NumberField } from '@/components/NumberField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { LabelledTextInput } from '@/components/LabelledTextInput';

const FIELDS = ['energy_kcal', 'protein_g', 'carb_g', 'fat_g', 'fiber_g', 'sodium_mg'] as const;

export default function CustomFoodScreen() {
  const db = useDb();
  const router = useRouter();
  const params = useLocalSearchParams<{ mealSlot?: string; date?: string }>();

  const releaseId = useDbQuery((database) => foodsRepo.activeSourceRelease(database, 'fdc'), []);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [basis, setBasis] = useState<LabelBasis>('per_serving');
  const [servingGrams, setServingGrams] = useState('');
  const [servingLabel, setServingLabel] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const canSave =
    name.trim() !== '' &&
    (values.energy_kcal ?? '').trim() !== '' &&
    (basis === 'per_100g' || Number.parseFloat(servingGrams) > 0);

  const save = () => {
    const typed: NutrientMap = {};
    for (const code of FIELDS) {
      const raw = values[code];
      if (raw === undefined || raw.trim() === '') continue;
      if (!Number.isFinite(Number.parseFloat(raw))) continue;
      typed[code] = num(raw);
    }

    try {
      const { food, quarantineReasons } = customFoodFromLabel({
        name,
        brand,
        basis,
        servingGrams: basis === 'per_serving' ? servingGrams : null,
        servingLabel,
        values: typed,
      });
      if (quarantineReasons.length > 0) {
        // Mirrors the import-time check (2.6.8): a typo like 9000 kcal per
        // 100 g is almost certainly a slip, so ask rather than store it.
        setError(`Check those numbers — ${quarantineReasons[0]}.`);
        return;
      }
      const id = foodsRepo.createCustomFood(db, food, { sourceReleaseId: releaseId ?? 'user', synced: true });
      successFeedback();
      router.replace({ pathname: '/amount', params: { foodId: id, mealSlot: params.mealSlot, date: params.date } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That food could not be saved.');
    }
  };

  return (
    <Screen>
      <Card style={{ gap: spacing.lg }}>
        <LabelledTextInput label="Name" value={name} onChangeText={setName} placeholder="Oat granola" autoFocus />
        <LabelledTextInput label="Brand (optional)" value={brand} onChangeText={setBrand} placeholder="Acme" />
        <SegmentedControl
          label="Label values are"
          options={[
            { value: 'per_serving', label: 'Per serving' },
            { value: 'per_100g', label: 'Per 100 g' },
          ]}
          value={basis}
          onChange={setBasis}
        />
        {basis === 'per_serving' && (
          <>
            <NumberField label="Serving weight" value={servingGrams} onChange={setServingGrams} suffix="g" step={5} />
            <LabelledTextInput label="Serving name (optional)" value={servingLabel} onChangeText={setServingLabel} placeholder="1 bar" />
          </>
        )}
      </Card>

      <Card style={{ gap: spacing.lg }}>
        <Text variant="heading">Nutrition</Text>
        {FIELDS.map((code) => (
          <NumberField
            key={code}
            label={`${NUTRIENT_DEFS[code].displayName}${code === 'energy_kcal' ? '' : ' (optional)'}`}
            value={values[code] ?? ''}
            onChange={(next) => setValues((prev) => ({ ...prev, [code]: next }))}
            suffix={NUTRIENT_DEFS[code].unit}
            step={code === 'energy_kcal' ? 10 : code === 'sodium_mg' ? 50 : 1}
          />
        ))}
        {error !== null && (
          <Text variant="label" tone="over">
            {error}
          </Text>
        )}
      </Card>

      <View style={{ padding: spacing.lg }}>
        <Button label="Save and log" onPress={save} disabled={!canSave} />
      </View>
    </Screen>
  );
}
