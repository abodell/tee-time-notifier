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
        throw new Error("Failed to fetch data");

      const tierList: MembershipTier[] = await tiersRes.json();
      const profileData = await profileRes.json();

      setTiers(tierList);
      setUserTier(profileData.membership_tier_id);
    } catch (err: any) {
      console.error("UpgradeScreen error:", err);
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

  const handleSelectPlan = (tier: MembershipTier) => {
    if (tier.id === userTier) {
      Toast.show({
        type: "info",
        text1: "You're already on this plan",
        position: "top",
      });
      return;
    }
    Alert.alert(
      "Upgrade",
      `You selected the ${tier.name} plan.\nCheckout flow coming soon.`,
      [{ text: "OK" }]
    );
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
      {/* Back button (lowered into comfortable reach) */}
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
          style={[
            styles.header,
            { color: theme.colors.onBackground, fontWeight: "700" },
          ]}
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

              {/* Feature list with icons */}
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
                style={{
                  marginTop: 10,
                  borderRadius: 10,
                  elevation: 0,
                }}
                contentStyle={{ height: 46 }}
                labelStyle={{ fontWeight: "600" }}
                onPress={() => handleSelectPlan(tier)}
              >
                {isCurrent ? "Current Plan" : "Choose Plan"}
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
    paddingTop: 40, // slightly reduced from 60 for visibility
    paddingBottom: 80,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  navRow: {
    marginBottom: 10,
    marginLeft: -4,
    marginTop: 10
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: 28,
  },
  header: {
    textAlign: "center",
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