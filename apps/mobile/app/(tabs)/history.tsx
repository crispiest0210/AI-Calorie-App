/**
 * History and trends (F12). Each day is read against the goals that applied on
 * that day, never today's — which is the whole reason goal profiles are dated.
 */
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  NUTRIENT_DEFS,
  addDays,
  dayTotals,
  formatDayLabel,
  formatEnergy,
  formatNutrient,
  lastNDays,
  localDateOf,
  profileForDate,
  progressForProfile,
  resolveProfile,
  type LocalDate,
  type NutrientCode,
} from '@nt/core';
import { entries as entriesRepo, goals as goalsRepo, water as waterRepo } from '@nt/db';
import { useDbQuery } from '@/db/provider';
import { radii, spacing, useTheme } from '@/theme';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { SegmentedControl } from '@/components/SegmentedControl';
import { StatTile } from '@/components/StatTile';
import { TrendChart, type TrendDay } from '@/components/TrendChart';

type Range = '7' | '30';

const MACROS: NutrientCode[] = ['protein_g', 'carb_g', 'fat_g'];

export default function HistoryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const today = localDateOf();
  const [range, setRange] = useState<Range>('7');
  const windowDays = Number.parseInt(range, 10);
  const from = addDays(today, -(windowDays - 1));

  const rows = useDbQuery((db) => entriesRepo.entriesForRange(db, from, today), [from, today]);
  const profiles = useDbQuery((db) => goalsRepo.allGoalProfiles(db), []);
  const waterTotals = useDbQuery((db) => waterRepo.waterTotalsForRange(db, from, today), [from, today]);

  const days = useMemo(() => {
    const byDate = new Map<LocalDate, typeof rows>();
    for (const entry of rows) {
      const list = byDate.get(entry.localDate) ?? [];
      list.push(entry);
      byDate.set(entry.localDate, list);
    }
    return lastNDays(today, windowDays).map((date) => {
      const dayEntries = byDate.get(date) ?? [];
      const totals = dayTotals(dayEntries);
      const profile = profileForDate(profiles, date);
      const progress = progressForProfile(totals.total, profile);
      return {
        date,
        entries: dayEntries,
        totals,
        profile,
        progress,
        energy: progress.find((p) => p.nutrientCode === 'energy_kcal') ?? null,
        waterMl: waterTotals[date] ?? 0,
      };
    });
  }, [rows, profiles, today, windowDays, waterTotals]);

  const loggedDays = days.filter((d) => d.entries.length > 0);

  const chartDays: TrendDay[] = days.map((day) => ({
    date: day.date,
    energy: day.entries.length === 0 ? null : Number.parseFloat(day.totals.total.values.energy_kcal ?? '0'),
    target: day.energy?.reference === undefined || day.energy.reference === null ? null : Number.parseFloat(day.energy.reference),
  }));

  /** Averaged over days actually logged: dividing by blank days invents a fast. */
  const macroAverage = (code: NutrientCode): { value: number; target: number | null } | null => {
    if (loggedDays.length === 0) return null;
    const total = loggedDays.reduce((sum, day) => sum + Number.parseFloat(day.totals.total.values[code] ?? '0'), 0);
    const targets = loggedDays
      .map((day) => resolveProfile(day.profile).find((t) => t.nutrientCode === code)?.value)
      .filter((v): v is string => v != null)
      .map(Number.parseFloat);
    return {
      value: total / loggedDays.length,
      target: targets.length === 0 ? null : targets.reduce((a, b) => a + b, 0) / targets.length,
    };
  };

  const waterDaysMet = days.filter((day) => {
    const target = day.profile?.waterTargetMl ?? null;
    return target !== null && day.waterMl >= target;
  }).length;
  const hasWaterTarget = days.some((day) => day.profile?.waterTargetMl != null);

  return (
    <Screen topInset>
      <Card style={{ gap: spacing.lg }}>
        <SegmentedControl
          label="Range"
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
          ]}
          value={range}
          onChange={setRange}
        />
        <View style={{ gap: spacing.xs }}>
          <Text variant="heading">Energy</Text>
          <Text variant="caption" tone="faint">
            Each day against the target that applied then.
          </Text>
        </View>
        <TrendChart days={chartDays} today={today} onSelectDay={(date) => router.push({ pathname: '/day/[date]', params: { date } })} />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text variant="heading">Averages on days you logged</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {MACROS.map((code) => {
            const stat = macroAverage(code);
            return (
              <StatTile
                key={code}
                label={NUTRIENT_DEFS[code].displayName}
                value={stat === null ? '—' : formatNutrient(String(stat.value), code)}
                unit={stat === null ? undefined : NUTRIENT_DEFS[code].displayUnit}
                detail={stat?.target == null ? 'no target' : `of ${formatNutrient(String(stat.target), code)} target`}
                state={stat?.target != null && stat.value > stat.target ? 'over' : 'neutral'}
              />
            );
          })}
        </View>
        <Text variant="caption" tone="faint" numeric>
          {loggedDays.length} of {windowDays} days logged
          {hasWaterTarget ? ` · water target met on ${waterDaysMet}` : ''}
        </Text>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading">Days</Text>
      </Card>

      {days
        .slice()
        .reverse()
        .map((day) => {
          const over = day.energy?.ratio != null && day.energy.ratio > 1;
          return (
            <Pressable
              key={day.date}
              onPress={() => router.push({ pathname: '/day/[date]', params: { date: day.date } })}
              accessibilityRole="button"
              accessibilityLabel={`${formatDayLabel(day.date, today)}, ${formatEnergy(day.totals.total.values.energy_kcal ?? '0')} calories, ${day.entries.length} entries`}
              style={({ pressed }) => ({
                marginHorizontal: spacing.lg,
                marginTop: spacing.sm,
                padding: spacing.lg,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: pressed ? colors.accentMuted : colors.surface,
              })}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ gap: 2 }}>
                  <Text variant="label">{formatDayLabel(day.date, today)}</Text>
                  <Text variant="caption" tone="faint" numeric>
                    {day.entries.length === 0 ? 'nothing logged' : `${day.entries.length} entries · ${day.waterMl} mL water`}
                  </Text>
                </View>
                <Text variant="heading" numeric tone={over ? 'over' : day.entries.length === 0 ? 'faint' : 'default'}>
                  {day.entries.length === 0 ? '—' : formatEnergy(day.totals.total.values.energy_kcal ?? '0')}
                </Text>
              </View>
            </Pressable>
          );
        })}
    </Screen>
  );
}
