import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "react-native";
import { Colors } from "../../constants/theme";

export default function TabsLayout() {
  const scheme = useColorScheme();
  const tint = Colors[scheme ?? "light"];

  const isDark = scheme === "dark";

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: isDark
            ? tint.background
            : tint.background,
        },
        headerTintColor: isDark ? tint.text : tint.text,
        tabBarStyle: {
          backgroundColor: isDark
            ? tint.background
            : tint.background,
          borderTopColor: isDark ? "#222" : "#ddd",
        },
        tabBarActiveTintColor: tint.tabIconSelected,
        tabBarInactiveTintColor: tint.tabIconDefault,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="my-alerts"
        options={{
          title: "My Alerts",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="golf-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}