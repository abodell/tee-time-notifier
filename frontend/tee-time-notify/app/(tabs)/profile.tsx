import React, { useEffect, useState, useCallback } from "react";
import { View, ScrollView, StyleSheet, Alert, TouchableOpacity, DeviceEventEmitter } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Text,
  Button,
  useTheme,
  ActivityIndicator,
  IconButton,
  Surface,
} from "react-native-paper";
import { supabase } from "../../lib/supabase";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import Toast from "react-native-toast-message";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Skeleton } from "moti/skeleton";
import * as Linking from "expo-linking";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";
import OAuthSection from "@/components/auth/OAuthSection";

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
  const { success } = useLocalSearchParams();

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, sess) => {
        setSession(sess);
        if (!sess) setLoading(false);
      }
    );

    const membershipSub = DeviceEventEmitter.addListener("membershipUpdated", () => {
      fetchProfile();
    });

    return () => {
      listener.subscription.unsubscribe();
      membershipSub.remove();
    };
  }, []);

  // Fetch profile when coming into focus
  useFocusEffect(
    useCallback(() => {
      if (session) {
        setLoading(true);
        fetchProfile();
      }
    }, [session])
  );

  // Handle Stripe success redirect
  useEffect(() => {
    if (success && session) {
      Toast.show({
        type: "success",
        text1: "Membership Updated",
        text2: "Thank you for upgrading!",
        position: "top",
      });
      fetchProfile();
    }
  }, [success, session]);

  const fetchProfile = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const sessionUser = data.session?.user;
      if (!sessionUser) throw new Error("No active session");

      const res = await fetch(`${API_URL}/membership/profile/${sessionUser.id}`);
      if (!res.ok) throw new Error("Unable to load membership info.");

      const membershipData = await res.json();
      setUser({
        id: sessionUser.id,
        email: sessionUser.email,
        membership_tiers: membershipData.membership_tiers,
      });
    } catch (err: any) {
      console.error("Profile fetch error:", err);
      // Only show toast if it's not a "No active session" error which might happen on logout/switch
      if (err.message !== "No active session") {
        Toast.show({
          type: "error",
          text1: "Failed to load profile",
          text2: err.message,
          position: "top",
        });
      }
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

  const handleDeleteAccount = async () => {
    Alert.alert(
      "Are you sure?",
      "Deleting your account will permanently remove your alerts and profile.\n\nImportant: This will NOT automatically cancel your active subscription. You must manage your subscription in your iPhone Subscription Settings.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              const { data: { session } } = await supabase.auth.getSession();
              if (!session) return;

              const res = await fetch(`${API_URL}/auth/delete`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                },
              });

              if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Failed to delete account");
              }

              // Sign out locally
              await supabase.auth.signOut();
              Toast.show({
                type: "success",
                text1: "Account Deleted",
                position: "top",
              });
              router.replace("/(auth)/sign-in");
            } catch (err: any) {
              Alert.alert("Error", err.message);
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  // -------------------------------------------------------
  // 🟥 If NOT logged in → Show GUEST VIEW
  // -------------------------------------------------------
  if (!session) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <Text variant="headlineMedium" style={{ fontWeight: "700", color: theme.colors.onBackground }}>
            Profile
          </Text>
        </View>

        <View style={styles.guestContainer}>
          <Surface style={{ backgroundColor: "transparent", borderRadius: 24 }} elevation={0}>
            <View style={[styles.guestCard, { backgroundColor: "transparent" }]}>

              <View style={[styles.iconCircle, { backgroundColor: theme.colors.primary + "15" }]}>
                <MaterialCommunityIcons name="account-circle-outline" size={48} color={theme.colors.primary} />
              </View>

              <Text variant="titleLarge" style={{ fontWeight: "700", color: theme.colors.onSurface, marginBottom: 8 }}>
                Welcome to TeeSignal
              </Text>

              <Text variant="bodyMedium" style={{ textAlign: "center", color: theme.colors.onSurfaceVariant, marginBottom: 32, paddingHorizontal: 16 }}>
                Sign in to manage your membership, view your subscription details, and configure your alerts.
              </Text>

              <OAuthSection
                loading={loading}
                setLoading={setLoading}
                setError={(err) => {
                  if (err) {
                    Toast.show({
                      type: "error",
                      text1: "Sign-In Error",
                      text2: err,
                      position: "top",
                    });
                  }
                }}
                onSuccess={() => {
                  fetchProfile();
                }}
                showSeparator={true}
              />

              <Button
                mode="text"
                onPress={() => router.push("/(auth)/sign-in")}
                style={{ width: "100%", marginTop: 8 }}
                labelStyle={{ fontWeight: "600", color: theme.colors.primary }}
              >
                Continue with Email
              </Button>

              <View style={{ marginTop: 32, width: '100%' }}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => router.push("/(auth)/sign-up?redirectTo=/upgrade")}
                >
                  <LinearGradient
                    colors={Colors.light.gradients.primary as [string, string, ...string[]]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.promoBanner}
                  >
                    <View style={styles.promoContent}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.promoTextBold}>Free 14-Day Trial</Text>
                        <Text style={styles.promoSubtext}>Get Pro features free. No credit card required.</Text>
                      </View>
                      <MaterialCommunityIcons name="chevron-right" size={24} color="#FFF" />
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </Surface>


          <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 24, gap: 16 }}>
            <TouchableOpacity onPress={() => Linking.openURL("https://abodell.github.io/tee-time-notifier/privacy.html")}>
              <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: "600" }}>Privacy Policy</Text>
            </TouchableOpacity>
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 12, opacity: 0.5 }}>•</Text>
            <TouchableOpacity onPress={() => Linking.openURL("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")}>
              <Text style={{ color: theme.colors.primary, fontSize: 12, fontWeight: "600" }}>Terms of Use</Text>
            </TouchableOpacity>
          </View>

          <Text style={{ textAlign: "center", color: theme.colors.onSurfaceVariant, marginTop: 16, opacity: 0.5, fontSize: 12 }}>
            TeeSignal v1.0.4
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------
  // -------------------------------------------------------
  // 🟩 If logged in → Normal PROFILE UI
  // -------------------------------------------------------
  // Removed full screen loading to show Skeleton instead

  const tier = user?.membership_tiers;
  const price =
    tier?.price_cents && tier.price_cents > 0
      ? `$${(tier.price_cents / 100).toFixed(2)}/mo`
      : "Free";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top']}>
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
              {loading ? (
                <Skeleton colorMode={theme.dark ? "dark" : "light"} width={120} height={20} />
              ) : (
                <Text variant="titleMedium" style={{ fontWeight: "600", color: theme.colors.onSurface }}>
                  {tier?.name}
                </Text>
              )}
              <View style={{ marginTop: 4 }}>
                {loading ? (
                  <Skeleton colorMode={theme.dark ? "dark" : "light"} width={180} height={16} />
                ) : (
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {price} {tier?.max_alerts ? `• ${tier.max_alerts} Active Alerts` : ""}
                  </Text>
                )}
              </View>
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
            {loading ? (
              <Skeleton colorMode={theme.dark ? "dark" : "light"} width={100} height={20} />
            ) : (
              <Text style={{ color: theme.colors.onSurface, fontWeight: "500" }}>
                {tier?.scan_interval_seconds ? `Every ${tier.scan_interval_seconds / 60} mins` : ""}
              </Text>
            )}
          </View>
        </View>

        {/* Account Section */}
        <Text style={[styles.sectionTitle, { color: theme.colors.onSurfaceVariant, marginTop: 24 }]}>ACCOUNT</Text>
        <View style={[styles.sectionContainer, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.row}>
            <Text style={{ color: theme.colors.onSurface, fontSize: 16 }}>Email</Text>
            {loading ? (
              <Skeleton colorMode={theme.dark ? "dark" : "light"} width={180} height={20} />
            ) : (
              <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 16 }}>{user?.email}</Text>
            )}
          </View>

          <View style={[styles.separator, { backgroundColor: theme.colors.outline }]} />

          <TouchableOpacity style={styles.row} onPress={handleLogout}>
            <Text style={{ color: theme.colors.error, fontSize: 16, fontWeight: "500" }}>Log Out</Text>
            <MaterialCommunityIcons name="logout" size={20} color={theme.colors.error} />
          </TouchableOpacity>

          <View style={[styles.separator, { backgroundColor: theme.colors.outline }]} />

          <TouchableOpacity style={styles.row} onPress={handleDeleteAccount}>
            <Text style={{ color: theme.colors.error, fontSize: 16, fontWeight: "700" }}>Delete Account</Text>
            <MaterialCommunityIcons name="delete-forever" size={20} color={theme.colors.error} />
          </TouchableOpacity>
        </View>

        {/* Legal Section */}
        <Text style={[styles.sectionTitle, { color: theme.colors.onSurfaceVariant, marginTop: 24 }]}>LEGAL</Text>
        <View style={[styles.sectionContainer, { backgroundColor: theme.colors.surface }]}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => Linking.openURL("https://abodell.github.io/tee-time-notifier/privacy.html")}
          >
            <Text style={{ color: theme.colors.onSurface, fontSize: 16 }}>Privacy Policy</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
          </TouchableOpacity>

          <View style={[styles.separator, { backgroundColor: theme.colors.outline }]} />

          <TouchableOpacity
            style={styles.row}
            onPress={() => Linking.openURL("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")}
          >
            <Text style={{ color: theme.colors.onSurface, fontSize: 16 }}>Terms of Use (EULA)</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
          </TouchableOpacity>
        </View>

        <Text style={{ textAlign: "center", color: theme.colors.onSurfaceVariant, marginTop: 32, opacity: 0.5, fontSize: 12 }}>
          TeeSignal v1.0.4
        </Text>
      </ScrollView>
    </SafeAreaView>
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

  guestContainer: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  guestCard: {
    padding: 32,
    borderRadius: 24,
    alignItems: "center",
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  promoBanner: {
    borderRadius: 12,
    overflow: "hidden",
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: "#2F80ED",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  promoContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  promoTextBold: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "800",
  },
  promoSubtext: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 13,
    marginTop: 1,
    fontWeight: "500",
  },
});