import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "react-native-paper";
import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HapticTab } from "@/components/haptic-tab";

/**
 * Icons switch to their filled variant when active. The weight change reads
 * as "you are here" faster than a color change alone, which is why system
 * tab bars do it.
 */
const ICONS = {
  index: ["compass", "compass-outline"],
  "my-alerts": ["notifications", "notifications-outline"],
  profile: ["person", "person-outline"],
} as const;

export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const renderIcon =
    (name: keyof typeof ICONS) =>
    ({ color, focused }: { color: string; focused: boolean }) => {
      const [active, inactive] = ICONS[name];
      return (
        <Ionicons
          name={focused ? active : inactive}
          size={26}
          color={color}
        />
      );
    };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Haptic feedback on tab press. The component already existed but was
        // never wired up, so tab presses had no tactile response at all.
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: theme.colors.elevation.level2,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.outline,
          elevation: 0,
          shadowOpacity: 0,
          // Derived from the real inset instead of a fixed 90/30, which was too
          // tall on devices without a home indicator and clipped on some with one.
          height: 56 + Math.max(insets.bottom, Platform.OS === "ios" ? 8 : 10),
          paddingBottom: Math.max(insets.bottom, Platform.OS === "ios" ? 8 : 10),
          paddingTop: 8,
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarLabelStyle: {
          fontWeight: "600",
          fontSize: 11,
          marginTop: 2,
          letterSpacing: 0.1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Find", tabBarIcon: renderIcon("index") }}
      />
      <Tabs.Screen
        name="my-alerts"
        options={{ title: "My Alerts", tabBarIcon: renderIcon("my-alerts") }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", tabBarIcon: renderIcon("profile") }}
      />
    </Tabs>
  );
}
