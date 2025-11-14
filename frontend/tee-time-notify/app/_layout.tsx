// app/_layout.tsx
import React, { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { supabase } from "../lib/supabase";
import { PaperProvider } from "react-native-paper";
import {
  PaperLightTheme,
  PaperDarkTheme,
} from "../constants/theme";
import {
  useColorScheme,
  View,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { Session } from "@supabase/supabase-js";

export default function RootLayout() {
  const systemScheme = useColorScheme();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

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

  const theme = systemScheme === "dark" ? PaperDarkTheme : PaperLightTheme;

  if (loading) {
    return (
      <PaperProvider theme={theme}>
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: theme.colors.background,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </SafeAreaView>
      </PaperProvider>
    );
  }

  return (
    <PaperProvider theme={theme}>
      <Stack
        screenOptions={{
          headerShown: false,

          // unify top/bottom navigation bar background and content colors
          contentStyle: {
            backgroundColor: theme.colors.background,
          },
          navigationBarColor: theme.colors.background,
          statusBarStyle: systemScheme === "dark" ? "light" : "dark",
          statusBarBackgroundColor: theme.colors.background,
        }}
      >
        {session ? (
          <Stack.Screen name="(tabs)" />
        ) : (
          <Stack.Screen name="(auth)" />
        )}
      </Stack>
    </PaperProvider>
  );
}