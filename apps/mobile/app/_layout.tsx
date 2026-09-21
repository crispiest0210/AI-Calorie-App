import '@/polyfills';

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { DatabaseProvider } from '@/db/provider';
import { useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();

function Loading() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export default function RootLayout() {
  const { colors, isDark } = useTheme();

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <DatabaseProvider fallback={<Loading />}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.text,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="log" options={{ presentation: 'modal', title: 'Log' }} />
            <Stack.Screen name="amount" options={{ presentation: 'modal', title: 'Amount' }} />
            <Stack.Screen name="quick-add" options={{ presentation: 'modal', title: 'Quick add' }} />
            <Stack.Screen name="custom-food" options={{ presentation: 'modal', title: 'New food' }} />
            <Stack.Screen name="water" options={{ presentation: 'modal', title: 'Water' }} />
            <Stack.Screen name="goals" options={{ title: 'Goals' }} />
            <Stack.Screen name="entry/[id]" options={{ title: 'Entry' }} />
            <Stack.Screen name="day/[date]" options={{ title: 'Day' }} />
          </Stack>
        </DatabaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
