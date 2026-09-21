/**
 * The quiet sync indicator (spec 2.11). It never blocks anything: a write went
 * to SQLite before this had an opinion.
 */
import { Pressable, View } from 'react-native';
import { radii, spacing, useTheme } from '@/theme';
import { useSync } from '@/sync/provider';
import { Text } from './Text';

export function SyncBadge({ onPress }: { onPress?: () => void }) {
  const { colors } = useTheme();
  const { state, pending, message } = useSync();

  const label =
    state === 'syncing' ? 'Syncing…'
    : state === 'offline' ? `Offline${pending > 0 ? ` · ${pending} waiting` : ''}`
    : state === 'error' ? 'Sync problem'
    : state === 'signed_out' ? (pending > 0 ? `${pending} on this device` : 'Not signed in')
    : pending > 0 ? `${pending} waiting`
    : 'Synced';

  const tone = state === 'error' ? 'over' : state === 'idle' && pending === 0 ? 'muted' : 'faint';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress === undefined ? 'text' : 'button'}
      accessibilityLabel={message ?? label}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radii.pill,
        backgroundColor: colors.surfaceRaised,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Text variant="caption" tone={tone}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
