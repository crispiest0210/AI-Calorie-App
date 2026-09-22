/**
 * The provenance sheet (spec 5.2, and the traceability promise in 1's
 * non-functional requirements): every nutrient on screen can be tapped to
 * show where the number came from.
 *
 * It reads the entry's own snapshot, not the catalog, because that snapshot is
 * what the day was computed from — showing today's catalog value here would
 * describe a number the user is not looking at.
 */
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  NUTRIENT_CODES,
  NUTRIENT_DEFS,
  QUALITY_TIER_BADGES,
  entryNutrients,
  formatGrams,
  formatTimeOfDay,
  formatWithUnit,
  type NutrientCode,
  type QualityTier,
} from '@nt/core';
import { entries as entriesRepo, foods as foodsRepo } from '@nt/db';
import { useDbQuery } from '@/db/provider';
import { spacing, useTheme } from '@/theme';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { SourceBadge } from '@/components/SourceBadge';

const DERIVATION_COPY: Record<string, string> = {
  reported: 'reported by the source',
  converted: 'converted from the source’s units',
  derived: 'derived from other values in the record',
  computed: 'computed from ingredients',
};

export default function ProvenanceScreen() {
  const { colors } = useTheme();
  const { entryId, foodId } = useLocalSearchParams<{ entryId?: string; foodId?: string }>();

  const entry = useDbQuery((db) => (entryId === undefined ? null : entriesRepo.entryById(db, entryId)), [entryId]);
  const lookupId = foodId ?? entry?.foodId ?? null;
  const food = useDbQuery((db) => (lookupId === null ? null : foodsRepo.foodDetail(db, lookupId)), [lookupId]);
  const release = useDbQuery(
    (db) => (food === null ? null : foodsRepo.sourceRelease(db, food.sourceReleaseId)),
    [food?.sourceReleaseId],
  );

  const snapshot = entry === null ? null : entry.nutrientsPer100g ?? entry.nutrientsAbsolute;
  const contributed = entry === null ? null : entryNutrients(entry);
  const perHundred = snapshot ?? food?.nutrientsPer100g ?? {};
  const tier = (entry?.qualityTier ?? food?.qualityTier ?? (entry?.entryKind === 'quick_add' ? 'user' : null)) as QualityTier | null;
  const codes = NUTRIENT_CODES.filter((code) => perHundred[code] !== undefined);

  return (
    <Screen>
      <Card style={{ gap: spacing.sm }}>
        <Text variant="title">{entry?.foodName ?? food?.name ?? 'Unknown food'}</Text>
        <SourceBadge tier={tier} />
        <Text variant="label" tone="muted">
          {entry?.entryKind === 'quick_add'
            ? 'You typed these numbers. Nothing was looked up, so there is no record behind them.'
            : entry !== null
              ? 'These are the values copied when you logged this, so later catalog updates cannot change this day.'
              : 'These are the values currently in the catalog.'}
        </Text>
      </Card>

      {food !== null && (
        <Card style={{ gap: spacing.sm }}>
          <Text variant="heading">Record</Text>
          <Row label="Source" value={release === null ? '—' : release.provider.toUpperCase()} />
          <Row label="Dataset" value={release?.dataset ?? '—'} />
          <Row label="Release" value={release?.version ?? '—'} />
          <Row label="Record id" value={food.sourceRef ?? '—'} />
          <Row label="Quality" value={tier === null ? '—' : QUALITY_TIER_BADGES[tier]} />
          {food.category !== null && food.category !== undefined && <Row label="Category" value={food.category} />}
        </Card>
      )}

      {entry !== null && (
        <Card style={{ gap: spacing.sm }}>
          <Text variant="heading">This entry</Text>
          <Row label="Logged" value={formatTimeOfDay(entry.loggedAt)} />
          <Row label="Amount" value={`${entry.amountValue} ${entry.portionLabel ?? entry.amountUnit}`} />
          {entry.grams !== null && <Row label="Resolved to" value={`${formatGrams(entry.grams)} g`} />}
          <Row
            label="How the amount was set"
            value={
              entry.gramsProvenance === 'portion' ? 'a serving from the source'
              : entry.gramsProvenance === 'user' ? 'you entered it'
              : entry.gramsProvenance === 'ai_estimate' ? 'estimated from a photo, not yet edited'
              : 'estimated from a photo, then adjusted'
            }
          />
        </Card>
      )}

      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading">{snapshot === null ? 'Per 100 g' : entry?.entryKind === 'quick_add' ? 'Values' : 'Per 100 g at log time'}</Text>
        {codes.length === 0 && (
          <Text variant="label" tone="faint">
            This record reports no nutrients.
          </Text>
        )}
        {codes.map((code) => (
          <NutrientRow
            key={code}
            code={code}
            per100g={perHundred[code]!}
            contributed={contributed?.[code] ?? null}
            derivation={food?.derivations?.[code] ?? null}
          />
        ))}
        <Text variant="caption" tone="faint" style={{ marginTop: spacing.xs }}>
          Anything not listed is not reported by this source. It is left missing rather than counted as zero, which is
          why a day can be marked incomplete.
        </Text>
      </Card>

      <View style={{ height: spacing.xxl, backgroundColor: colors.background }} />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Text variant="label" numeric style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}

function NutrientRow({
  code,
  per100g,
  contributed,
  derivation,
}: {
  code: NutrientCode;
  per100g: string;
  contributed: string | null;
  derivation: string | null;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${NUTRIENT_DEFS[code].displayName}: ${formatWithUnit(per100g, code)} per 100 grams${
        contributed === null ? '' : `, contributing ${formatWithUnit(contributed, code)}`
      }${derivation === null ? '' : `, ${DERIVATION_COPY[derivation] ?? derivation}`}`}
      style={{ gap: 2 }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="label" tone="muted">
          {NUTRIENT_DEFS[code].displayName}
        </Text>
        <Text variant="label" numeric>
          {formatWithUnit(per100g, code)}
          {contributed === null ? '' : ` → ${formatWithUnit(contributed, code)}`}
        </Text>
      </View>
      {derivation !== null && derivation !== 'reported' && (
        <Text variant="caption" tone="faint">
          {DERIVATION_COPY[derivation] ?? derivation}
        </Text>
      )}
    </View>
  );
}
