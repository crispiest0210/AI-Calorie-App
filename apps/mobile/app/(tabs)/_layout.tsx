import { Tabs } from 'expo-router';
import { Text } from '@/components/Text';
import { useTheme } from '@/theme';

/** Three tabs; the Log button lives on Today itself (spec 5.1). */
function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text variant="caption" tone={focused ? 'accent' : 'faint'}>
      {label}
    </Text>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Today', tabBarIcon: ({ focused }) => <TabIcon label="●" focused={focused} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: 'History', tabBarIcon: ({ focused }) => <TabIcon label="▤" focused={focused} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ focused }) => <TabIcon label="⚙" focused={focused} /> }}
      />
    </Tabs>
  );
}
