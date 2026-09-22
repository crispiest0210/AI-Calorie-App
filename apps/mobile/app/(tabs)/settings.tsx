/**
 * Settings: goals, account and sync, your data, and where the numbers come
 * from. Export and account deletion are here because no one else should use
 * this app until they exist (F14).
 */
import { useState } from 'react';
import { Alert, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { sql } from 'drizzle-orm';
import { QUALITY_TIER_BADGES, type QualityTier } from '@nt/core';
import { outboxRepo, sync as syncClient } from '@nt/db';
import { useDbQuery } from '@/db/provider';
import { useSession } from '@/auth/provider';
import { useSync } from '@/sync/provider';
import { accountsEnabled, config } from '@/config';
import { spacing, useTheme } from '@/theme';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { SyncBadge } from '@/components/SyncBadge';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { session, signOut, getAccessToken } = useSession();
  const { state, lastSyncedAt, message, syncNow } = useSync();
  const [busy, setBusy] = useState<string | null>(null);

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
  const cursor = useDbQuery((db) => syncClient.pullCursor(db), []);

  const exportData = async () => {
    setBusy('export');
    try {
      const token = await getAccessToken();
      if (token === null) {
        Alert.alert('Sign in first', 'Export runs from your account so it includes every device.');
        return;
      }
      const response = await fetch(`${config.apiBaseUrl}/v1/me/export`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) {
        Alert.alert('Export failed', 'Check your connection and try again.');
        return;
      }
      await Share.share({ message: await response.text(), title: 'Nutrition Tracker export' });
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'This removes your logs, custom foods and goals from the server. It cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy('delete');
              try {
                const token = await getAccessToken();
                if (token === null) return;
                const response = await fetch(`${config.apiBaseUrl}/v1/me`, {
                  method: 'DELETE',
                  headers: { authorization: `Bearer ${token}` },
                });
                if (response.status === 401) {
                  Alert.alert('Sign in again', 'Deleting an account needs a fresh sign-in. Sign out, sign back in, then try again.');
                  return;
                }
                if (!response.ok) {
                  Alert.alert('Could not delete', 'Check your connection and try again.');
                  return;
                }
                await signOut();
                Alert.alert('Account deleted', 'Your data on this device is still here. Delete the app to remove it.');
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  };

  return (
    <Screen topInset>
      <Card style={{ gap: spacing.md }}>
        <Text variant="title">Settings</Text>
        <Button label="Goals" variant="secondary" onPress={() => router.push('/goals')} />
        <Button label="Recipes" variant="secondary" onPress={() => router.push('/recipes')} />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text variant="heading">Account and sync</Text>
        {!accountsEnabled ? (
          <Text tone="muted">
            This build has no API address configured, so it runs in local mode. Everything works except syncing between
            devices.
          </Text>
        ) : session === null ? (
          <>
            <Text tone="muted">
              You are logging on this device only. An account syncs the same numbers to your other devices — nothing else
              changes.
            </Text>
            <Button label="Sign in" onPress={() => router.push('/sign-in')} />
          </>
        ) : (
          <>
            <Text tone="muted">Signed in as {session.email ?? session.userId}</Text>
            <SyncBadge onPress={() => void syncNow()} />
            <Text variant="caption" tone="faint" numeric>
              {lastSyncedAt === null ? 'Not synced yet' : `Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}`} ·
              cursor {cursor}
            </Text>
            {message !== null && (
              <Text variant="caption" tone="over">
                {message}
              </Text>
            )}
            <Button label={state === 'syncing' ? 'Syncing…' : 'Sync now'} variant="secondary" onPress={() => void syncNow()} />
            <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
          </>
        )}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text variant="heading">Your data</Text>
        <Text variant="label" tone="muted">
          Logs live on this device first. There are no third-party analytics and nothing is sold.
        </Text>
        <Text variant="caption" tone="faint" numeric>
          {queued} {queued === 1 ? 'change' : 'changes'} waiting to sync.
        </Text>
        {accountsEnabled && session !== null && (
          <>
            <Button label={busy === 'export' ? 'Preparing…' : 'Export everything'} variant="secondary" onPress={() => void exportData()} />
            <Button label={busy === 'delete' ? 'Deleting…' : 'Delete account'} variant="ghost" onPress={deleteAccount} />
          </>
        )}
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
          Open Food Facts — Open Database License (ODbL); products and their data are attributed to Open Food Facts
          contributors.
        </Text>
        <Text variant="caption" tone="faint">
          Nutrient values come from these databases or from you. Nothing here is medical advice.
        </Text>
      </Card>

      <View style={{ height: spacing.xxl, backgroundColor: colors.background }} />
    </Screen>
  );
}
