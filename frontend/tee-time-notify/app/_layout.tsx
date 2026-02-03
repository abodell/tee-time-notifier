import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState, useRef } from "react";
import "react-native-reanimated";
import { supabase } from "@/lib/supabase";
import { Session } from "@supabase/supabase-js";
import {
  PaperProvider,
  MD3LightTheme,
  MD3DarkTheme,
  Text,
  Button,
  Surface,
} from "react-native-paper";
import {
  PaperLightTheme,
  PaperDarkTheme,
  Colors,
} from "@/constants/theme";
import { View, ActivityIndicator, Platform, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import Toast, { ToastConfig } from "react-native-toast-message";
import * as Notifications from "expo-notifications";
import { LinearGradient } from "expo-linear-gradient";
import { registerForPushNotificationsAsync, setupNotificationHandlers } from "@/lib/notifications";
import Purchases from "react-native-purchases";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Configure notification handler (foreground behavior)
setupNotificationHandlers();

function setupNotificationListeners() {
  const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
    console.log("Notification received:", notification);
  });

  const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log("Notification response:", response);
  });

  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
  };
}

export default function RootLayout() {
  const systemScheme = useColorScheme();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRevenueCatConfigured, setIsRevenueCatConfigured] = useState(false);

  const [loaded] = useFonts({
    // We are using system fonts now, but keeping this hook if we add custom fonts later
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  useEffect(() => {
    // Initialize RevenueCat
    const apiKey = process.env.EXPO_PUBLIC_REVENUE_CAT_API_KEY;

    if (apiKey) {
      // Platform-specific configuration required for native builds
      if (Platform.OS === 'ios') {
        Purchases.configure({
          apiKey: apiKey,
        });
      } else if (Platform.OS === 'android') {
        Purchases.configure({
          apiKey: apiKey,
        });
      }
      setIsRevenueCatConfigured(true);
    } else {
      console.warn("RevenueCat API Key not found. IAP will not work.");
      // Still mark as configured to prevent blocking the app
      setIsRevenueCatConfigured(true);
    }
  }, []);


  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, sess) => setSession(sess)
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // Track the last user ID we identified to prevent redundant calls (429 errors)
  const lastIdentifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    let cleanupListeners: (() => void) | undefined;
    if (session && isRevenueCatConfigured) {
      // Only identify if the user ID has changed
      if (session.user.id !== lastIdentifiedUserId.current) {
        Purchases.logIn(session.user.id);
        lastIdentifiedUserId.current = session.user.id;
      }

      registerForPushNotificationsAsync();
      cleanupListeners = setupNotificationListeners();
    }
    return () => {
      if (cleanupListeners) cleanupListeners();
    };
  }, [session, isRevenueCatConfigured]);

  const theme = systemScheme === "dark" ? PaperDarkTheme : PaperLightTheme;
  const isDark = systemScheme === "dark";

  // Adapt Navigation Theme to match Paper Theme
  const NavDarkTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: PaperDarkTheme.colors.background,
      card: PaperDarkTheme.colors.background, // Match navbar to background
      text: PaperDarkTheme.colors.onBackground,
      border: PaperDarkTheme.colors.outline,
      primary: PaperDarkTheme.colors.primary,
    },
  };

  const NavLightTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: PaperLightTheme.colors.background,
      card: PaperLightTheme.colors.background, // Match navbar to background
      text: PaperLightTheme.colors.onBackground,
      border: PaperLightTheme.colors.outline,
      primary: PaperLightTheme.colors.primary,
    },
  };

  const navTheme = isDark ? NavDarkTheme : NavLightTheme;

  if (loading || !loaded) {
    return (
      <PaperProvider theme={theme}>
        <View
          style={{
            flex: 1,
            backgroundColor: theme.colors.background,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </PaperProvider>
    );
  }

  return (
    <ThemeProvider value={navTheme}>
      <PaperProvider theme={theme}>
        <StatusBar style={isDark ? "light" : "dark"} />

        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
            animation: "default",
          }}
        >
          {session ? (
            <Stack.Screen name="(tabs)" />
          ) : (
            <Stack.Screen name="(auth)" />
          )}
        </Stack>

        {/* ✅ Global Toast Manager */}
        <Toast
          config={{
            success: ({ text1 }) => (
              <Surface
                elevation={2}
                style={{
                  borderRadius: 25,
                  backgroundColor: theme.colors.surface,
                  paddingHorizontal: 20,
                  paddingVertical: 10,
                  marginTop: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  shadowColor: "#000",
                  shadowOpacity: 0.1,
                  shadowRadius: 8,
                  borderWidth: 1,
                  borderColor: theme.colors.outline,
                }}
              >
                <Text style={{ fontSize: 18, marginRight: 8 }}>✅</Text>
                <Text
                  style={{
                    color: theme.colors.onSurface,
                    fontWeight: "600",
                    fontSize: 14,
                  }}
                >
                  {text1}
                </Text>
              </Surface>
            ),
            error: ({ text1, text2 }) => (
              <Surface
                elevation={2}
                style={{
                  borderRadius: 16,
                  backgroundColor: theme.colors.errorContainer,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  marginTop: 10,
                  maxWidth: "90%",
                  alignSelf: "center",
                  borderWidth: 1,
                  borderColor: "rgba(255, 59, 48, 0.2)",
                }}
              >
                <Text
                  style={{
                    color: theme.colors.onErrorContainer,
                    fontWeight: "700",
                    marginBottom: 2,
                  }}
                >
                  {text1}
                </Text>
                {text2 && (
                  <Text
                    style={{
                      color: theme.colors.onErrorContainer,
                      fontSize: 13,
                    }}
                  >
                    {text2}
                  </Text>
                )}
              </Surface>
            ),
          }}
        />
      </PaperProvider>
    </ThemeProvider>
  );
}