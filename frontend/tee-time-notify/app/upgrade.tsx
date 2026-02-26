import React, { useEffect, useState } from "react";
import { View, ScrollView, StyleSheet, Alert, TouchableOpacity, Platform, DeviceEventEmitter, Animated } from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  Text,
  Button,
  useTheme,
  ActivityIndicator,
  IconButton,
  Surface,
  Divider,
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

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

export default function UpgradeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [redirectingTier, setRedirectingTier] = useState<number | null>(null);
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [userTier, setUserTier] = useState<number | null>(null);
  const [pendingDowngrade, setPendingDowngrade] = useState(false);
  const [cancelAt, setCancelAt] = useState<string | null>(null);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [session, setSession] = useState<any>(null);

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

      // Fetch RevenueCat Offerings or Products
      try {
        const offerings = await Purchases.getOfferings();

        if (offerings.current && offerings.current.availablePackages.length > 0) {
          setPackages(offerings.current.availablePackages);
        } else {
          // Fallback: Fetch products directly using IDs from our DB
          const productIds = tierList
            .map(t => t.revenuecat_entitlement_id)
            .filter((id): id is string => !!id);

          if (productIds.length > 0) {
            const products = await Purchases.getProducts(productIds);

            // Wrap products in synthetic packages to match existing state structure
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

      // 🟡 Downgrade flow: user chooses Free plan
      if (tier.price_cents === 0 && userTier && userTier !== 1) {
        Alert.alert(
          "Manage Subscription",
          "To cancel or downgrade your plan, please manage your subscription in your device settings.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: async () => {
                if (Platform.OS === 'ios') {
                  Linking.openURL('https://apps.apple.com/account/subscriptions');
                } else {
                  Linking.openURL('https://play.google.com/store/account/subscriptions');
                }
              }
            }
          ]
        );
        return;
      }

      // 🟢 Regular upgrade flow (Native IAP)
      setRedirectingTier(tier.id);

      // Find matching package
      const packageToBuy = packages.find(
        (pkg) => pkg.product.identifier === tier.revenuecat_entitlement_id || pkg.identifier === tier.revenuecat_entitlement_id
      );

      if (!packageToBuy) {
        throw new Error("Product not found in store. Please try again later.");
      }

      const { customerInfo } = await Purchases.purchasePackage(packageToBuy);

      // Check if entitlement is active
      if (customerInfo.entitlements.active[tier.revenuecat_entitlement_id || ""]) {
        Toast.show({
          type: "success",
          text1: "Upgrade Successful",
          text2: "Your plan has been updated.",
          position: "top",
        });
        // Refresh profile
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

      // improvements: check if active entitlements exist and sync with DB if needed
      // For now, just show success message as per requirement
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
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <IconButton
            icon="arrow-left"
            size={24}
            onPress={() => router.back()}
            style={styles.backBtn}
            iconColor={theme.colors.primary}
          />
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text
              variant="titleMedium"
              style={{ color: theme.colors.onBackground, fontWeight: "700" }}
            >
              Manage Plan
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.headerContainer}>
          <Text
            variant="headlineSmall"
            style={{
              color: theme.colors.onBackground,
              fontWeight: "800",
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            Upgrade Your Game
          </Text>
          <Text
            style={{
              color: theme.colors.secondary,
              textAlign: "center",
              fontSize: 16,
              paddingHorizontal: 20,
            }}
          >
            Unlock faster scans and more alerts to never miss a tee time.
          </Text>
        </View>

        {/* Membership Cards */}
        {tiers.map((tier) => {
          const isCurrent = tier.id === userTier;
          const isRedirecting = redirectingTier === tier.id;
          const isFree = tier.price_cents === 0;

          // Find matching RevenueCat package
          const rcPackage = packages.find(
            (pkg) =>
              pkg.product.identifier === tier.revenuecat_entitlement_id ||
              pkg.product.identifier === tier.revenuecat_entitlement_id
          );

          // Use RevenueCat price if available, otherwise fallback to DB price
          const priceDisplay = rcPackage
            ? rcPackage.product.priceString
            : toPriceText(tier.price_cents);

          // Disable purchase if not free, not current, and no package found
          const isUnavailable = !isFree && !isCurrent && !rcPackage;

          return (
            <Surface
              key={tier.id}
              style={[
                styles.card,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: isCurrent ? theme.colors.primary : "transparent",
                  borderWidth: isCurrent ? 2 : 0,
                },
              ]}
              elevation={isCurrent ? 4 : 1}
            >
              <View style={styles.cardHeader}>
                <Text
                  variant="titleLarge"
                  style={{
                    color: theme.colors.onSurface,
                    fontWeight: "800",
                  }}
                >
                  {tier.name}
                </Text>
                {isCurrent && (
                  <View style={[styles.badge, { backgroundColor: theme.colors.primaryContainer }]}>
                    <Text style={[styles.badgeText, { color: theme.colors.onPrimaryContainer }]}>
                      Current
                    </Text>
                  </View>
                )}
              </View>

              <Text
                variant="displaySmall"
                style={{
                  color: theme.colors.primary,
                  marginTop: 12,
                  marginBottom: 4,
                  fontWeight: "800",
                  fontSize: 32,
                }}
              >
                {isFree ? "Free" : priceDisplay}
                {!isFree && (
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: theme.colors.onSurfaceVariant,
                      lineHeight: 32,
                    }}
                  >
                    {" /mo"}
                  </Text>
                )}
              </Text>

              {!isFree && (
                <Text style={{ fontSize: 12, color: theme.colors.onSurfaceVariant, marginBottom: 16, fontWeight: "500" }}>
                  Auto-renewable subscription, billed monthly
                </Text>
              )}

              <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 20 }}>
                {tier.description || "Everything you need to find your next tee time."}
              </Text>

              <Divider style={{ marginBottom: 20, opacity: 0.5 }} />

              {/* Features */}
              <View style={styles.features}>
                <View style={styles.featureRow}>
                  <Text style={{ fontSize: 18, marginRight: 12 }}>🔔</Text>
                  <Text style={[styles.featureText, { color: theme.colors.onSurface }]}>
                    <Text style={{ fontWeight: "700" }}>{tier.max_alerts ?? 3}</Text> active alerts
                  </Text>
                </View>

                <View style={styles.featureRow}>
                  <Text style={{ fontSize: 18, marginRight: 12 }}>⚡️</Text>
                  <Text style={[styles.featureText, { color: theme.colors.onSurface }]}>
                    Refreshes every{" "}
                    <Text style={{ fontWeight: "700" }}>
                      {tier.scan_interval_seconds
                        ? tier.scan_interval_seconds / 60
                        : 10}
                      {" min"}
                    </Text>
                  </Text>
                </View>
              </View>

              {/* Action Button - Only show if authenticated */}
              {session && (
                <View style={{ marginTop: 24 }}>
                  {isCurrent ? (
                    <Button
                      mode="outlined"
                      disabled={true}
                      style={{ borderRadius: 12, borderColor: theme.colors.outline }}
                      labelStyle={{ color: theme.colors.onSurfaceDisabled }}
                    >
                      {pendingDowngrade && cancelAt && userTier !== 1
                        ? `Ends ${new Date(cancelAt).toLocaleDateString()}`
                        : "Active Plan"}
                    </Button>
                  ) : (
                    <TouchableOpacity
                      onPress={() => handleSelectPlan(tier)}
                      disabled={isRedirecting || isUnavailable}
                      activeOpacity={0.8}
                    >
                      <LinearGradient
                        colors={
                          (isRedirecting || isUnavailable
                            ? [theme.colors.surfaceDisabled, theme.colors.surfaceDisabled]
                            : Colors.light.gradients.primary) as [string, string, ...string[]]
                        }
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[
                          styles.gradientButton,
                          { opacity: isRedirecting || isUnavailable ? 0.7 : 1 },
                        ]}
                      >
                        <Text
                          style={{
                            color: "#FFF",
                            fontWeight: "700",
                            fontSize: 16,
                          }}
                        >
                          {isRedirecting
                            ? "Processing..."
                            : isUnavailable
                              ? "Unavailable"
                              : `Switch to ${tier.name}`}
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </Surface>
          );
        })}

        {/* Global Sign Up Footer for Guests */}
        {!session && (
          <View style={{ marginTop: 24, paddingBottom: 16 }}>
            <TouchableOpacity
              onPress={() => router.push("/(auth)/sign-up")}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={Colors.light.gradients.primary as [string, string, ...string[]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradientButton}
              >
                <Text
                  style={{
                    color: "#FFF",
                    fontWeight: "700",
                    fontSize: 16,
                  }}
                >
                  Create Your Account
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {/* Legal & Compliance Footer */}
        <View style={styles.footer}>
          {session && (
            <Button
              mode="text"
              onPress={handleRestorePurchases}
              textColor={theme.colors.secondary}
              style={{ marginBottom: 24 }}
            >
              Restore Purchases
            </Button>
          )}

          <View style={styles.legalLinks}>
            <TouchableOpacity onPress={() => Linking.openURL("https://abodell.github.io/tee-time-notifier/privacy.html")}>
              <Text style={[styles.legalText, { color: theme.colors.primary }]}>Privacy Policy</Text>
            </TouchableOpacity>
            <Text style={[styles.legalText, { color: theme.colors.outline }]}> • </Text>
            <TouchableOpacity onPress={() => Linking.openURL("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")}>
              <Text style={[styles.legalText, { color: theme.colors.primary }]}>Terms of Use</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.disclaimer, { color: theme.colors.onSurfaceVariant }]}>
            Payment will be charged to your Apple ID account at the confirmation of purchase.
            Subscription automatically renews unless it is canceled at least 24 hours before the end of the current period.
            Your account will be charged for renewal within 24 hours prior to the end of the current period.
            You can manage and cancel your subscriptions by going to your account settings on the App Store after purchase.
          </Text>
        </View>
      </ScrollView >
    </SafeAreaView >
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    justifyContent: "space-between",
  },
  backBtn: {
    margin: 0,
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: 32,
    marginTop: 10,
  },
  card: {
    borderRadius: 20,
    padding: 24,
    marginBottom: 20,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  features: {
    gap: 16,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  featureText: {
    fontSize: 15,
  },
  gradientButton: {
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2F80ED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  footer: {
    marginTop: 20,
    alignItems: "center",
    paddingHorizontal: 16,
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
  disclaimer: {
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
    opacity: 0.6,
  },
});
