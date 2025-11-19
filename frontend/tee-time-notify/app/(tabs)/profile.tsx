import React, { useEffect, useState } from "react";
import { View, ScrollView, StyleSheet, Alert, TouchableOpacity } from "react-native";
import {
  Text,
  Button,
  useTheme,
  ActivityIndicator,
  IconButton,
  Surface,
  TextInput,
  HelperText,
} from "react-native-paper";
import { supabase } from "../../lib/supabase";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import FadeSlideTransition from "@/components/FadeSlideTransition";
import { MaterialCommunityIcons } from "@expo/vector-icons";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

interface MembershipTier {
  name: string;
  description?: string;
  price_cents?: number;
  max_alerts?: number;
  scan_interval_seconds?: number;
}

interface UserProfile {
  id: string;
  email?: string;
  membership_tiers?: MembershipTier;
}

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<UserProfile | null>(null);

  // For embedded sign-up form (when not authenticated)
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signUpLoading, setSignUpLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, sess) => setSession(sess)
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // Fetch membership profile ONLY when session exists
  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    fetchProfile();
  }, [session]);

  const fetchProfile = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) throw new Error("No active session");

      const res = await fetch(`${API_URL}/membership/profile/${user.id}`);
      if (!res.ok) throw new Error("Unable to load membership info.");

      const membershipData = await res.json();
      setUser({
        id: user.id,
        email: user.email,
        membership_tiers: membershipData.membership_tiers,
      });
    } catch (err: any) {
      Toast.show({
        type: "error",
        text1: "Failed to load profile",
        text2: err.message,
        position: "top",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    router.replace("/(auth)/sign-in");
  };

  const handleSignUp = async () => {
    setSignUpLoading(true);
    setSignupError(null);

    const { error } = await supabase.auth.signUp({ email, password });
    setSignUpLoading(false);

    if (error) {
      setSignupError(error.message);
    } else {
      Toast.show({
        type: "success",
        text1: "Check your email to confirm your account",
        position: "top",
      });
      router.replace("/(auth)/sign-in");
    }
  };

  // -------------------------------------------------------
  // 🟥 If NOT logged in → Show SIGN-UP FORM instead of Profile UI
  // -------------------------------------------------------
  if (!session) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.authContainer}
          showsVerticalScrollIndicator={false}
        >
          <FadeSlideTransition>
            <View style={{ alignItems: "center", marginBottom: 32 }}>
              <MaterialCommunityIcons name="golf" size={64} color={theme.colors.primary} />
              <Text variant="headlineMedium" style={{ fontWeight: "700", marginTop: 16, color: theme.colors.onBackground }}>
                Join Tee Time Snipe
              </Text>
              <Text variant="bodyLarge" style={{ color: theme.colors.onSurfaceVariant, textAlign: "center", marginTop: 8 }}>
                Create an account to start tracking open tee times.
              </Text>
            </View>

            <Surface style={[styles.authCard, { backgroundColor: theme.colors.surface }]} elevation={0}>
              <TextInput
                label="Email"
                mode="outlined"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                style={{ marginBottom: 16, backgroundColor: theme.colors.surface }}
                outlineStyle={{ borderRadius: 12 }}
              />

              <TextInput
                label="Password"
                mode="outlined"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                style={{ marginBottom: 16, backgroundColor: theme.colors.surface }}
                outlineStyle={{ borderRadius: 12 }}
              />

              {signupError && (
                <HelperText type="error" visible={!!signupError}>
                  {signupError}
                </HelperText>
              )}

              <Button
                mode="contained"
                onPress={handleSignUp}
                disabled={!email || !password || signUpLoading}
                contentStyle={{ height: 50 }}
                labelStyle={{ fontWeight: "600", fontSize: 16 }}
                style={{ borderRadius: 12, marginTop: 8 }}
              >
                {signUpLoading ? "Creating Account..." : "Create Account"}
              </Button>
            </Surface>

            <View style={styles.authFooter}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                Already have an account?
              </Text>
              <TouchableOpacity onPress={() => router.replace("/(auth)/sign-in")}>
                <Text style={{ color: theme.colors.primary, fontWeight: "600", marginLeft: 4 }}>
                  Sign In
                </Text>
              </TouchableOpacity>
            </View>
          </FadeSlideTransition>
        </ScrollView>
      </View>
    );
  }

  // -------------------------------------------------------
  // 🟩 If logged in → Normal PROFILE UI
  // -------------------------------------------------------
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const tier = user?.membership_tiers;
  const price =
    tier?.price_cents && tier.price_cents > 0
      ? `$${(tier.price_cents / 100).toFixed(2)}/mo`
      : "Free";

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Text variant="headlineMedium" style={{ fontWeight: "700", color: theme.colors.onBackground }}>
          Profile
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Membership Section */}
        <Text style={[styles.sectionTitle, { color: theme.colors.onSurfaceVariant }]}>MEMBERSHIP</Text>
        <View style={[styles.sectionContainer, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: theme.colors.primary + "20" }]}>
              <MaterialCommunityIcons name="crown" size={22} color={theme.colors.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text variant="titleMedium" style={{ fontWeight: "600", color: theme.colors.onSurface }}>
                {tier?.name || "Free Plan"}
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {price} • {tier?.max_alerts ?? 3} Active Alerts
              </Text>
            </View>
            <Button
              mode="text"
              compact
              textColor={theme.colors.primary}
              labelStyle={{ fontWeight: "600" }}
              onPress={() => router.push("/upgrade")}
            >
              Manage
            </Button>
          </View>

          <View style={[styles.separator, { backgroundColor: theme.colors.outline }]} />

          <View style={styles.row}>
            <Text style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}>
              Scan Interval
            </Text>
            <Text style={{ color: theme.colors.onSurface, fontWeight: "500" }}>
              Every {tier?.scan_interval_seconds ? tier.scan_interval_seconds / 60 : 10} mins
            </Text>
          </View>
        </View>

        {/* Account Section */}
        <Text style={[styles.sectionTitle, { color: theme.colors.onSurfaceVariant, marginTop: 24 }]}>ACCOUNT</Text>
        <View style={[styles.sectionContainer, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.row}>
            <Text style={{ color: theme.colors.onSurface, fontSize: 16 }}>Email</Text>
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 16 }}>{user?.email}</Text>
          </View>

          <View style={[styles.separator, { backgroundColor: theme.colors.outline }]} />

          <TouchableOpacity style={styles.row} onPress={handleLogout}>
            <Text style={{ color: theme.colors.error, fontSize: 16, fontWeight: "500" }}>Log Out</Text>
            <MaterialCommunityIcons name="logout" size={20} color={theme.colors.error} />
          </TouchableOpacity>
        </View>

        <Text style={{ textAlign: "center", color: theme.colors.onSurfaceVariant, marginTop: 32, opacity: 0.5, fontSize: 12 }}>
          Tee Time Snipe v1.0.0
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    marginLeft: 16,
    letterSpacing: 0.5,
  },
  sectionContainer: {
    borderRadius: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    justifyContent: "space-between",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },

  // Auth styles
  authContainer: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  authCard: {
    borderRadius: 16,
    padding: 24,
  },
  authFooter: {
    marginTop: 24,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});