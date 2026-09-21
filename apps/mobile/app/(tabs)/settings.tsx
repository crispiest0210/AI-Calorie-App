/**
 * Settings for Milestone 1: goals, data sources and licences, and what the
 * catalog currently holds. Account, sync and export arrive in Phase 2.
 */
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { sql } from 'drizzle-orm';
import { QUALITY_TIER_BADGES, type QualityTier } from '@nt/core';
import { outboxRepo } from '@nt/db';
import { useDbQuery } from '@/db/provider';
import { spacing, useTheme } from '@/theme';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const catalog = useDbQuery(
    (db) =>
      db.all<{ quality_tier: string; n: number }>(
        sql`select quality_tier, count(*) as n from food where deleted_at is null group by quality_tier order by n desc`,
      ),
    [],
  );
  const releases = useDbQuery(
    (db) => db.all<{ provider: string; dataset: string | null; version: string | null }>(sql`select provider, dataset, version from source_release where is_active = 1`),
    [],
  );
  const queued = useDbQuery((db) => outboxRepo.pendingCount(db), []);

  return (
    <Screen topInset>
      <Card style={{ gap: spacing.md }}>
        <Text variant="title">Settings</Text>
        <Button label="Goals" variant="secondary" onPress={() => router.push('/goals')} />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading">Your data</Text>
        <Text variant="label" tone="muted">
          Everything you log stays on this device. There is no account, no analytics and no third-party tracking.
        </Text>
        <Text variant="caption" tone="faint" numeric>
          {queued} {queued === 1 ? 'change' : 'changes'} queued for the sync that arrives in the next phase.
        </Text>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading">Food catalog</Text>
        {catalog.map((row) => (
          <View key={row.quality_tier} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="label" tone="muted">
              {QUALITY_TIER_BADGES[row.quality_tier as QualityTier] ?? row.quality_tier}
            </Text>
            <Text variant="label" numeric>
              {row.n}
            </Text>
          </View>
        ))}
        {releases.map((release) => (
          <Text key={`${release.provider}-${release.dataset}`} variant="caption" tone="faint">
            {release.provider.toUpperCase()} · {release.dataset ?? 'catalog'} · {release.version ?? 'unversioned'}
          </Text>
        ))}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading">Sources and licences</Text>
        <Text variant="label" tone="muted">
          USDA FoodData Central — public domain (CC0).
        </Text>
        <Text variant="label" tone="muted">
          Open Food Facts — Open Database License (ODbL); products and their data are attributed to Open Food Facts contributors.
        </Text>
        <Text variant="caption" tone="faint">
          Nutrient values come from these databases or from you. Nothing on this screen is medical advice.
        </Text>
      </Card>

      <View style={{ height: spacing.xxl, backgroundColor: colors.background }} />
    </Screen>
  );
}
