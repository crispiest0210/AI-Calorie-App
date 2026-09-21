/**
 * The Today layout, reused read-write for a past day (spec 5.2). Everything on
 * screen is recomputed from SQLite rows by the engine, so the numbers here and
 * the numbers on another device cannot drift.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  MEAL_SLOTS,
  addDays,
  formatDayLabel,
  localDateOf,
  totalOf,
  type LocalDate,
  type MealSlot,
} from '@nt/core';
import { entries as entriesRepo, readDay, water as waterRepo } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { spacing, useTheme } from '@/theme';
import { successFeedback, tapFeedback } from '@/hooks/useHaptics';
import { useUiStore } from '@/state/ui';
import { Card, Screen } from './Screen';
import { Text } from './Text';
import { Button, Row } from './Button';
import { EnergyRing } from './EnergyRing';
import { MacroBars } from './MacroBars';
import { WaterRow } from './WaterRow';
import { MealSection } from './MealSection';
import { Toast } from './Toast';
import { DayHeader } from './DayHeader';

export function DayView({ date, showDateNav }: { date: LocalDate; showDateNav: boolean }) {
  const db = useDb();
  const router = useRouter();
  const { colors } = useTheme();
  const setSelectedDate = useUiStore((s) => s.setSelectedDate);
  const setPendingMealSlot = useUiStore((s) => s.setPendingMealSlot);
  const [undo, setUndo] = useState<{ id: string; message: string } | null>(null);

  const day = useDbQuery((database) => readDay(database, date), [date]);
  const presets = useDbQuery((database) => waterRepo.presets(database), []);

  const energy = day.progress.find((p) => p.nutrientCode === 'energy_kcal') ?? null;
  const consumed = day.totals.total.values.energy_kcal ?? '0';

  const openLog = useCallback(
    (slot: MealSlot) => {
      setPendingMealSlot(slot);
      router.push({ pathname: '/log', params: { date, mealSlot: slot } });
    },
    [date, router, setPendingMealSlot],
  );

  const deleteEntry = useCallback(
    (id: string) => {
      const entry = day.entries.find((e) => e.id === id);
      entriesRepo.deleteEntry(db, id);
      tapFeedback();
      setUndo({ id, message: `Removed ${entry?.foodName ?? 'entry'}` });
    },
    [db, day.entries],
  );

  const copyYesterday = useCallback(
    (slot: MealSlot) => {
      const copied = entriesRepo.copyMeal(db, { date: addDays(date, -1), mealSlot: slot }, { date, mealSlot: slot });
      if (copied.length === 0) {
        setUndo({ id: '', message: 'Nothing logged for that meal yesterday' });
        return;
      }
      successFeedback();
      setUndo({ id: '', message: `Copied ${copied.length} ${copied.length === 1 ? 'entry' : 'entries'}` });
    },
    [db, date],
  );

  return (
    <View style={{ flex: 1 }}>
      <Screen topInset={showDateNav}>
        {showDateNav && (
          <DayHeader
            date={date}
            label={formatDayLabel(date, localDateOf())}
            onChange={setSelectedDate}
            canGoForward={date < localDateOf()}
          />
        )}

        <Card style={{ alignItems: 'center', gap: spacing.lg }}>
          <EnergyRing
            consumed={consumed}
            target={energy?.reference ?? null}
            remaining={energy?.remaining ?? null}
            ratio={energy?.ratio ?? null}
            incomplete={day.totals.total.incomplete.includes('energy_kcal')}
          />
          <View style={{ alignSelf: 'stretch' }}>
            <MacroBars totals={day.totals.total} progress={day.progress} />
          </View>
          {day.goals === null && (
            <Button label="Set your goals" variant="secondary" onPress={() => router.push('/goals')} style={{ alignSelf: 'stretch' }} />
          )}
        </Card>

        <Card>
          <WaterRow
            progress={day.water}
            presets={presets}
            onAdd={(ml) => waterRepo.addWater(db, ml)}
            onOpen={() => router.push({ pathname: '/water', params: { date } })}
          />
        </Card>

        {MEAL_SLOTS.map((slot) => (
          <MealSection
            key={slot}
            slot={slot}
            entries={day.entries.filter((e) => e.mealSlot === slot)}
            totals={day.totals.byMeal[slot]}
            onAdd={() => openLog(slot)}
            onCopyYesterday={() => copyYesterday(slot)}
            onOpenEntry={(id) => router.push({ pathname: '/entry/[id]', params: { id } })}
            onDeleteEntry={deleteEntry}
          />
        ))}

        <Card>
          <Row gap={spacing.lg}>
            <Text variant="caption" tone="faint" style={{ flex: 1 }}>
              {day.totals.total.incomplete.length === 0
                ? 'Every entry reports all six core nutrients.'
                : `Incomplete: ${day.totals.total.incomplete.join(', ').replaceAll('_g', '').replaceAll('_mg', '').replaceAll('_kcal', '')}`}
            </Text>
          </Row>
          <Text variant="caption" tone="faint" style={{ marginTop: spacing.sm }} numeric>
            {day.entries.length} {day.entries.length === 1 ? 'entry' : 'entries'} ·{' '}
            {totalOf(day.totals.total, 'fiber_g') ?? '—'} g fiber · {totalOf(day.totals.total, 'sodium_mg') ?? '—'} mg sodium
          </Text>
        </Card>
      </Screen>

      <View style={{ position: 'absolute', right: spacing.lg, bottom: spacing.xl }}>
        <Button
          label="Log"
          onPress={() => openLog(useUiStore.getState().pendingMealSlot)}
          accessibilityHint="Opens the log sheet"
          style={{ paddingHorizontal: spacing.xxl, shadowColor: colors.text, shadowOpacity: 0.15, shadowRadius: 12, elevation: 4 }}
        />
      </View>

      <Toast
        message={undo?.message ?? null}
        actionLabel={undo?.id ? 'Undo' : undefined}
        onAction={() => {
          if (undo?.id) entriesRepo.restoreEntry(db, undo.id);
          setUndo(null);
        }}
        onDismiss={() => setUndo(null)}
      />
    </View>
  );
}
