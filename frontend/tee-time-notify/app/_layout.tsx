import React, { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { supabase } from "../lib/supabase";
import { PaperProvider } from "react-native-paper";
import {
  PaperLightTheme,
  PaperDarkTheme,
} from "../constants/theme";
import { ActivityIndicator, useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Session } from "@supabase/supabase-js";
import { StatusBar } from "expo-status-bar";
import Toast from "react-native-toast-message";
import "react-native-reanimated";

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
      <StatusBar style={systemScheme === "dark" ? "light" : "dark"} />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
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
            <SafeAreaView
              style={{
                width: "100%",
                alignItems: "center",
              }}
            >
              <ActivityIndicator />{/* This could be removed if not needed */}
              <ToastContainer
                text={text1 || ""}
                background={theme.colors.primary}
                color={theme.colors.onPrimary}
              />
            </SafeAreaView>
          ),
        }}
      />
    </PaperProvider>
  );
}

/**
 * Lightweight styled toast component for global config.
 */
import { View, Text } from "react-native";

function ToastContainer({
  text,
  background,
  color,
}: {
  text: string;
  background: string;
  color: string;
}) {
  return (
    <View
      style={{
        backgroundColor: background,
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 10,
        marginTop: 10,
        elevation: 4,
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 10,
      }}
    >
      <Text
        style={{
          color,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {text}
      </Text>
    </View>
  );
}