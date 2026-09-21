/**
 * The Log sheet (spec 5.2). Opens with search focused; Recent, Frequent and My
 * foods are one tap away. Tapping a recent logs it with its last amount, which
 * is the two-tap path in the speed targets (5.4).
 */
import { useCallback, useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MEAL_SLOTS, MEAL_SLOT_LABELS, localDateOf, type MealSlot } from '@nt/core';
import { foods as foodsRepo, entries as entriesRepo, type FoodSummary } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { MIN_TOUCH_TARGET, radii, spacing, typography, useTheme } from '@/theme';
import { successFeedback } from '@/hooks/useHaptics';
import { useDebounced } from '@/hooks/useDebounced';
import { Text } from '@/components/Text';
import { Row } from '@/components/Button';
import { FoodRow } from '@/components/FoodRow';
import { SegmentedControl } from '@/components/SegmentedControl';

type Tab = 'recent' | 'frequent' | 'mine';

const TABS: { value: Tab; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'frequent', label: 'Frequent' },
  { value: 'mine', label: 'My foods' },
];

const FREQUENT_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

export default function LogSheet() {
  const db = useDb();
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ date?: string; mealSlot?: string }>();
  const date = params.date ?? localDateOf();
  const [mealSlot, setMealSlot] = useState<MealSlot>(
    MEAL_SLOTS.includes(params.mealSlot as MealSlot) ? (params.mealSlot as MealSlot) : 'breakfast',
  );
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('recent');

  // 150 ms, per the search budget in 2.13 — long enough to skip a keystroke,
  // short enough that results feel live.
  const debouncedQuery = useDebounced(query, 150);

  const results = useDbQuery(
    (database) => (debouncedQuery.trim() === '' ? null : foodsRepo.searchFoods(database, debouncedQuery)),
    [debouncedQuery],
  );
  const recents = useDbQuery((database) => foodsRepo.recentFoods(database), []);
  const frequents = useDbQuery((database) => foodsRepo.frequentFoods(database, Date.now() - FREQUENT_WINDOW_MS), []);
  const mine = useDbQuery((database) => foodsRepo.myFoods(database), []);

  const list: FoodSummary[] = useMemo(() => {
    if (results !== null) return results;
    return tab === 'recent' ? recents : tab === 'frequent' ? frequents : mine;
  }, [results, tab, recents, frequents, mine]);

  const openAmount = useCallback(
    (foodId: string) => {
      router.push({ pathname: '/amount', params: { foodId, mealSlot, date } });
    },
    [router, mealSlot, date],
  );

  /** One-tap re-log: reuse the last amount this food was logged with. */
  const quickLog = useCallback(
    (food: FoodSummary) => {
      const last = foodsRepo.lastAmountFor(db, food.id);
      const detail = foodsRepo.foodDetail(db, food.id);
      if (last === null || last.grams === null || detail === null) {
        openAmount(food.id);
        return;
      }
      entriesRepo.logFood(db, {
        foodId: food.id,
        foodName: detail.name,
        sourceReleaseId: detail.sourceReleaseId,
        mealSlot,
        amountValue: last.amountValue,
        amountUnit: last.amountUnit as never,
        portionId: last.portionId,
        grams: last.grams,
        gramsProvenance: last.portionId === null ? 'user' : 'portion',
        nutrientsPer100g: detail.nutrientsPer100g,
      });
      successFeedback();
      router.back();
    },
    [db, mealSlot, openAmount, router],
  );

  const showingResults = results !== null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: spacing.lg, gap: spacing.lg }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search foods"
          placeholderTextColor={colors.textFaint}
          autoFocus
          autoCorrect={false}
          accessibilityLabel="Search foods"
          clearButtonMode="while-editing"
          style={[
            typography.body,
            {
              minHeight: MIN_TOUCH_TARGET,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              color: colors.text,
              backgroundColor: colors.surface,
            },
          ]}
        />

        <SegmentedControl
          label="Meal"
          options={MEAL_SLOTS.map((slot) => ({ value: slot, label: MEAL_SLOT_LABELS[slot] }))}
          value={mealSlot}
          onChange={setMealSlot}
        />

        {!showingResults && <SegmentedControl label="Show" options={TABS} value={tab} onChange={setTab} />}
      </View>

      <FlashList
        data={list}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <FoodRow
            food={item}
            subtitle={showingResults || tab !== 'recent' ? undefined : 'tap to repeat'}
            onPress={() => (showingResults || tab === 'mine' ? openAmount(item.id) : quickLog(item))}
            onLongPress={() => openAmount(item.id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border, marginLeft: spacing.lg }} />}
        ListEmptyComponent={
          <View style={{ padding: spacing.xl, gap: spacing.sm }}>
            <Text tone="muted">{showingResults ? 'No foods match that search.' : 'Nothing here yet.'}</Text>
            <Text variant="caption" tone="faint">
              {showingResults ? 'Add it as your own food from a label.' : 'Log something and it shows up here.'}
            </Text>
          </View>
        }
      />

      <Row
        gap={spacing.md}
        style={{
          padding: spacing.lg,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <ActionButton label="Quick add" hint="Log calories without a food" onPress={() => router.replace({ pathname: '/quick-add', params: { mealSlot, date } })} />
        <ActionButton label="New food" hint="Type in a nutrition label" onPress={() => router.replace({ pathname: '/custom-food', params: { mealSlot, date } })} />
      </Row>
    </View>
  );
}

function ActionButton({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        onPress={onPress}
        variant="label"
        tone="accent"
        style={{
          textAlign: 'center',
          minHeight: MIN_TOUCH_TARGET,
          lineHeight: MIN_TOUCH_TARGET,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
