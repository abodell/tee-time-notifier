import React, { useEffect, useState } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Platform,
  DeviceEventEmitter,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  Text,
  useTheme,
  ActivityIndicator,
} from "react-native-paper";
import { supabase } from "@/lib/supabase";
import Toast from "react-native-toast-message";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { MembershipTier, UserProfileResponse } from "@/types/membership";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

const FEATURE_ICONS: Record<string, string> = {
  alerts: "bell-outline",
  scan: "radar",
  group: "account-group-outline",
  recurring: "refresh-auto",
};

export default function UpgradeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const isDark = theme.dark;
  const [loading, setLoading] = useState(true);
  const [redirectingTier, setRedirectingTier] = useState<number | null>(null);
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [userTier, setUserTier] = useState<number | null>(null);
  const [pendingDowngrade, setPendingDowngrade] = useState(false);
  const [cancelAt, setCancelAt] = useState<string | null>(null);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [session, setSession] = useState<any>(null);

  const cardBg = isDark ? "rgba(255,255,255,0.06)" : "#fff";
  const cardBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const accent = theme.colors.primary;
  const gradColors = isDark
    ? (Colors.dark.gradients.primary as [string, string])
    : (Colors.light.gradients.primary as [string, string]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const fetchTasks: Promise<any>[] = [fetch(`${API_URL}/membership/tiers`)];
      if (user) {
        fetchTasks.push(fetch(`${API_URL}/membership/profile/${user.id}`));
      }

      const results = await Promise.all(fetchTasks);
      const tiersRes = results[0];
      const profileRes = user ? results[1] : null;

      if (!tiersRes.ok || (profileRes && !profileRes.ok))
        throw new Error("Failed to fetch info");

      const tierList: MembershipTier[] = await tiersRes.json();
      setTiers(tierList);

      if (profileRes) {
        const profileData: UserProfileResponse = await profileRes.json();
        setUserTier(profileData.membership_tier_id);
        setPendingDowngrade(profileData.pending_downgrade || false);
        setCancelAt(profileData.cancel_at || null);
      }

      try {
        const offerings = await Purchases.getOfferings();

        if (offerings.current && offerings.current.availablePackages.length > 0) {
          setPackages(offerings.current.availablePackages);
        } else {
          const productIds = tierList
            .map(t => t.revenuecat_entitlement_id)
            .filter((id): id is string => !!id);

          if (productIds.length > 0) {
            const products = await Purchases.getProducts(productIds);
            const syntheticPackages: any[] = products.map(product => ({
              identifier: product.identifier,
              packageType: "CUSTOM",
              product: product,
              offeringIdentifier: "fallback"
            }));
            setPackages(syntheticPackages);
          }
        }
      } catch (e) {
        console.log("Error fetching offerings/products", e);
      }

    } catch (err: any) {
      Toast.show({
        type: "error",
        text1: "Failed to load plans",
        text2: err.message,
        position: "top",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = async (tier: MembershipTier) => {
    try {
      if (tier.id === userTier) {
        Toast.show({
          type: "info",
          text1: "You're already on this plan",
          position: "top",
        });
        return;
      }

      if (tier.price_cents === 0 && userTier && userTier !== 1) {
        Alert.alert(
          "Manage Subscription",
          "To cancel or downgrade your plan, please manage your subscription in your device settings.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: async () => {
                if (Platform.OS === "ios") {
                  Linking.openURL("https://apps.apple.com/account/subscriptions");
                } else {
                  Linking.openURL("https://play.google.com/store/account/subscriptions");
                }
              }
            }
          ]
        );
        return;
      }

      setRedirectingTier(tier.id);

      const packageToBuy = packages.find(
        (pkg) => pkg.product.identifier === tier.revenuecat_entitlement_id || pkg.identifier === tier.revenuecat_entitlement_id
      );

      if (!packageToBuy) {
        throw new Error("Product not found in store. Please try again later.");
      }

      const { customerInfo } = await Purchases.purchasePackage(packageToBuy);

      if (customerInfo.entitlements.active[tier.revenuecat_entitlement_id || ""]) {
        Toast.show({
          type: "success",
          text1: "Upgrade Successful",
          text2: "Your plan has been updated.",
          position: "top",
        });
        DeviceEventEmitter.emit("membershipUpdated");
        loadData();
      }

    } catch (err: any) {
      if (!err.userCancelled) {
        Toast.show({
          type: "error",
          text1: "Purchase Failed",
          text2: err.message,
          position: "top",
        });
      }
    } finally {
      setRedirectingTier(null);
    }
  };

  const handleRestorePurchases = async () => {
    try {
      setLoading(true);
      const customerInfo = await Purchases.restorePurchases();
      if (Object.keys(customerInfo.entitlements.active).length > 0) {
        Toast.show({
          type: "success",
          text1: "Purchases Restored",
          text2: "Your subscription has been restored.",
          position: "top",
        });
        DeviceEventEmitter.emit("membershipUpdated");
        loadData();
      } else {
        Toast.show({
          type: "info",
          text1: "No Active Subscriptions",
          text2: "We didn't find any active subscriptions to restore.",
          position: "top",
        });
      }
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Restore Failed",
        text2: e.message,
        position: "top",
      });
    } finally {
      setLoading(false);
    }
  };

  const toPriceText = (cents?: number) =>
    !cents || cents === 0 ? "$0.00" : `$${(cents / 100).toFixed(2)}`;

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Nav row ── */}
        <View style={styles.navRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.75}
            style={[
              styles.backBtn,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(0,0,0,0.05)",
                borderColor: cardBorder,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={18}
              color={theme.colors.onSurface}
            />
          </TouchableOpacity>
          <Text style={[styles.navTitle, { color: theme.colors.onSurface }]}>
            Manage Plan
          </Text>
          <View style={styles.navSpacer} />
        </View>

        {/* ── Hero ── */}
        <Animated.View entering={FadeInDown.duration(400).delay(60)} style={styles.hero}>
          <MaterialCommunityIcons
            name="crown"
            size={36}
            color={accent}
            style={{ marginBottom: 14 }}
          />
          <Text style={[styles.heroTitle, { color: theme.colors.onSurface }]}>
            Upgrade Your Game
          </Text>
          <Text style={[styles.heroSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Unlock faster scans and more alerts to never miss a tee time.
          </Text>
        </Animated.View>

        {/* ── Tier cards ── */}
        {tiers.map((tier, idx) => {
          const isCurrent = tier.id === userTier;
          const isRedirecting = redirectingTier === tier.id;
          const isFree = tier.price_cents === 0;
          const isPro = tier.name === "Pro";

          const rcPackage = packages.find(
            (pkg) =>
              pkg.product.identifier === tier.revenuecat_entitlement_id ||
              pkg.product.identifier === tier.revenuecat_entitlement_id
          );

          const priceDisplay = rcPackage
            ? rcPackage.product.priceString
            : toPriceText(tier.price_cents);

          const isUnavailable = !isFree && !isCurrent && !rcPackage;
          const hasTrial = !!rcPackage?.product?.introPrice;

          return (
            <Animated.View
              key={tier.id}
              entering={FadeInDown.duration(400).delay(120 + idx * 80)}
            >
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: isCurrent
                      ? isDark ? "rgba(255,255,255,0.08)" : "#fff"
                      : cardBg,
                    borderColor: isCurrent ? accent : cardBorder,
                    borderWidth: isCurrent ? 2 : 1,
                    shadowColor: isDark ? "transparent" : "#000",
                  },
                ]}
              >
                {/* Card header */}
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Text style={[styles.tierName, { color: theme.colors.onSurface }]}>
                        {isFree ? "Free" : tier.name}
                      </Text>
                      {isCurrent && (
                        <View style={[styles.currentBadge, { backgroundColor: `${accent}20` }]}>
                          <Text style={[styles.currentBadgeText, { color: accent }]}>
                            Current
                          </Text>
                        </View>
                      )}
                      {isPro && !isCurrent && hasTrial && (
                        <View style={[styles.trialBadge, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "#F0FDF4" }]}>
                          <Text style={[styles.trialBadgeText, { color: accent }]}>
                            14-Day Trial
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Price */}
                    <View style={{ flexDirection: "row", alignItems: "baseline", marginTop: 8, gap: 3 }}>
                      <Text style={[styles.priceText, { color: isCurrent ? accent : theme.colors.onSurface }]}>
                        {isFree ? "Free" : priceDisplay}
                      </Text>
                      {!isFree && (
                        <Text style={[styles.pricePeriod, { color: theme.colors.onSurfaceVariant }]}>
                          /mo
                        </Text>
                      )}
                    </View>

                    {!isFree && hasTrial && (
                      <Text style={[styles.trialNote, { color: theme.colors.onSurfaceVariant }]}>
                        After 14 days, you'll be charged {priceDisplay}/mo
                      </Text>
                    )}
                    {!isFree && !hasTrial && (
                      <Text style={[styles.trialNote, { color: theme.colors.onSurfaceVariant }]}>
                        Auto-renewable, billed monthly
                      </Text>
                    )}
                  </View>
                </View>

                {/* Divider */}
                <View style={[styles.divider, {
                  backgroundColor: isCurrent
                    ? `${accent}20`
                    : isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                  marginHorizontal: 0,
                }]} />

                {/* Description */}
                {tier.description ? (
                  <Text style={[styles.tierDesc, { color: theme.colors.onSurfaceVariant }]}>
                    {tier.description}
                  </Text>
                ) : null}

                {/* Features */}
                <View style={styles.features}>
                  <View style={styles.featureRow}>
                    <View style={[styles.featureIconWrap, { backgroundColor: `${accent}14` }]}>
                      <MaterialCommunityIcons name="bell-outline" size={14} color={accent} />
                    </View>
                    <Text style={[styles.featureText, { color: theme.colors.onSurface }]}>
                      <Text style={{ fontWeight: "700" }}>{tier.max_alerts ?? 3}</Text> active {(tier.max_alerts ?? 3) === 1 ? "alert" : "alerts"}
                    </Text>
                  </View>

                  <View style={styles.featureRow}>
                    <View style={[styles.featureIconWrap, { backgroundColor: `${accent}14` }]}>
                      <MaterialCommunityIcons name="radar" size={14} color={accent} />
                    </View>
                    <Text style={[styles.featureText, { color: theme.colors.onSurface }]}>
                      Refreshes every{" "}
                      <Text style={{ fontWeight: "700" }}>
                        {tier.scan_interval_seconds
                          ? tier.scan_interval_seconds / 60
                          : 10} min
                      </Text>
                    </Text>
                  </View>

                  {tier.name !== "Free" && (
                    <View style={styles.featureRow}>
                      <View style={[styles.featureIconWrap, { backgroundColor: `${accent}14` }]}>
                        <MaterialCommunityIcons name="account-group-outline" size={14} color={accent} />
                      </View>
                      <Text style={[styles.featureText, { color: theme.colors.onSurface }]}>
                        Filter by <Text style={{ fontWeight: "700" }}>group size</Text>
                      </Text>
                    </View>
                  )}

                  {isPro && (
                    <View style={styles.featureRow}>
                      <View style={[styles.featureIconWrap, { backgroundColor: `${accent}14` }]}>
                        <MaterialCommunityIcons name="refresh-auto" size={14} color={accent} />
                      </View>
                      <Text style={[styles.featureText, { color: theme.colors.onSurface }]}>
                        Set <Text style={{ fontWeight: "700" }}>recurring</Text> alerts
                      </Text>
                    </View>
                  )}
                </View>

                {/* CTA — only for authenticated users */}
                {session && (
                  <View style={{ marginTop: 20 }}>
                    {isCurrent ? (
                      <View
                        style={[
                          styles.currentPlanBtn,
                          {
                            borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)",
                            backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name="check-circle-outline"
                          size={16}
                          color={accent}
                          style={{ marginRight: 6 }}
                        />
                        <Text style={[styles.currentPlanText, { color: theme.colors.onSurfaceVariant }]}>
                          {pendingDowngrade && cancelAt && userTier !== 1
                            ? `Ends ${new Date(cancelAt).toLocaleDateString()}`
                            : "Active Plan"}
                        </Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => handleSelectPlan(tier)}
                        disabled={isRedirecting || isUnavailable}
                        activeOpacity={0.82}
                      >
                        <LinearGradient
                          colors={
                            (isRedirecting || isUnavailable
                              ? isDark
                                ? ["rgba(255,255,255,0.08)", "rgba(255,255,255,0.08)"]
                                : ["#E2E8F0", "#E2E8F0"]
                              : gradColors) as [string, string, ...string[]]
                          }
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={[
                            styles.upgradeBtn,
                            { opacity: isRedirecting || isUnavailable ? 0.7 : 1 },
                          ]}
                        >
                          {isRedirecting ? (
                            <ActivityIndicator animating size="small" color="#fff" />
                          ) : (
                            <View style={styles.upgradeBtnInner}>
                              <Text
                                style={[
                                  styles.upgradeBtnText,
                                  {
                                    color: isRedirecting || isUnavailable
                                      ? isDark ? "rgba(255,255,255,0.3)" : "#94A3B8"
                                      : "#fff",
                                  },
                                ]}
                              >
                                {isUnavailable
                                  ? "Unavailable"
                                  : hasTrial
                                    ? "Start 14-Day Free Trial"
                                    : isFree
                                      ? "Downgrade to Free"
                                      : `Switch to ${tier.name}`}
                              </Text>
                              {!isUnavailable && (
                                <MaterialCommunityIcons
                                  name="arrow-right"
                                  size={16}
                                  color={isRedirecting || isUnavailable
                                    ? isDark ? "rgba(255,255,255,0.3)" : "#94A3B8"
                                    : "#fff"}
                                />
                              )}
                            </View>
                          )}
                        </LinearGradient>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </Animated.View>
          );
        })}

        {/* ── Guest CTA ── */}
        {!session && (
          <Animated.View entering={FadeInDown.duration(400).delay(300)} style={{ marginTop: 8, marginBottom: 16 }}>
            <TouchableOpacity
              onPress={() => router.push("/(auth)/sign-up")}
              activeOpacity={0.82}
            >
              <LinearGradient
                colors={gradColors as [string, string, ...string[]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.upgradeBtn}
              >
                <View style={styles.upgradeBtnInner}>
                  <Text style={[styles.upgradeBtnText, { color: "#fff" }]}>
                    Create Your Account
                  </Text>
                  <MaterialCommunityIcons name="arrow-right" size={16} color="#fff" />
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ── Footer ── */}
        <View style={styles.footer}>
          {session && (
            <TouchableOpacity
              onPress={handleRestorePurchases}
              activeOpacity={0.7}
              style={styles.restoreBtn}
            >
              <Text style={[styles.restoreBtnText, { color: theme.colors.onSurfaceVariant }]}>
                Restore Purchases
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.legalLinks}>
            <TouchableOpacity onPress={() => Linking.openURL("https://abodell.github.io/tee-time-notifier/privacy.html")}>
              <Text style={[styles.legalText, { color: accent }]}>Privacy Policy</Text>
            </TouchableOpacity>
            <Text style={[styles.legalDot, { color: theme.colors.onSurfaceVariant }]}> · </Text>
            <TouchableOpacity onPress={() => Linking.openURL("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")}>
              <Text style={[styles.legalText, { color: accent }]}>Terms of Use</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.disclaimer, { color: theme.colors.onSurfaceVariant }]}>
            Payment will be charged to your Apple ID account at the confirmation of purchase.
            Subscription automatically renews unless it is canceled at least 24 hours before the end of the current period.
            Your account will be charged for renewal within 24 hours prior to the end of the current period.
            You can manage and cancel your subscriptions by going to your account settings on the App Store after purchase.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 48,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  // Nav
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  navTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginHorizontal: 8,
  },
  navSpacer: {
    width: 38,
    flexShrink: 0,
  },

  // Hero
  hero: {
    alignItems: "center",
    marginBottom: 28,
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.6,
    textAlign: "center",
    lineHeight: 32,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    fontWeight: "400",
    textAlign: "center",
    lineHeight: 21,
    maxWidth: 280,
  },

  // Tier card
  card: {
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  tierName: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  trialBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  trialBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  priceText: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -1,
  },
  pricePeriod: {
    fontSize: 16,
    fontWeight: "500",
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  freeTagline: {
    fontSize: 13,
    fontWeight: "400",
    marginTop: 8,
    lineHeight: 18,
  },
  trialNote: {
    fontSize: 12,
    fontWeight: "400",
    marginTop: 4,
    lineHeight: 17,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },

  tierDesc: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    marginBottom: 12,
  },

  // Features
  features: {
    gap: 12,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  featureIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  featureText: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
  },

  // CTA buttons
  upgradeBtn: {
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  upgradeBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  upgradeBtnText: {
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: -0.2,
  },
  currentPlanBtn: {
    height: 48,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  currentPlanText: {
    fontSize: 15,
    fontWeight: "600",
  },

  // Footer
  footer: {
    marginTop: 8,
    alignItems: "center",
    paddingHorizontal: 8,
  },
  restoreBtn: {
    paddingVertical: 12,
    marginBottom: 16,
  },
  restoreBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  legalLinks: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  legalText: {
    fontSize: 12,
    fontWeight: "600",
  },
  legalDot: {
    fontSize: 12,
    opacity: 0.4,
  },
  disclaimer: {
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
    opacity: 0.6,
  },
});
