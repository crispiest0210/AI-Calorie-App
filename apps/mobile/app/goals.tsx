/**
 * Goals editor (F1). Saving writes a new dated profile from today, so past
 * days keep the goals that applied then. Macro targets can be grams or a
 * percentage of the energy target; the percentage is resolved with 4/4/9 and
 * the app says so rather than hiding it.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ATWATER_FACTORS,
  NUTRIENT_DEFS,
  formatDayLabel,
  localDateOf,
  num,
  resolveTarget,
  type GoalBasis,
  type GoalTarget,
} from '@nt/core';
import { goals as goalsRepo } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { spacing } from '@/theme';
import { successFeedback } from '@/hooks/useHaptics';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { NumberField } from '@/components/NumberField';
import { SegmentedControl } from '@/components/SegmentedControl';

const MACROS = ['protein_g', 'carb_g', 'fat_g'] as const;

export default function GoalsScreen() {
  const db = useDb();
  const router = useRouter();
  const today = localDateOf();
  const current = useDbQuery((database) => goalsRepo.goalsForDate(database, today), [today]);

  const initial = useMemo(() => {
    const find = (code: string) => current?.targets.find((t) => t.nutrientCode === code) ?? null;
    return {
      energy: find('energy_kcal')?.value ?? '2100',
      macroBasis: (find('protein_g')?.basis ?? 'pct_energy') as GoalBasis,
      protein: find('protein_g')?.value ?? '25',
      carb: find('carb_g')?.value ?? '45',
      fat: find('fat_g')?.value ?? '30',
      fiber: find('fiber_g')?.valueLow ?? '30',
      sodium: find('sodium_mg')?.valueHigh ?? '2300',
      water: current?.waterTargetMl == null ? '2500' : String(current.waterTargetMl),
    };
  }, [current]);

  const [energy, setEnergy] = useState(initial.energy);
  const [macroBasis, setMacroBasis] = useState<GoalBasis>(initial.macroBasis);
  const [macros, setMacros] = useState({ protein_g: initial.protein, carb_g: initial.carb, fat_g: initial.fat });
  const [fiber, setFiber] = useState(initial.fiber);
  const [sodium, setSodium] = useState(initial.sodium);
  const [water, setWater] = useState(initial.water);

  const percentTotal = macroBasis === 'pct_energy' ? MACROS.reduce((sum, code) => sum + (Number.parseFloat(macros[code]) || 0), 0) : null;

  const save = () => {
    const targets: GoalTarget[] = [
      { nutrientCode: 'energy_kcal', kind: 'target', value: num(energy || '0'), valueLow: null, valueHigh: null, basis: 'absolute' },
      ...MACROS.map<GoalTarget>((code) => ({
        nutrientCode: code,
        kind: 'target',
        value: num(macros[code] || '0'),
        valueLow: null,
        valueHigh: null,
        basis: macroBasis,
      })),
      { nutrientCode: 'fiber_g', kind: 'min', value: null, valueLow: num(fiber || '0'), valueHigh: null, basis: 'absolute' },
      { nutrientCode: 'sodium_mg', kind: 'max', value: null, valueLow: null, valueHigh: num(sodium || '0'), basis: 'absolute' },
    ];
    const waterMl = Number.parseInt(water, 10);
    goalsRepo.saveGoals(db, { waterTargetMl: Number.isFinite(waterMl) && waterMl > 0 ? waterMl : null, targets });
    successFeedback();
    router.back();
  };

  return (
    <Screen>
      <Card style={{ gap: spacing.lg }}>
        <NumberField label="Energy target" value={energy} onChange={setEnergy} suffix="cal" step={50} />
        <Text variant="caption" tone="faint">
          These are targets, not limits. The app never suggests a deficit and has no calorie floor.
        </Text>
      </Card>

      <Card style={{ gap: spacing.lg }}>
        <Text variant="heading">Macros</Text>
        <SegmentedControl
          label="Set macros as"
          options={[
            { value: 'pct_energy', label: '% of energy' },
            { value: 'absolute', label: 'grams' },
          ]}
          value={macroBasis}
          onChange={setMacroBasis}
        />
        {MACROS.map((code) => {
          const resolved = resolveTarget(
            { nutrientCode: code, kind: 'target', value: num(macros[code] || '0'), valueLow: null, valueHigh: null, basis: macroBasis },
            num(energy || '0'),
          );
          return (
            <View key={code} style={{ gap: spacing.xs }}>
              <NumberField
                label={NUTRIENT_DEFS[code].displayName}
                value={macros[code]}
                onChange={(next) => setMacros((prev) => ({ ...prev, [code]: next }))}
                suffix={macroBasis === 'pct_energy' ? '%' : 'g'}
                step={macroBasis === 'pct_energy' ? 5 : 10}
              />
              {macroBasis === 'pct_energy' && (
                <Text variant="caption" tone="faint" numeric>
                  ≈ {resolved.value ?? '—'} g at {ATWATER_FACTORS[code]} cal per gram
                </Text>
              )}
            </View>
          );
        })}
        {percentTotal !== null && Math.abs(percentTotal - 100) > 0.5 && (
          <Text variant="label" tone="over" numeric>
            Percentages add up to {percentTotal.toFixed(0)}%, not 100%.
          </Text>
        )}
      </Card>

      <Card style={{ gap: spacing.lg }}>
        <NumberField label="Fiber, at least" value={fiber} onChange={setFiber} suffix="g" step={5} />
        <NumberField label="Sodium, at most" value={sodium} onChange={setSodium} suffix="mg" step={100} />
        <NumberField label="Water target" value={water} onChange={setWater} suffix="mL" step={250} />
      </Card>

      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Button label="Save goals" onPress={save} />
        <Text variant="caption" tone="faint">
          Saved goals apply from {formatDayLabel(today, today).toLowerCase()} onward. Earlier days keep the goals they were logged against.
        </Text>
      </View>
    </Screen>
  );
}
