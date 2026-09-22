/**
 * History (F12 in list form for Milestone 1): the last 30 days with their
 * totals against the goals that applied on each day. Charts land in Phase 3.
 */
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  addDays,
  dayTotals,
  formatDayLabel,
  formatEnergy,
  lastNDays,
  localDateOf,
  profileForDate,
  progressForProfile,
  type LocalDate,
} from '@nt/core';
import { entries as entriesRepo, goals as goalsRepo, water as waterRepo } from '@nt/db';
import { useDbQuery } from '@/db/provider';
import { radii, spacing, useTheme } from '@/theme';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';

const WINDOW_DAYS = 30;

export default function HistoryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const today = localDateOf();
  const from = addDays(today, -(WINDOW_DAYS - 1));

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
    return lastNDays(today, WINDOW_DAYS)
      .reverse()
      .map((date) => {
        const entries = byDate.get(date) ?? [];
        const totals = dayTotals(entries);
        const profile = profileForDate(profiles, date);
        const energy = progressForProfile(totals.total, profile).find((p) => p.nutrientCode === 'energy_kcal') ?? null;
        return { date, entries, totals, energy, waterMl: waterTotals[date] ?? 0 };
      });
  }, [rows, profiles, today, waterTotals]);

  const logged = days.filter((d) => d.entries.length > 0).length;

  return (
    <Screen topInset>
      <Card style={{ gap: spacing.xs }}>
        <Text variant="title" numeric>
          {logged} of {WINDOW_DAYS} days logged
        </Text>
        <Text variant="caption" tone="faint">
          Each day is read against the goals that applied on that day.
        </Text>
      </Card>

      {days.map((day) => {
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
            {day.energy?.reference != null && day.entries.length > 0 && (
              <View style={{ height: 6, borderRadius: radii.pill, backgroundColor: colors.track, marginTop: spacing.sm, overflow: 'hidden' }}>
                <View
                  style={{
                    width: `${Math.min(Math.max(day.energy.ratio ?? 0, 0), 1) * 100}%`,
                    height: '100%',
                    backgroundColor: over ? colors.over : colors.accent,
                  }}
                />
              </View>
            )}
          </Pressable>
        );
      })}
    </Screen>
  );
}
