import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  TouchableOpacity,
  DeviceEventEmitter,
  Share,
  TextInput as RNTextInput,
  Platform,
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
import { haptics } from "@/lib/haptics";
import { useProTrialDays } from "@/lib/trial";
import { Image } from "react-native";
import OAuthSection from "@/components/auth/OAuthSection";
import { getMyReferralInfo, redeemReferralCode, pauseAllAlerts, getUserAlerts } from "@/lib/api";
import MuteDurationSheet, { MuteDuration, resolveMuteDuration } from "@/components/MuteDurationSheet";
import dayjs from "dayjs";

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
  is_bonus_active?: boolean;
  bonus_expires_at?: string | null;
}

interface ReferralInfo {
  referral_code: string;
  referred_count: number;
  has_redeemed: boolean;
  reward_days: number;
}

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const isDark = theme.dark;
  const trialDays = useProTrialDays();
  const { success } = useLocalSearchParams();

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);
  const [redeemCodeInput, setRedeemCodeInput] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [pausingAll, setPausingAll] = useState(false);
  const [pauseAllSheetVisible, setPauseAllSheetVisible] = useState(false);
  const [activeAlertsPaused, setActiveAlertsPaused] = useState(false);
  const [activeAlertCount, setActiveAlertCount] = useState(0);

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

    const alertsSub = DeviceEventEmitter.addListener("alertsUpdated", () => {
      supabase.auth.getSession().then(({ data }) => {
        const userId = data.session?.user?.id;
        if (userId) refreshPauseState(userId);
      });
    });

    return () => {
      listener.subscription.unsubscribe();
      membershipSub.remove();
      alertsSub.remove();
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
        is_bonus_active: membershipData.is_bonus_active || false,
        bonus_expires_at: membershipData.bonus_expires_at,
      });

      try {
        const referral = await getMyReferralInfo(sessionUser.id);
        setReferralInfo(referral);
      } catch (err) {
        console.log("Failed to load referral info", err);
      }

      await refreshPauseState(sessionUser.id);
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

  const handleShareCode = async () => {
    if (!referralInfo) return;
    try {
      const rewardLine = isPro
        ? `Use my code ${referralInfo.referral_code} in TeeSignal — you'll get ${referralInfo.reward_days} days of Pro free.`
        : `Use my code ${referralInfo.referral_code} in TeeSignal and we'll both get ${referralInfo.reward_days} days of Pro free.`;
      await Share.share({
        message: `Catching sold-out tee times is a lot easier with a heads up. ${rewardLine}\n\nhttps://apps.apple.com/us/app/tee-signal-tee-time-alerts/id6758684655`,
      });
    } catch (err: any) {
      Toast.show({ type: "error", text1: "Couldn't open share sheet", text2: err.message });
    }
  };

  const handleRedeemCode = async () => {
    if (!user || !redeemCodeInput.trim()) return;
    try {
      setRedeeming(true);
      const result = await redeemReferralCode(user.id, redeemCodeInput.trim());
      Toast.show({ type: "success", text1: "Code redeemed!", text2: result.message, position: "top" });
      setRedeemCodeInput("");
      const referral = await getMyReferralInfo(user.id);
      setReferralInfo(referral);
      DeviceEventEmitter.emit("membershipUpdated");
    } catch (err: any) {
      Toast.show({ type: "error", text1: "Couldn't redeem code", text2: err.message, position: "top" });
    } finally {
      setRedeeming(false);
    }
  };

  /** Active alerts are "paused" once every one of them has a future muted_until. */
  const refreshPauseState = async (userId: string) => {
    try {
      const alerts = await getUserAlerts(userId);
      const active = (alerts || []).filter((a: any) => a.active);
      setActiveAlertCount(active.length);
      setActiveAlertsPaused(
        active.length > 0 && active.every((a: any) => a.muted_until && dayjs(a.muted_until).isAfter(dayjs()))
      );
    } catch (err) {
      console.log("Failed to load alert pause state", err);
    }
  };

  const handlePauseAll = async (duration: MuteDuration) => {
    if (!user) return;
    setPauseAllSheetVisible(false);
    if (activeAlertCount === 0) {
      Toast.show({
        type: "info",
        text1: "Nothing to pause",
        text2: "You don't have any active alerts right now.",
        position: "top",
      });
      return;
    }
    try {
      setPausingAll(true);
      const mutedUntil = resolveMuteDuration(duration);
      const result = await pauseAllAlerts(user.id, mutedUntil);
      Toast.show({
        type: "success",
        text1: "Alerts paused",
        text2: `${result.paused_count} alert${result.paused_count === 1 ? "" : "s"} silenced`,
        position: "top",
      });
      await refreshPauseState(user.id);
    } catch (err: any) {
      Toast.show({ type: "error", text1: "Couldn't pause alerts", text2: err.message, position: "top" });
    } finally {
      setPausingAll(false);
    }
  };

  const handleResumeAll = async () => {
    if (!user) return;
    try {
      setPausingAll(true);
      const result = await pauseAllAlerts(user.id, null);
      Toast.show({
        type: "success",
        text1: "Alerts resumed",
        text2: `${result.paused_count} alert${result.paused_count === 1 ? "" : "s"} resumed`,
        position: "top",
      });
      await refreshPauseState(user.id);
    } catch (err: any) {
      Toast.show({ type: "error", text1: "Couldn't resume alerts", text2: err.message, position: "top" });
    } finally {
      setPausingAll(false);
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
              haptics.warning();
              Toast.show({
                type: "success",
                text1: "Account Deleted",
                position: "top",
              });
              router.replace("/(auth)/sign-in");
            } catch (err: any) {
              haptics.error();
              Alert.alert("Error", err.message);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  // ── Initial session check ──────────────────────────────────────────
  // Without this gate, the guest view flashes for a frame before getSession()
  // resolves even when the user is actually logged in.
  if (loading && !session) {
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: theme.colors.background }]}
        edges={["top"]}
      >
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

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
                  <Text style={styles.promoHeadline}>{trialDays} Days Free</Text>
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
            TeeSignal v1.0.9
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Logged-in view ──────────────────────────────────────────────────
  const tier = user?.membership_tiers;
  const isBonusActive = !!user?.is_bonus_active;
  const bonusExpiryLabel = user?.bonus_expires_at
    ? dayjs(user.bonus_expires_at).format("MMM D")
    : null;
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
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={[styles.tierName, { color: theme.colors.onSurface }]}>
                    {tier?.name || "—"}
                  </Text>
                  {isBonusActive && (
                    <View
                      style={[
                        styles.bonusBadge,
                        {
                          backgroundColor: isDark ? "rgba(74,222,128,0.16)" : "rgba(22,163,74,0.1)",
                          borderColor: isDark ? "rgba(74,222,128,0.35)" : "rgba(22,163,74,0.25)",
                        },
                      ]}
                    >
                      <Text style={[styles.bonusBadgeText, { color: isDark ? "#4ADE80" : "#15803D" }]}>
                        Weekend Pass
                      </Text>
                    </View>
                  )}
                </View>
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
                    {isBonusActive
                      ? bonusExpiryLabel
                        ? `Expires ${bonusExpiryLabel}`
                        : "Temporary access"
                      : price}
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

        {/* ── Invite friends ── */}
        <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant, marginTop: 28 }]}>
          INVITE FRIENDS
        </Text>
        <View style={[styles.card, cardStyle, { padding: 16 }]}>
          {referralInfo ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View>
                  <Text style={[styles.referralHint, { color: theme.colors.onSurfaceVariant }]}>
                    Your code
                  </Text>
                  <Text style={[styles.referralCode, { color: theme.colors.onSurface }]}>
                    {referralInfo.referral_code}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleShareCode}
                  style={[styles.shareBtn, { backgroundColor: theme.colors.primary }]}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="export-variant" size={14} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.shareBtnText}>Share</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.referralSub, { color: theme.colors.onSurfaceVariant }]}>
                {isPro
                  ? `Your friend gets ${referralInfo.reward_days} days of Pro when they sign up with your code. You're already on Pro, so we bank your ${referralInfo.reward_days} days — they kick in automatically if your plan ever lapses.`
                  : `You and your friend each get ${referralInfo.reward_days} days of Pro when they sign up.`}
                {referralInfo.referred_count > 0
                  ? ` You've referred ${referralInfo.referred_count} friend${referralInfo.referred_count === 1 ? "" : "s"} so far.`
                  : ""}
              </Text>

              {!referralInfo.has_redeemed && (
                <>
                  <View style={[styles.divider, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)", marginVertical: 14 }]} />
                  <Text style={[styles.referralHint, { color: theme.colors.onSurfaceVariant, marginBottom: 8 }]}>
                    Have a friend's code?
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <RNTextInput
                      value={redeemCodeInput}
                      onChangeText={(t) => setRedeemCodeInput(t.toUpperCase())}
                      placeholder="Enter code"
                      placeholderTextColor={theme.colors.onSurfaceVariant}
                      autoCapitalize="characters"
                      style={[
                        styles.redeemInput,
                        {
                          color: theme.colors.onSurface,
                          borderColor: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)",
                        },
                      ]}
                    />
                    <TouchableOpacity
                      onPress={handleRedeemCode}
                      disabled={redeeming || !redeemCodeInput.trim()}
                      style={[
                        styles.redeemBtn,
                        {
                          backgroundColor: theme.colors.primary,
                          opacity: redeeming || !redeemCodeInput.trim() ? 0.5 : 1,
                        },
                      ]}
                      activeOpacity={0.85}
                    >
                      {redeeming ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.shareBtnText}>Apply</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </>
          ) : (
            <Skeleton colorMode={isDark ? "dark" : "light"} width="100%" height={60} />
          )}
        </View>

        {/* ── Notifications ── */}
        <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant, marginTop: 28 }]}>
          NOTIFICATIONS
        </Text>
        <View style={[styles.card, cardStyle]}>
          {activeAlertsPaused ? (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              disabled={pausingAll}
              onPress={() => handleResumeAll()}
            >
              <View style={styles.rowLeft}>
                <MaterialCommunityIcons
                  name="play-circle-outline"
                  size={16}
                  color={theme.colors.primary}
                  style={{ marginRight: 10 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: theme.colors.primary, fontWeight: "700" }]}>
                    All alerts paused
                  </Text>
                  <Text style={[styles.rowSubLabel, { color: theme.colors.onSurfaceVariant }]}>
                    Tap to start getting notified again.
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.row, activeAlertCount === 0 && { opacity: 0.45 }]}
              activeOpacity={activeAlertCount === 0 ? 1 : 0.7}
              disabled={pausingAll || activeAlertCount === 0}
              onPress={() => setPauseAllSheetVisible(true)}
            >
              <View style={styles.rowLeft}>
                <MaterialCommunityIcons
                  name="pause-circle-outline"
                  size={16}
                  color={theme.colors.onSurfaceVariant}
                  style={{ marginRight: 10, opacity: 0.7 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: theme.colors.onSurface }]}>
                    Don't need alerts for a few days?
                  </Text>
                  <Text style={[styles.rowSubLabel, { color: theme.colors.onSurfaceVariant }]}>
                    {activeAlertCount === 0
                      ? "You don't have any active alerts to pause right now."
                      : "Pause everything at once instead of muting each alert."}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
        </View>

        <MuteDurationSheet
          visible={pauseAllSheetVisible}
          onClose={() => setPauseAllSheetVisible(false)}
          onSelect={handlePauseAll}
          title="Pause All Alerts"
          subtitle="Silence every alert at once. You can resume anytime."
        />

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
          TeeSignal v1.0.9
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
  bonusBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  bonusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: -0.1,
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
  referralHint: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  referralCode: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 2,
    marginTop: 2,
  },
  referralSub: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
  },
  shareBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  redeemInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    letterSpacing: 1,
  },
  redeemBtn: {
    paddingHorizontal: 18,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  rowSubLabel: {
    fontSize: 12,
    fontWeight: "400",
    marginTop: 2,
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
