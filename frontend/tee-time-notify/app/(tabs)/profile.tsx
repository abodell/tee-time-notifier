import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  TouchableOpacity,
  DeviceEventEmitter,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Text,
  useTheme,
  ActivityIndicator,
} from "react-native-paper";
import { supabase } from "../../lib/supabase";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import Toast from "react-native-toast-message";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Skeleton } from "moti/skeleton";
import * as Linking from "expo-linking";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";
import { Image } from "react-native";
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
  const isDark = theme.dark;
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

  useFocusEffect(
    useCallback(() => {
      if (session) {
        fetchProfile();
      }
    }, [session])
  );

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
          },
        },
      ]
    );
  };

  // ── Guest view ──────────────────────────────────────────────────────
  if (!session) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: theme.colors.background }]}
        edges={["top"]}
      >
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: theme.colors.onBackground }]}>
            Profile
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.guestScroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Icon */}
          <LinearGradient
            colors={
              isDark
                ? (Colors.dark.gradients.primary as [string, string])
                : (Colors.light.gradients.primary as [string, string])
            }
            style={styles.guestIconWrap}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <MaterialCommunityIcons name="golf" size={36} color="#fff" />
          </LinearGradient>

          <Text style={[styles.guestHeading, { color: theme.colors.onSurface }]}>
            Welcome to TeeSignal
          </Text>
          <Text style={[styles.guestSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Sign in to manage your alerts, membership, and account settings.
          </Text>

          {/* OAuth */}
          <View style={styles.guestAuthWrap}>
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

            <TouchableOpacity
              onPress={() => router.push("/(auth)/sign-in")}
              style={[
                styles.emailBtn,
                {
                  borderColor: isDark
                    ? "rgba(255,255,255,0.12)"
                    : "rgba(0,0,0,0.10)",
                },
              ]}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="email-outline"
                size={18}
                color={theme.colors.onSurfaceVariant}
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.emailBtnText, { color: theme.colors.onSurface }]}>
                Continue with Email
              </Text>
            </TouchableOpacity>
          </View>

          {/* Promo banner */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push("/(auth)/sign-up?redirectTo=/upgrade")}
            style={styles.promoWrap}
          >
            <LinearGradient
              colors={
                isDark
                  ? ["#14532D", "#166534", "#15803d"]
                  : ["#15803d", "#16a34a", "#22c55e"]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.promoBanner}
            >
              <View style={styles.promoOrb} />
              <View style={styles.promoOrb2} />
              <View style={styles.promoInner}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.promoEyebrow}>PRO TRIAL</Text>
                  <Text style={styles.promoHeadline}>14 Days Free</Text>
                  <Text style={styles.promoSub}>No credit card required</Text>
                </View>
                <View style={styles.promoChevron}>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={18}
                    color={isDark ? "#166534" : "#15803d"}
                  />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* Legal links */}
          <View style={styles.legalRow}>
            <TouchableOpacity
              onPress={() =>
                Linking.openURL("https://abodell.github.io/tee-time-notifier/privacy.html")
              }
            >
              <Text style={[styles.legalLink, { color: theme.colors.primary }]}>
                Privacy Policy
              </Text>
            </TouchableOpacity>
            <Text style={[styles.legalDot, { color: theme.colors.onSurfaceVariant }]}>
              ·
            </Text>
            <TouchableOpacity
              onPress={() =>
                Linking.openURL(
                  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
                )
              }
            >
              <Text style={[styles.legalLink, { color: theme.colors.primary }]}>
                Terms of Use
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.versionLabel, { color: theme.colors.onSurfaceVariant }]}>
            TeeSignal v1.0.8
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Logged-in view ──────────────────────────────────────────────────
  const tier = user?.membership_tiers;
  const price =
    tier?.price_cents && tier.price_cents > 0
      ? `$${(tier.price_cents / 100).toFixed(2)}/mo`
      : "Free";
  const isPro = tier?.name === "Pro";

  const cardStyle = {
    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#fff",
    borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)",
    shadowColor: isDark ? "transparent" : "#000",
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      edges={["top"]}
    >
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.colors.onBackground }]}>
          Profile
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Membership ── */}
        <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>
          MEMBERSHIP
        </Text>
        <View style={[styles.card, cardStyle]}>
          {/* Tier row */}
          <View style={styles.membershipTopRow}>
            <Image
              source={require("../../assets/images/icon.png")}
              style={styles.tierIconWrap}
              resizeMode="cover"
            />
            <View style={{ flex: 1, marginLeft: 12 }}>
              {loading ? (
                <Skeleton colorMode={isDark ? "dark" : "light"} width={100} height={18} />
              ) : (
                <Text style={[styles.tierName, { color: theme.colors.onSurface }]}>
                  {tier?.name || "—"}
                </Text>
              )}
              <View style={{ marginTop: 3 }}>
                {loading ? (
                  <Skeleton
                    colorMode={isDark ? "dark" : "light"}
                    width={150}
                    height={14}
                  />
                ) : (
                  <Text style={[styles.tierMeta, { color: theme.colors.onSurfaceVariant }]}>
                    {price}
                    {tier?.max_alerts ? `  ·  ${tier.max_alerts} alerts` : ""}
                  </Text>
                )}
              </View>
            </View>
            <TouchableOpacity
              onPress={() => router.push("/upgrade")}
              style={styles.manageBtn}
              activeOpacity={0.6}
            >
              <Text style={[styles.manageBtnText, { color: theme.colors.primary }]}>
                Manage
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.divider, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }]} />

          {/* Scan interval row */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <MaterialCommunityIcons
                name="radar"
                size={16}
                color={theme.colors.primary}
                style={{ marginRight: 10 }}
              />
              <Text style={[styles.rowLabel, { color: theme.colors.onSurfaceVariant }]}>
                Scan interval
              </Text>
            </View>
            {loading ? (
              <Skeleton colorMode={isDark ? "dark" : "light"} width={90} height={16} />
            ) : (
              <Text style={[styles.rowValue, { color: theme.colors.onSurface }]}>
                {tier?.scan_interval_seconds
                  ? `Every ${tier.scan_interval_seconds / 60} min`
                  : "—"}
              </Text>
            )}
          </View>
        </View>

        {/* ── Account ── */}
        <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant, marginTop: 28 }]}>
          ACCOUNT
        </Text>
        <View style={[styles.card, cardStyle]}>
          {/* Email row */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <MaterialCommunityIcons
                name="email-outline"
                size={16}
                color={theme.colors.onSurfaceVariant}
                style={{ marginRight: 10, opacity: 0.7 }}
              />
              <Text style={[styles.rowLabel, { color: theme.colors.onSurfaceVariant }]}>
                Email
              </Text>
            </View>
            {loading ? (
              <Skeleton colorMode={isDark ? "dark" : "light"} width={160} height={16} />
            ) : (
              <Text
                style={[styles.rowValue, { color: theme.colors.onSurface }]}
                numberOfLines={1}
              >
                {user?.email}
              </Text>
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }]} />

          {/* Log out row */}
          <TouchableOpacity style={styles.row} onPress={handleLogout} activeOpacity={0.7}>
            <View style={styles.rowLeft}>
              <MaterialCommunityIcons
                name="logout"
                size={16}
                color={theme.colors.error}
                style={{ marginRight: 10 }}
              />
              <Text style={[styles.rowActionLabel, { color: theme.colors.error }]}>
                Log Out
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={18}
              color={theme.colors.error}
              style={{ opacity: 0.45 }}
            />
          </TouchableOpacity>
        </View>

        {/* ── Danger zone ── */}
        <Text
          style={[
            styles.sectionLabel,
            { color: theme.colors.error + "99", marginTop: 28 },
          ]}
        >
          DANGER ZONE
        </Text>
        <View
          style={[
            styles.card,
            {
              backgroundColor: isDark
                ? "rgba(255,59,48,0.08)"
                : "rgba(255,59,48,0.04)",
              borderColor: isDark
                ? "rgba(255,59,48,0.18)"
                : "rgba(255,59,48,0.12)",
              shadowColor: "transparent",
            },
          ]}
        >
          <TouchableOpacity
            style={styles.row}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <MaterialCommunityIcons
                name="delete-forever-outline"
                size={16}
                color={theme.colors.error}
                style={{ marginRight: 10 }}
              />
              <Text style={[styles.rowActionLabel, { color: theme.colors.error }]}>
                Delete Account
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={18}
              color={theme.colors.error}
              style={{ opacity: 0.45 }}
            />
          </TouchableOpacity>
        </View>

        {/* ── Legal ── */}
        <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant, marginTop: 28 }]}>
          LEGAL
        </Text>
        <View style={[styles.card, cardStyle]}>
          <TouchableOpacity
            style={styles.row}
            onPress={() =>
              Linking.openURL("https://abodell.github.io/tee-time-notifier/privacy.html")
            }
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <MaterialCommunityIcons
                name="shield-check-outline"
                size={16}
                color={theme.colors.onSurfaceVariant}
                style={{ marginRight: 10, opacity: 0.7 }}
              />
              <Text style={[styles.rowLabel, { color: theme.colors.onSurface }]}>
                Privacy Policy
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={18}
              color={theme.colors.onSurfaceVariant}
              style={{ opacity: 0.35 }}
            />
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" }]} />

          <TouchableOpacity
            style={styles.row}
            onPress={() =>
              Linking.openURL(
                "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
              )
            }
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <MaterialCommunityIcons
                name="file-document-outline"
                size={16}
                color={theme.colors.onSurfaceVariant}
                style={{ marginRight: 10, opacity: 0.7 }}
              />
              <Text style={[styles.rowLabel, { color: theme.colors.onSurface }]}>
                Terms of Use (EULA)
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={18}
              color={theme.colors.onSurfaceVariant}
              style={{ opacity: 0.35 }}
            />
          </TouchableOpacity>
        </View>

        <Text style={[styles.versionLabel, { color: theme.colors.onSurfaceVariant, marginTop: 32 }]}>
          TeeSignal v1.0.8
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
    lineHeight: 36,
  },

  // ── Logged-in ──
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },

  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    marginBottom: 8,
    marginLeft: 4,
  },

  card: {
    borderRadius: 18,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    overflow: "hidden",
  },

  // Membership card header
  membershipTopRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  tierIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  tierName: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  tierMeta: {
    fontSize: 12,
    fontWeight: "400",
  },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 8,
  },
  manageBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    justifyContent: "space-between",
    minHeight: 52,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "400",
  },
  rowActionLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  rowValue: {
    fontSize: 15,
    fontWeight: "400",
    maxWidth: 180,
    textAlign: "right",
  },

  // ── Guest ──
  guestScroll: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 12,
  },
  guestIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  guestHeading: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.6,
    textAlign: "center",
    lineHeight: 32,
    marginBottom: 10,
  },
  guestSubtitle: {
    fontSize: 14,
    fontWeight: "400",
    textAlign: "center",
    lineHeight: 21,
    maxWidth: 280,
    marginBottom: 32,
  },
  guestAuthWrap: {
    width: "100%",
    marginBottom: 24,
  },
  emailBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
  },
  emailBtnText: {
    fontSize: 15,
    fontWeight: "600",
  },

  // Promo banner (guest)
  promoWrap: { width: "100%", marginBottom: 28 },
  promoBanner: {
    borderRadius: 18,
    overflow: "hidden",
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  promoOrb: {
    position: "absolute",
    right: -25,
    top: -35,
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  promoOrb2: {
    position: "absolute",
    right: 50,
    bottom: -45,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  promoInner: {
    flexDirection: "row",
    alignItems: "center",
  },
  promoEyebrow: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  promoHeadline: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.6,
    lineHeight: 26,
  },
  promoSub: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "500",
    marginTop: 4,
  },
  promoChevron: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.95)",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 16,
  },

  // Legal & version
  legalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginBottom: 14,
  },
  legalLink: {
    fontSize: 12,
    fontWeight: "600",
  },
  legalDot: {
    fontSize: 12,
    opacity: 0.4,
  },
  versionLabel: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "400",
    opacity: 0.45,
    marginBottom: 8,
  },
});
