/** A meal slot with its entries, its total, and the shortcuts for adding to it. */
import { Pressable, View } from 'react-native';
import { MEAL_SLOT_LABELS, formatEnergy, type MealSlot, type NutrientTotals } from '@nt/core';
import type { EntryView } from '@nt/db';
import { radii, spacing, useTheme } from '../theme';
import { Text } from './Text';
import { EntryRow } from './EntryRow';

export interface MealSectionProps {
  slot: MealSlot;
  entries: readonly EntryView[];
  totals: NutrientTotals;
  onAdd: () => void;
  onCopyYesterday: () => void;
  onOpenEntry: (id: string) => void;
  onDeleteEntry: (id: string) => void;
}

export function MealSection({ slot, entries, totals, onAdd, onCopyYesterday, onOpenEntry, onDeleteEntry }: MealSectionProps) {
  const { colors } = useTheme();
  const energy = totals.values.energy_kcal ?? '0';

  return (
    <View style={{ marginTop: spacing.lg }}>
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel={`${MEAL_SLOT_LABELS[slot]}, ${formatEnergy(energy)} calories`}
        accessibilityHint="Opens the log sheet for this meal"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
        }}
      >
        <Text variant="heading">{MEAL_SLOT_LABELS[slot]}</Text>
        <Text variant="label" tone="muted" numeric>
          {formatEnergy(energy)} cal
        </Text>
      </Pressable>

      <View style={{ marginHorizontal: spacing.lg, borderRadius: radii.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
        {entries.length === 0 ? (
          <View style={{ padding: spacing.lg, backgroundColor: colors.surface, gap: spacing.sm }}>
            <Text variant="caption" tone="faint">
              Nothing logged yet.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.lg }}>
              <Pressable onPress={onAdd} accessibilityRole="button">
                <Text variant="label" tone="accent">
                  Add food
                </Text>
              </Pressable>
              <Pressable onPress={onCopyYesterday} accessibilityRole="button" accessibilityHint="Copies this meal from yesterday">
                <Text variant="label" tone="accent">
                  Copy from yesterday
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          entries.map((entry, index) => (
            <View key={entry.id}>
              {index > 0 && <View style={{ height: 1, backgroundColor: colors.border, marginLeft: spacing.lg }} />}
              <EntryRow entry={entry} onPress={() => onOpenEntry(entry.id)} onDelete={() => onDeleteEntry(entry.id)} />
            </View>
          ))
        )}
      </View>
    </View>
  );
}
