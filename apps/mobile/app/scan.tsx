/**
 * Barcode scanning (F9). The camera only ever produces a number; the lookup
 * and every nutrient value come from the server's catalog.
 */
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { FoodDetailResponse } from '@nt/core';
import { foods as foodsRepo } from '@nt/db';
import { useDb, useDbQuery } from '@/db/provider';
import { useSession } from '@/auth/provider';
import { config, accountsEnabled } from '@/config';
import { spacing, useTheme } from '@/theme';
import { successFeedback } from '@/hooks/useHaptics';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { LabelledTextInput } from '@/components/LabelledTextInput';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

export default function ScanScreen() {
  const db = useDb();
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ mealSlot?: string; date?: string }>();
  const { getAccessToken } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const busy = useRef(false);

  const userRelease = useDbQuery((database) => foodsRepo.activeSourceRelease(database, 'user'), []);

  const lookup = useCallback(
    async (gtin: string) => {
      if (busy.current) return;
      busy.current = true;
      setStatus('Looking it up…');
      try {
        const token = await getAccessToken();
        if (token === null) {
          setStatus('Sign in to look up barcodes. You can still add the food from its label.');
          return;
        }
        const response = await fetch(`${config.apiBaseUrl}/v1/foods/barcode/${gtin}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (response.status === 404) {
          setStatus('No product for that barcode. Add it from the label instead.');
          return;
        }
        if (!response.ok) {
          setStatus('Lookup failed. Check your connection, or add it from the label.');
          return;
        }

        const food = (await response.json()) as FoodDetailResponse;
        if (userRelease === null) {
          setStatus('The catalog is still loading. Try again in a moment.');
          return;
        }

        // Cache it locally so the food works offline from now on.
        const existing = foodsRepo.foodDetail(db, food.id);
        if (existing === null) {
          foodsRepo.createCustomFood(
            db,
            {
              kind: 'branded',
              name: food.name,
              brand: food.brand,
              gtin: food.gtin,
              qualityTier: food.qualityTier,
              sourceRef: food.source.sourceRef ?? gtin,
              densityGPerMl: food.densityGPerMl,
              category: null,
              nutrients: Object.entries(food.nutrientsPer100g).map(([code, amount]) => ({
                code: code as never,
                amountPer100g: amount as string,
                derivation: 'reported' as const,
              })),
              portions: food.portions.map((p) => ({ label: p.label, gramWeight: p.gramWeight, source: p.source as never })),
            },
            { id: food.id, sourceReleaseId: userRelease, synced: false },
          );
        }

        successFeedback();
        router.replace({ pathname: '/amount', params: { foodId: food.id, mealSlot: params.mealSlot, date: params.date } });
      } finally {
        busy.current = false;
      }
    },
    [db, getAccessToken, params.date, params.mealSlot, router, userRelease],
  );

  if (!accountsEnabled) {
    return (
      <Screen>
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading">Barcode lookup needs an account</Text>
          <Text tone="muted">This build has no API address configured. You can still add the food from its label.</Text>
          <Button label="Add from label" onPress={() => router.replace({ pathname: '/custom-food', params })} />
        </Card>
      </Screen>
    );
  }

  if (permission === null) return <Screen scroll={false}><View /></Screen>;

  // A camera flow always has a non-camera way through it (spec 5.6).
  if (!permission.granted) {
    return (
      <Screen>
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading">Camera access</Text>
          <Text tone="muted">Scanning needs the camera. You can also type the number underneath the barcode.</Text>
          <Button label="Allow camera" onPress={() => void requestPermission()} />
          <ManualEntry value={manual} onChange={setManual} onSubmit={() => void lookup(manual)} />
        </Card>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CameraView
        style={{ flex: 1 }}
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={({ data }) => void lookup(data)}
      />
      <View style={{ padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface }}>
        {status !== null && (
          <Text variant="label" tone="over" accessibilityLiveRegion="polite">
            {status}
          </Text>
        )}
        <ManualEntry value={manual} onChange={setManual} onSubmit={() => void lookup(manual)} />
        <Button label="Add from label instead" variant="secondary" onPress={() => router.replace({ pathname: '/custom-food', params })} />
      </View>
    </View>
  );
}

function ManualEntry({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <LabelledTextInput
        label="Or type the barcode number"
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, ''))}
        keyboardType="number-pad"
        maxLength={14}
      />
      <Button label="Look it up" disabled={value.length < 8} onPress={onSubmit} />
    </View>
  );
}
