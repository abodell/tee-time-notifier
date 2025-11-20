import React, { useEffect, useState } from "react";
import { View, ScrollView, StyleSheet, Alert, TouchableOpacity } from "react-native";
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
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

interface MembershipTier {
  id: number;
  name: string;
  description?: string;
  price_cents?: number;
  max_alerts?: number;
  scan_interval_seconds?: number;
}

interface UserProfileResponse {
  membership_tier_id: number;
  membership_tiers?: MembershipTier;
  pending_downgrade?: boolean;
  cancel_at?: string;
}

export default function UpgradeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [redirectingTier, setRedirectingTier] = useState<number | null>(null);
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [userTier, setUserTier] = useState<number | null>(null);
  const [pendingDowngrade, setPendingDowngrade] = useState(false);
  const [cancelAt, setCancelAt] = useState<string | null>(null);

  const { canceled } = useLocalSearchParams();

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (canceled) {
      setRedirectingTier(null);
      Toast.show({
        type: "info",
        text1: "Checkout Canceled",
        text2: "You have not been charged.",
        position: "top",
      });
    }
  }, [canceled]);

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("User not logged in");

      const [tiersRes, profileRes] = await Promise.all([
        fetch(`${API_URL}/membership/tiers`),
        fetch(`${API_URL}/membership/profile/${user.id}`),
      ]);

      if (!tiersRes.ok || !profileRes.ok)
        throw new Error("Failed to fetch membership info");

      const tierList: MembershipTier[] = await tiersRes.json();
      const profileData: UserProfileResponse = await profileRes.json();

      setTiers(tierList);
      setUserTier(profileData.membership_tier_id);
      setPendingDowngrade(profileData.pending_downgrade || false);
      setCancelAt(profileData.cancel_at || null);
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
          "Unsubscribe?",
          "Are you sure you want to cancel your current subscription? " +
          "Your plan will remain active until the end of this billing period.",
          [
            { text: "Keep Current Plan", style: "cancel" },
            {
              text: "Unsubscribe",
              style: "destructive",
              onPress: async () => {
                try {
                  const {
                    data: { user },
                  } = await supabase.auth.getUser();
                  if (!user) throw new Error("Not logged in");

                  const res = await fetch(`${API_URL}/membership/downgrade`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ user_id: user.id }),
                  });

                  if (!res.ok) throw new Error(await res.text());
                  const data = await res.json();

                  setPendingDowngrade(true);
                  setCancelAt(
                    new Date(data.cancel_at * 1000).toISOString()
                  );

                  Toast.show({
                    type: "info",
                    text1: "Downgrade scheduled",
                    text2: `Plan will end on ${new Date(
                      data.cancel_at * 1000
                    ).toLocaleDateString()}`,
                    position: "top",
                  });
                } catch (err: any) {
                  Toast.show({
                    type: "error",
                    text1: "Failed to schedule downgrade",
                    text2: err.message,
                    position: "top",
                  });
                }
              },
            },
          ]
        );
        return;
      }

      // 🟢 Regular upgrade flow
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");

      setRedirectingTier(tier.id);

      // Generate deep links for return
      const successUrl = Linking.createURL("/profile");
      const cancelUrl = Linking.createURL("/upgrade");

      const res = await fetch(`${API_URL}/membership/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          tier_id: tier.id,
          success_url: successUrl,
          cancel_url: cancelUrl
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      const checkoutUrl = data.checkout_url;
      if (!checkoutUrl) throw new Error("Checkout URL missing");

      await Linking.openURL(checkoutUrl);
    } catch (err: any) {
      Toast.show({
        type: "error",
        text1: "Checkout failed",
        text2: err.message,
        position: "top",
      });
      setRedirectingTier(null);
    }
  };

  const toPriceText = (cents?: number) =>
    !cents || cents === 0 ? "Free" : `$${(cents / 100).toFixed(2)}/mo`;

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
          const price = toPriceText(tier.price_cents);
          const isFree = tier.price_cents === 0;

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
                {price}
              </Text>

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

              {/* Action Button */}
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
                    disabled={isRedirecting}
                    activeOpacity={0.8}
                  >
                    <LinearGradient
                      colors={
                        (isRedirecting
                          ? [theme.colors.surfaceDisabled, theme.colors.surfaceDisabled]
                          : Colors.light.gradients.primary) as [string, string, ...string[]]
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[
                        styles.gradientButton,
                        { opacity: isRedirecting ? 0.7 : 1 },
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
                          : isFree
                            ? "Downgrade to Free"
                            : "Upgrade Now"}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
            </Surface>
          );
        })}
      </ScrollView>
    </SafeAreaView>
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
});