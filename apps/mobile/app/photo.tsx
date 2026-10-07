/**
 * Taking the photo (spec 2.7, 2.8). The image is resized and stripped of
 * metadata on the device before it goes anywhere — the original never leaves
 * the phone.
 */
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '@/auth/provider';
import { accountsEnabled, config } from '@/config';
import { spacing, useTheme } from '@/theme';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';

/** Spec 2.7: the long edge the model is sent. */
const MAX_EDGE = 1568;

const FAILURE_COPY: Record<string, string> = {
  not_food: 'That does not look like food. Try another photo, or add the food by hand.',
  analysis_timeout: 'That took too long. Your photo is still here — try again.',
  rate_limited: 'You have used today’s photo analyses. You can still log by searching.',
  upstream_unavailable: 'The analysis service is unreachable. Your photo is still here.',
};

export default function PhotoScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { getAccessToken } = useSession();
  const params = useLocalSearchParams<{ mealSlot?: string; date?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const camera = useRef<CameraView>(null);

  const analyze = useCallback(async () => {
    if (camera.current === null || busy) return;
    setBusy(true);
    setStatus('Preparing the photo…');

    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.9, exif: false });
      if (shot === undefined) return;

      /*
       * Resized and re-encoded here, which also drops EXIF — including the GPS
       * tag that would otherwise say where you ate (spec 2.8).
       */
      const prepared = await ImageManipulator.manipulateAsync(
        shot.uri,
        [{ resize: { width: MAX_EDGE } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      );

      const token = await getAccessToken();
      if (token === null) {
        setStatus('Sign in to analyse photos. You can still log by searching.');
        return;
      }
      const auth = { authorization: `Bearer ${token}` };

      setStatus('Uploading…');
      const urlResponse = await fetch(`${config.apiBaseUrl}/v1/photos/upload-url`, { method: 'POST', headers: auth });
      if (!urlResponse.ok) {
        setStatus(FAILURE_COPY.upstream_unavailable!);
        return;
      }
      const { analysisId, uploadUrl } = (await urlResponse.json()) as { analysisId: string; uploadUrl: string };

      const blob = await (await fetch(prepared.uri)).blob();
      await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'content-type': 'image/jpeg' } });

      setStatus('Looking at your meal…');
      const runResponse = await fetch(`${config.apiBaseUrl}/v1/photo-analyses/${analysisId}/run`, { method: 'POST', headers: auth });
      if (!runResponse.ok) {
        const problem = (await runResponse.json().catch(() => null)) as { code?: string } | null;
        setStatus(FAILURE_COPY[problem?.code ?? ''] ?? 'That did not work. Try again, or add the food by hand.');
        return;
      }

      router.replace({
        pathname: '/photo-review',
        params: { analysisId, draft: await runResponse.text(), mealSlot: params.mealSlot, date: params.date },
      });
    } finally {
      setBusy(false);
    }
  }, [busy, getAccessToken, params.date, params.mealSlot, router]);

  if (!accountsEnabled) {
    return (
      <Screen>
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading">Photo analysis needs an account</Text>
          <Text tone="muted">
            Analysis runs on the server, so this build has nowhere to send the photo. You can still log by searching or
            from a label.
          </Text>
        </Card>
      </Screen>
    );
  }

  if (permission === null) return <Screen scroll={false}><View /></Screen>;

  if (!permission.granted) {
    return (
      <Screen>
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading">Camera access</Text>
          <Text tone="muted">
            Analysing a meal needs the camera. Photos are resized and stripped of location data before they leave this
            phone, and the server copy is deleted a day after you confirm.
          </Text>
          <Button label="Allow camera" onPress={() => void requestPermission()} />
          <Button label="Log by searching instead" variant="secondary" onPress={() => router.replace('/log')} />
        </Card>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CameraView ref={camera} style={{ flex: 1 }} />
      <View style={{ padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface }}>
        {status !== null && (
          <Text variant="label" tone="muted" accessibilityLiveRegion="polite">
            {status}
          </Text>
        )}
        <Button label={busy ? 'Working…' : 'Analyse this meal'} disabled={busy} onPress={() => void analyze()} />
        <Text variant="caption" tone="faint">
          You will see what it found and can change anything before it is logged.
        </Text>
      </View>
    </View>
  );
}
