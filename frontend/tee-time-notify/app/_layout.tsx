import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ONBOARDING_KEY } from "./onboarding";
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
import { View, ActivityIndicator, Platform, useColorScheme, DeviceEventEmitter } from "react-native";
import { StatusBar } from "expo-status-bar";
import Toast, { ToastConfig } from "react-native-toast-message";
import * as Notifications from "expo-notifications";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import { registerForPushNotificationsAsync, setupNotificationHandlers } from "@/lib/notifications";
import Purchases from "react-native-purchases";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Configure notification handler (foreground behavior)
setupNotificationHandlers();

function setupNotificationListeners(router: any) {
  const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
    console.log("Notification received:", notification);
    DeviceEventEmitter.emit("notificationReceived");
  });

  const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log("Notification response:", response);
    const alertId = response.notification.request.content.data?.alertId;

    // Always trigger a data refresh across the app so lists contain the latest openings
    DeviceEventEmitter.emit("notificationReceived");

    if (alertId) {
      // Small delay to ensure navigation stack is ready if waking from cold state
      setTimeout(() => {
        router.push(`/(tabs)/my-alerts?alertId=${alertId}`);
      }, 300);
    }
  });

  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
  };
}

export default function RootLayout() {
  const router = useRouter();
  const systemScheme = useColorScheme();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
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
    // Handle deep links for password reset and email confirmation
    const handleDeepLink = async (url: string | null) => {
      if (!url) return;

      const { queryParams, path } = Linking.parse(url);

      // Supabase sends tokens in the hash (fragment) which expo-linking might put in queryParams
      // or we might need to parse manually if they are in the fragment
      const hash = url.split('#')[1];
      if (hash) {
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const type = params.get("type");

        if (accessToken && refreshToken) {
          await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (type === "recovery") {
            router.replace("/reset-password" as any);
          }
        }
      }
    };

    // Get initial URL if app was closed
    Linking.getInitialURL().then(handleDeepLink);

    // Listen for new links while app is open
    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleDeepLink(url);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      const flag = await AsyncStorage.getItem(ONBOARDING_KEY);
      if (!flag) {
        if (data.session) {
          // Existing user — skip onboarding and write the key so they never see it
          await AsyncStorage.setItem(ONBOARDING_KEY, "true");
        } else {
          setNeedsOnboarding(true);
        }
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, sess) => {
        setSession(sess);
        if (_event === "PASSWORD_RECOVERY") {
          router.replace("/(auth)/reset-password" as any);
        }
        // Note: we intentionally do NOT call setNeedsOnboarding here.
        // For new users, getSession() already sets it before loading resolves.
        // Calling it again on SIGNED_IN (e.g. mid-onboarding Apple Sign In)
        // would flip needsOnboarding false→true and retrigger the navigation
        // effect, remounting OnboardingScreen back to step 0.
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // Navigate to onboarding after loading resolves — for ALL first-time users
  // regardless of auth status. Session check removed intentionally: unauthenticated
  // users go through onboarding first, then create an account mid-flow.
  useEffect(() => {
    if (!loading && needsOnboarding) {
      router.replace("/onboarding" as any);
    }
  }, [loading, needsOnboarding]);

  // Track the last user ID we identified to prevent redundant calls (429 errors)
  const lastIdentifiedUserId = useRef<string | null>(null);

  const lastNotificationResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (
      lastNotificationResponse &&
      lastNotificationResponse.notification.request.content.data?.alertId &&
      lastNotificationResponse.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER
    ) {
      const alertId = lastNotificationResponse.notification.request.content.data.alertId;
      // We wait slightly to ensure the router and session are fully mounted/restored
      setTimeout(() => {
        router.push(`/(tabs)/my-alerts?alertId=${alertId}`);
      }, 500);
    }
  }, [lastNotificationResponse, router]);

  useEffect(() => {
    let cleanupListeners: (() => void) | undefined;
    if (session && isRevenueCatConfigured) {
      // Only identify if the user ID has changed
      if (session.user.id !== lastIdentifiedUserId.current) {
        Purchases.logIn(session.user.id);
        lastIdentifiedUserId.current = session.user.id;
      }

      registerForPushNotificationsAsync();
      cleanupListeners = setupNotificationListeners(router);
    }
    return () => {
      if (cleanupListeners) cleanupListeners();
    };
  }, [session, isRevenueCatConfigured, router]);

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
          {/* All screens always declared — never conditionally render Stack children
              as changing the Stack structure causes Expo Router to remount the
              current screen (e.g. resetting onboarding step mid-flow on sign-in). */}
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
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