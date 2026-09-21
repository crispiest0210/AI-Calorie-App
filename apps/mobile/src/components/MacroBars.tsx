/** Protein / carb / fat bars against their targets, with plain-text alternatives. */
import { View } from 'react-native';
import { NUTRIENT_DEFS, formatNutrient, type GoalProgress, type NutrientCode, type NutrientTotals } from '@nt/core';
import { radii, spacing, useTheme } from '../theme';
import { Text } from './Text';

const MACRO_COLORS: Record<string, keyof ReturnType<typeof useTheme>['colors']> = {
  protein_g: 'protein',
  carb_g: 'carb',
  fat_g: 'fat',
};

export function MacroBars({ totals, progress }: { totals: NutrientTotals; progress: readonly GoalProgress[] }) {
  const codes: NutrientCode[] = ['protein_g', 'carb_g', 'fat_g'];
  return (
    <View style={{ gap: spacing.md }}>
      {codes.map((code) => (
        <MacroBar key={code} code={code} value={totals.values[code] ?? '0'} goal={progress.find((p) => p.nutrientCode === code) ?? null} />
      ))}
    </View>
  );
}

function MacroBar({ code, value, goal }: { code: NutrientCode; value: string; goal: GoalProgress | null }) {
  const { colors } = useTheme();
  const color = colors[MACRO_COLORS[code] ?? 'accent'];
  const ratio = goal?.ratio ?? null;
  const filled = Math.min(Math.max(ratio ?? 0, 0), 1);
  const over = ratio !== null && ratio > 1;
  const label = NUTRIENT_DEFS[code].displayName;
  const text =
    goal?.reference != null
      ? `${label}: ${formatNutrient(value, code)} of ${formatNutrient(goal.reference, code)} g`
      : `${label}: ${formatNutrient(value, code)} g, no target set`;

  return (
    <View accessible accessibilityLabel={over ? `${text}, over target` : text}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
        <Text variant="label" tone="muted">
          {label}
        </Text>
        <Text variant="label" numeric tone={over ? 'over' : 'default'}>
          {formatNutrient(value, code)}
          {goal?.reference != null ? ` / ${formatNutrient(goal.reference, code)}` : ''} g
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: radii.pill, backgroundColor: colors.track, overflow: 'hidden' }}>
        <View style={{ width: `${filled * 100}%`, height: '100%', backgroundColor: over ? colors.over : color }} />
      </View>
    </View>
  );
}
