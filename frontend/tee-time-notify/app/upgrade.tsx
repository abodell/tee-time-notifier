import React, { useEffect, useState } from "react";
import { View, ScrollView, StyleSheet, Alert } from "react-native";
import {
  Text,
  Button,
  useTheme,
  ActivityIndicator,
  Card,
  IconButton,
} from "react-native-paper";
import { supabase } from "@/lib/supabase";
import Toast from "react-native-toast-message";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

interface MembershipTier {
  id: number;
  name: string;
  description?: string;
  price_cents?: number;
  max_alerts?: number;
  scan_interval_seconds?: number;
}

export default function UpgradeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [redirectingTier, setRedirectingTier] = useState<number | null>(null);
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [userTier, setUserTier] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, []);

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
      const profileData = await profileRes.json();

      setTiers(tierList);
      setUserTier(profileData.membership_tier_id);
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

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");

      setRedirectingTier(tier.id); // turn this plan button into "Redirecting..."

      const res = await fetch(`${API_URL}/membership/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, tier_id: tier.id }),
      });

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      const checkoutUrl = data.checkout_url;
      if (!checkoutUrl) throw new Error("Checkout URL missing from response");

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
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* Back Button */}
      <View style={styles.navRow}>
        <Button
          icon="arrow-left"
          mode="text"
          textColor={theme.colors.primary}
          labelStyle={{ fontWeight: "500" }}
          onPress={() => router.back()}
        >
          Back to Profile
        </Button>
      </View>

      {/* Header */}
      <View style={styles.headerContainer}>
        <Text
          variant="headlineSmall"
          style={{
            color: theme.colors.onBackground,
            fontWeight: "700",
            textAlign: "center",
          }}
        >
          Upgrade Your Plan
        </Text>
        <Text
          variant="bodyMedium"
          style={{
            color: theme.colors.onSurfaceVariant,
            opacity: 0.85,
            textAlign: "center",
            marginTop: 4,
          }}
        >
          Choose the membership level that matches how often you golf
        </Text>
      </View>

      {/* Membership Cards */}
      {tiers.map((tier) => {
        const isCurrent = tier.id === userTier;
        const price = toPriceText(tier.price_cents);
        const isRedirecting = redirectingTier === tier.id;

        return (
          <Card
            key={tier.id}
            mode="elevated"
            style={[
              styles.card,
              {
                borderColor: isCurrent
                  ? theme.colors.primary
                  : "transparent",
                borderWidth: isCurrent ? 1 : 0,
              },
            ]}
          >
            <Card.Content>
              <View style={styles.cardHeader}>
                <Text
                  variant="titleLarge"
                  style={{
                    color: theme.colors.onSurface,
                    fontWeight: "700",
                  }}
                >
                  {tier.name}
                </Text>
              </View>

              <Text
                style={{
                  color: theme.colors.onSurfaceVariant,
                  marginTop: 6,
                  fontSize: 15,
                }}
              >
                {tier.description ||
                  "Everything you need to find your next tee time."}
              </Text>

              <View style={styles.dividerLine} />

              {/* Feature list */}
              <View style={styles.features}>
                <View style={styles.featureRow}>
                  <IconButton
                    icon="bell-outline"
                    size={20}
                    iconColor={theme.colors.primary}
                  />
                  <Text style={styles.featureText}>
                    Track up to{" "}
                    <Text style={styles.highlight}>
                      {tier.max_alerts ?? 3}
                    </Text>{" "}
                    active alerts
                  </Text>
                </View>

                <View style={styles.featureRow}>
                  <IconButton
                    icon="update"
                    size={20}
                    iconColor={theme.colors.primary}
                  />
                  <Text style={styles.featureText}>
                    Refreshes every{" "}
                    <Text style={styles.highlight}>
                      {tier.scan_interval_seconds
                        ? tier.scan_interval_seconds / 60
                        : 10}
                      {" min"}
                    </Text>{" "}
                    for new openings
                  </Text>
                </View>
              </View>

              <Text
                variant="titleMedium"
                style={[
                  styles.price,
                  {
                    color: theme.colors.primary,
                    marginTop: 10,
                    marginBottom: 4,
                    fontWeight: "600",
                  },
                ]}
              >
                {price}
              </Text>

              <Button
                mode={isCurrent ? "outlined" : "contained"}
                disabled={isRedirecting}
                style={{
                  marginTop: 10,
                  borderRadius: 10,
                  elevation: 0,
                  opacity: isRedirecting ? 0.85 : 1,
                }}
                contentStyle={{ height: 46 }}
                labelStyle={{ fontWeight: "600" }}
                onPress={() => handleSelectPlan(tier)}
              >
                {isRedirecting
                  ? "Redirecting to Stripe..."
                  : isCurrent
                  ? "Current Plan"
                  : "Choose Plan"}
              </Button>
            </Card.Content>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 80,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  navRow: {
    marginTop: 24,
    marginBottom: 10,
    marginLeft: -4,
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: 28,
  },
  card: {
    borderRadius: 16,
    paddingVertical: 2,
    marginBottom: 22,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dividerLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    marginVertical: 12,
  },
  features: {
    gap: 4,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  featureText: {
    fontSize: 15,
    flexShrink: 1,
    color: "rgba(255,255,255,0.85)",
  },
  highlight: {
    fontWeight: "600",
  },
  price: {
    textAlign: "left",
    fontSize: 17,
  },
});