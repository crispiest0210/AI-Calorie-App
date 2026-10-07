/**
 * Photo review (spec 5.3). The model's words are shown small; the food the
 * user is actually logging is shown large. Nothing reaches the log until
 * Confirm, and Confirm stays disabled while anything is unresolved.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatEnergy, formatGrams, formatRange, localDateOf, num, type MealSlot } from '@nt/core';
import { entries as entriesRepo, foods as foodsRepo } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { useSession } from '@/auth/provider';
import { config } from '@/config';
import { spacing, radii, useTheme } from '@/theme';
import { successFeedback } from '@/hooks/useHaptics';
import { canConfirm, draftEnergy, needsResolving, toConfirmedEntries, toReviewItems, type ReviewItem, type ServerDraft } from '@/photo/draft';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { NumberField } from '@/components/NumberField';
import { SourceBadge } from '@/components/SourceBadge';

const BAND_COPY = { likely: 'Likely', possible: 'Possible', unsure: 'Unsure' } as const;

export default function PhotoReviewScreen() {
  const db = useDb();
  const router = useRouter();
  const { colors } = useTheme();
  const { getAccessToken } = useSession();
  const params = useLocalSearchParams<{ analysisId: string; draft?: string; mealSlot?: string; date?: string }>();

  const serverDraft = useMemo<ServerDraft | null>(
    () => (params.draft === undefined ? null : (JSON.parse(params.draft) as ServerDraft)),
    [params.draft],
  );

  const initial = useDbQuery(
    (database) => (serverDraft === null ? [] : toReviewItems(database, serverDraft)),
    [serverDraft],
  );
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const review = items ?? initial;
  const energy = draftEnergy(review);
  const ready = canConfirm(review);

  const update = useCallback(
    (itemId: string, change: Partial<ReviewItem>) => {
      setItems((current) => (current ?? initial).map((item) => (item.itemId === itemId ? { ...item, ...change } : item)));
    },
    [initial],
  );

  const choose = useCallback(
    (itemId: string, foodId: string) => {
      update(itemId, { chosenFoodId: foodId, food: foodsRepo.foodDetail(db, foodId) });
    },
    [db, update],
  );

  const confirm = useCallback(async () => {
    const at = params.date === undefined || params.date === localDateOf() ? new Date() : new Date(`${params.date}T12:00:00`);
    for (const entry of toConfirmedEntries(review)) {
      entriesRepo.logFood(db, {
        foodId: entry.foodId,
        foodName: entry.foodName,
        sourceReleaseId: entry.sourceReleaseId,
        mealSlot: (params.mealSlot as MealSlot | undefined) ?? 'lunch',
        amountValue: entry.grams,
        amountUnit: 'g',
        grams: entry.grams,
        gramsProvenance: entry.gramsProvenance,
        nutrientsPer100g: entry.nutrientsPer100g,
        at,
      });
    }
    successFeedback();

    // Tell the server the draft is done, which starts the retention clock.
    const token = await getAccessToken();
    if (token !== null) {
      await fetch(`${config.apiBaseUrl}/v1/photo-analyses/${params.analysisId}/resolve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }).catch(() => undefined);
    }
    router.dismissAll();
  }, [db, getAccessToken, params.analysisId, params.date, params.mealSlot, review, router]);

  if (serverDraft === null) {
    return (
      <Screen>
        <Card>
          <Text tone="muted">This draft is no longer available. Take the photo again.</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card style={{ gap: spacing.sm }}>
        <Text variant="title" numeric>
          {energy.exact === null ? formatRange(energy.low, energy.high, 'energy_kcal') : `${formatEnergy(energy.exact)} cal`}
        </Text>
        <Text variant="caption" tone="muted">
          {energy.exact === null
            ? 'A range until every item is accepted. These calories come from the food you pick, not from the photo.'
            : 'Every item accepted.'}
        </Text>
        {serverDraft.notes !== null && (
          <Text variant="caption" tone="faint">
            {serverDraft.notes}
          </Text>
        )}
      </Card>

      {review.map((item) => {
        const unresolved = needsResolving(item);
        return (
          <Card key={item.itemId} style={{ gap: spacing.md, borderColor: unresolved ? colors.over : colors.border }}>
            <View style={{ gap: 2 }}>
              <Text variant="caption" tone="faint">
                the photo looks like “{item.label}”{item.preparation === null ? '' : `, ${item.preparation}`}
              </Text>
              <Text variant="heading">{item.food?.name ?? 'Choose a food'}</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <View
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 2,
                    borderRadius: radii.pill,
                    backgroundColor: item.identification.band === 'unsure' ? colors.overSurface : colors.accentMuted,
                  }}
                >
                  <Text variant="caption" tone={item.identification.band === 'unsure' ? 'over' : 'muted'}>
                    {BAND_COPY[item.identification.band]}
                  </Text>
                </View>
                {item.food !== null && <SourceBadge tier={item.food.qualityTier} />}
                {item.occluded && (
                  <Text variant="caption" tone="faint">
                    partly hidden
                  </Text>
                )}
              </View>
            </View>

            {item.candidates.length > 0 && (
              <View style={{ gap: spacing.xs }}>
                <Text variant="label" tone="muted">
                  Which food is it?
                </Text>
                {item.candidates.map((candidate) => {
                  const selected = candidate.foodId === item.chosenFoodId;
                  return (
                    <Text
                      key={candidate.foodId}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={candidate.name}
                      onPress={() => choose(item.itemId, candidate.foodId)}
                      variant="label"
                      tone={selected ? 'accent' : 'muted'}
                      style={{
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.md,
                        borderRadius: radii.md,
                        borderWidth: 1,
                        borderColor: selected ? colors.accent : colors.border,
                      }}
                    >
                      {selected ? '● ' : '○ '}
                      {candidate.name}
                    </Text>
                  );
                })}
              </View>
            )}

            <Button
              label={item.candidates.length === 0 ? 'Search for this food' : 'Something else'}
              variant="secondary"
              onPress={() => router.push({ pathname: '/log', params: { pickFor: 'photo', itemId: item.itemId } })}
            />

            <NumberField
              label={`Amount${item.gramsUntouched ? ' (estimated)' : ''}`}
              value={item.grams}
              onChange={(value) => update(item.itemId, { grams: num(value || '0'), gramsUntouched: false })}
              suffix="g"
              step={10}
            />
            {item.gramsUntouched && (
              <Text variant="caption" tone="faint" numeric>
                estimated {formatGrams(item.portionGrams.low)}–{formatGrams(item.portionGrams.high)} g
                {item.portionGrams.basis === null ? '' : ` · judged against ${item.portionGrams.basis}`}
              </Text>
            )}

            <Text
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.label}`}
              variant="label"
              tone="accent"
              onPress={() => setItems((current) => (current ?? initial).filter((entry) => entry.itemId !== item.itemId))}
            >
              Remove this item
            </Text>
          </Card>
        );
      })}

      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Button label="Confirm and log" disabled={!ready} onPress={() => void confirm()} />
        {!ready && (
          <Text variant="caption" tone="over">
            Pick a food for every item first. Nothing is logged until you do.
          </Text>
        )}
        <Text variant="caption" tone="faint">
          The photo is deleted from the server 24 hours after you confirm.
        </Text>
      </View>
    </Screen>
  );
}
