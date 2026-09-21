/**
 * Sign-in (F10). An account buys sync across devices and nothing else — the
 * app works fully without one, and says so here rather than in a footnote.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { AuthError, requestEmailCode, verifyEmailCode } from '@/auth/supabase';
import { useSession } from '@/auth/provider';
import { accountsEnabled } from '@/config';
import { spacing } from '@/theme';
import { Card, Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { LabelledTextInput } from '@/components/LabelledTextInput';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!accountsEnabled) {
    return (
      <Screen>
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading">Accounts are not configured</Text>
          <Text tone="muted">
            This build has no API address, so there is nothing to sign in to. Everything you log stays on this device.
          </Text>
        </Card>
      </Screen>
    );
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card style={{ gap: spacing.lg }}>
        <Text variant="title">Sync across devices</Text>
        <Text tone="muted">
          Everything you have already logged stays, and moves to your account the first time this device syncs.
        </Text>

        {stage === 'email' ? (
          <>
            <LabelledTextInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoFocus
            />
            <Button
              label={busy ? 'Sending…' : 'Email me a code'}
              disabled={busy || !email.includes('@')}
              onPress={() => run(async () => {
                await requestEmailCode(email.trim());
                setStage('code');
              })}
            />
          </>
        ) : (
          <>
            <Text tone="muted">We sent a six-digit code to {email.trim()}.</Text>
            <LabelledTextInput
              label="Code"
              value={code}
              onChangeText={(text) => setCode(text.replace(/\D/g, ''))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
            />
            <Button
              label={busy ? 'Checking…' : 'Sign in'}
              disabled={busy || code.length < 6}
              onPress={() => run(async () => {
                const session = await verifyEmailCode(email.trim(), code);
                await signIn(session);
                router.back();
              })}
            />
            <Button label="Use a different email" variant="ghost" onPress={() => { setStage('email'); setCode(''); }} />
          </>
        )}

        {error !== null && (
          <Text variant="label" tone="over">
            {error}
          </Text>
        )}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text variant="caption" tone="faint">
          Your food logs are private to your account. They are never sold, never used for advertising, and there are no
          third-party analytics in this app.
        </Text>
      </Card>

      <View style={{ padding: spacing.lg }}>
        <Button label="Keep using it without an account" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
