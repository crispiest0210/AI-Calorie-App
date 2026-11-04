/**
 * Goals editor (F1). Saving writes a new dated profile from today, so past
 * days keep the goals that applied then. Macro targets can be grams or a
 * percentage of the energy target; the percentage is resolved with 4/4/9 and
 * the app says so rather than hiding it. A field left blank is no goal at all,
 * never a goal of zero.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ATWATER_FACTORS,
  NUTRIENT_DEFS,
  dec,
  formatDayLabel,
  formatGrams,
  localDateOf,
  parseUserNumber,
  resolveTarget,
  sum,
  type GoalBasis,
  type GoalTarget,
  type Num,
} from '@nt/core';
import { ValidationError, WATER_TARGET_ML_MAX, goals as goalsRepo } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { spacing } from '@/theme';
import { successFeedback } from '@/hooks/useHaptics';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { NumberField } from '@/components/NumberField';
import { SegmentedControl } from '@/components/SegmentedControl';

export { RouteErrorBoundary as ErrorBoundary } from '@/components/RouteErrorBoundary';

const MACROS = ['protein_g', 'carb_g', 'fat_g'] as const;

/** Blank is no goal (null); text that is not a number yet is `invalid`. */
function field(text: string): { value: Num | null; invalid: boolean } {
  const value = parseUserNumber(text);
  return { value, invalid: value === null && text.trim() !== '' };
}

export default function GoalsScreen() {
  const db = useDb();
  const router = useRouter();
  const today = localDateOf();
  const current = useDbQuery((database) => goalsRepo.goalsForDate(database, today), [today]);

  const initial = useMemo(() => {
    const find = (code: string) => current?.targets.find((t) => t.nutrientCode === code) ?? null;
    // Suggestions only seed a first profile; once one is saved, a goal it left
    // out stays blank rather than coming back.
    const seed = (stored: string | null | undefined, suggestion: string) => stored ?? (current === null ? suggestion : '');
    return {
      energy: seed(find('energy_kcal')?.value, '2100'),
      macroBasis: (find('protein_g')?.basis ?? find('carb_g')?.basis ?? find('fat_g')?.basis ?? 'pct_energy') as GoalBasis,
      protein: seed(find('protein_g')?.value, '25'),
      carb: seed(find('carb_g')?.value, '45'),
      fat: seed(find('fat_g')?.value, '30'),
      fiber: seed(find('fiber_g')?.valueLow, '30'),
      sodium: seed(find('sodium_mg')?.valueHigh, '2300'),
      water: seed(current?.waterTargetMl == null ? null : String(current.waterTargetMl), '2500'),
    };
  }, [current]);

  const [energy, setEnergy] = useState(initial.energy);
  const [macroBasis, setMacroBasis] = useState<GoalBasis>(initial.macroBasis);
  const [macros, setMacros] = useState({ protein_g: initial.protein, carb_g: initial.carb, fat_g: initial.fat });
  const [fiber, setFiber] = useState(initial.fiber);
  const [sodium, setSodium] = useState(initial.sodium);
  const [water, setWater] = useState(initial.water);
  const [error, setError] = useState<string | null>(null);

  const energyField = field(energy);
  const macroFields = { protein_g: field(macros.protein_g), carb_g: field(macros.carb_g), fat_g: field(macros.fat_g) };
  const fiberField = field(fiber);
  const sodiumField = field(sodium);
  const waterField = field(water);
  const waterMl = waterField.value === null ? null : dec(waterField.value);
  const waterInvalid =
    waterField.invalid || (waterMl !== null && (!waterMl.isInteger() || waterMl.lessThan(1) || waterMl.greaterThan(WATER_TARGET_ML_MAX)));

  const invalid = [
    energyField.invalid && 'energy',
    ...MACROS.map((code) => macroFields[code].invalid && NUTRIENT_DEFS[code].displayName.toLowerCase()),
    fiberField.invalid && 'fiber',
    sodiumField.invalid && 'sodium',
    waterInvalid && 'water',
  ].filter((name): name is string => typeof name === 'string');

  const percents = MACROS.map((code) => macroFields[code].value).filter((value): value is Num => value !== null);
  const percentTotal = macroBasis === 'pct_energy' && percents.length > 0 ? sum(percents) : null;

  const save = () => {
    if (invalid.length > 0) return;
    const targets: GoalTarget[] = [];
    const absolute = { valueLow: null, valueHigh: null, basis: 'absolute' as const };
    if (energyField.value !== null) targets.push({ nutrientCode: 'energy_kcal', kind: 'target', value: energyField.value, ...absolute });
    for (const code of MACROS) {
      const value = macroFields[code].value;
      if (value !== null) targets.push({ nutrientCode: code, kind: 'target', value, valueLow: null, valueHigh: null, basis: macroBasis });
    }
    if (fiberField.value !== null) targets.push({ nutrientCode: 'fiber_g', kind: 'min', value: null, valueLow: fiberField.value, valueHigh: null, basis: 'absolute' });
    if (sodiumField.value !== null) targets.push({ nutrientCode: 'sodium_mg', kind: 'max', value: null, valueLow: null, valueHigh: sodiumField.value, basis: 'absolute' });
    try {
      goalsRepo.saveGoals(db, { waterTargetMl: waterMl === null ? null : waterMl.toNumber(), targets });
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      setError(err.reason.includes('100 percent') ? 'A macro cannot be more than 100% of energy.' : 'Check those numbers.');
      return;
    }
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
          const value = macroFields[code].value;
          const grams =
            value === null || energyField.value === null
              ? null
              : resolveTarget({ nutrientCode: code, kind: 'target', value, valueLow: null, valueHigh: null, basis: macroBasis }, energyField.value).value;
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
                  ≈ {formatGrams(grams)} g at {ATWATER_FACTORS[code]} cal per gram
                </Text>
              )}
            </View>
          );
        })}
        {percentTotal !== null && percentTotal.minus(100).abs().greaterThan('0.5') && (
          <Text variant="label" tone="over" numeric>
            Percentages add up to {percentTotal.toDecimalPlaces(0).toFixed()}%, not 100%.
          </Text>
        )}
      </Card>

      <Card style={{ gap: spacing.lg }}>
        <NumberField label="Fiber, at least" value={fiber} onChange={setFiber} suffix="g" step={5} />
        <NumberField label="Sodium, at most" value={sodium} onChange={setSodium} suffix="mg" step={100} />
        <NumberField label="Water target" value={water} onChange={setWater} suffix="mL" step={250} />
      </Card>

      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        {invalid.length > 0 && (
          <Text variant="label" tone="over" accessibilityLiveRegion="polite">
            Check the {invalid.join(', ')} {invalid.length === 1 ? 'value' : 'values'}
            {waterInvalid ? ` (water is whole mL up to ${WATER_TARGET_ML_MAX})` : ''}.
          </Text>
        )}
        {error !== null && invalid.length === 0 && (
          <Text variant="label" tone="over" accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
        <Text variant="caption" tone="faint">
          Leave a field blank to have no goal for it.
        </Text>
        <Button label="Save goals" onPress={save} disabled={invalid.length > 0} />
        <Text variant="caption" tone="faint">
          Saved goals apply from {formatDayLabel(today, today).toLowerCase()} onward. Earlier days keep the goals they were logged against.
        </Text>
      </View>
    </Screen>
  );
}
