import React, { useEffect, useState } from "react";
import { View, StyleSheet, Alert } from "react-native";
import {
  Text,
  Button,
  useTheme,
  ActivityIndicator,
  Divider,
  Snackbar,
} from "react-native-paper";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";

interface UserProfile {
  email: string | null;
}

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [showLogoutToast, setShowLogoutToast] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error) console.error(error);
      setUser({ email: user?.email ?? null });
      setLoading(false);
    };
    fetchUser();
  }, []);

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    setShowLogoutToast(true);

    // show toast briefly, then redirect
    setTimeout(() => {
      router.replace("/(auth)/sign-in");
    }, 1000);
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text
          variant="headlineSmall"
          style={[styles.header, { color: theme.colors.onBackground }]}
        >
          Profile
        </Text>

        <Divider style={{ marginVertical: 8, opacity: 0.3 }} />

        <Text
          variant="titleMedium"
          style={[styles.label, { color: theme.colors.onSurfaceVariant }]}
        >
          Signed in as:
        </Text>

        <Text
          variant="bodyLarge"
          style={[styles.email, { color: theme.colors.onSurface }]}
        >
          {user?.email ?? "Unknown User"}
        </Text>

        <Button
          mode="contained"
          onPress={handleLogout}
          style={{ marginTop: 32 }}
          contentStyle={{ height: 48 }}
          labelStyle={{ fontWeight: "600" }}
        >
          Log Out
        </Button>
      </View>

      {/* Toast for logout */}
      <Snackbar
        visible={showLogoutToast}
        onDismiss={() => setShowLogoutToast(false)}
        duration={1000}
        style={{ backgroundColor: theme.colors.primary, marginBottom: 40 }}
      >
        <Text style={{ color: theme.colors.onPrimary, textAlign: "center" }}>
          Logged out
        </Text>
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    paddingVertical: 32,
    paddingHorizontal: 24,
    borderRadius: 16,
    elevation: 2,
  },
  header: {
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  label: {
    marginTop: 12,
    marginBottom: 6,
    textAlign: "center",
  },
  email: {
    textAlign: "center",
  },
});