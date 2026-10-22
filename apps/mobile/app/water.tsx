/** Today's water entries, with a custom amount and per-entry removal (F6). */
import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { dec, formatTimeOfDay, localDateOf, parseUserNumber } from '@nt/core';
import { WATER_ML_MAX, WATER_ML_MIN, water as waterRepo } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { spacing, useTheme } from '@/theme';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { NumberField } from '@/components/NumberField';

export default function WaterScreen() {
  const db = useDb();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ date?: string }>();
  const date = params.date ?? localDateOf();
  const [custom, setCustom] = useState('300');

  const entries = useDbQuery((database) => waterRepo.waterForDate(database, date), [date]);
  const total = useDbQuery((database) => waterRepo.waterTotalMl(database, date), [date]);
  const parsed = parseUserNumber(custom);
  const amount = parsed === null ? 0 : dec(parsed).toNumber();
  const valid = Number.isInteger(amount) && amount >= WATER_ML_MIN && amount <= WATER_ML_MAX;

  return (
    <Screen>
      <Card style={{ gap: spacing.lg }}>
        <Text variant="title" numeric>
          {total} mL today
        </Text>
        <NumberField label="Custom amount" value={custom} onChange={setCustom} suffix="mL" step={50} />
        <Button
          label={`Add ${valid ? amount : 0} mL`}
          disabled={!valid}
          onPress={() => waterRepo.addWater(db, amount, date === localDateOf() ? new Date() : new Date(`${date}T12:00:00`))}
        />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text variant="heading">Entries</Text>
        {entries.length === 0 && (
          <Text variant="label" tone="faint">
            No water logged yet.
          </Text>
        )}
        {entries.map((entry) => (
          <View
            key={entry.id}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}
          >
            <Text variant="label" numeric>
              {entry.amountMl} mL
            </Text>
            <Text variant="caption" tone="faint">
              {formatTimeOfDay(entry.loggedAt)}
            </Text>
            <Text
              accessibilityRole="button"
              accessibilityLabel={`Remove ${entry.amountMl} millilitres`}
              variant="label"
              tone="accent"
              onPress={() => waterRepo.deleteWater(db, entry.id)}
            >
              Remove
            </Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
