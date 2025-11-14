import React, { useEffect, useState } from "react";
import { View, ScrollView, StyleSheet, Alert } from "react-native";
import {
  Text,
  Button,
  useTheme,
  ActivityIndicator,
  IconButton,
  Card,
  Divider,
} from "react-native-paper";
import { supabase } from "../../lib/supabase";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";

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
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) throw new Error(error?.message || "User not found");

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
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Tagline / intro */}
      <View style={{ alignItems: "center", marginBottom: 24 }}>
        <Text
          variant="bodyMedium"
          style={{
            color: theme.colors.onSurfaceVariant,
            opacity: 0.8,
            textAlign: "center",
          }}
        >
          Manage your membership and profile
        </Text>
      </View>

      {/* Membership Plan Card */}
      <Card
        mode="elevated"
        style={[styles.planCard, { backgroundColor: theme.colors.surface }]}
      >
        <Card.Content>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <IconButton icon="crown" size={28} iconColor={theme.colors.primary} />
            <View style={{ flexShrink: 1 }}>
              <Text
                variant="titleMedium"
                style={{
                  color: theme.colors.onSurface,
                  fontWeight: "600",
                }}
              >
                {tier?.name || "Free Plan"}
              </Text>
              <Text
                style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
              >
                {tier?.description ||
                  "Basic access with limited tee‑time alerts per day"}
              </Text>
            </View>
          </View>

          <View style={styles.planDetails}>
            <Text style={styles.detailText}>
              {`Track up to ${tier?.max_alerts ?? 3} tee‑time alerts simultaneously.`}
            </Text>
            <Text style={styles.detailText}>
              {`We’ll check new availabilities every ${
                tier?.scan_interval_seconds
                  ? tier.scan_interval_seconds / 60
                  : 10
              } minutes to keep you updated.`}
            </Text>
          </View>

          <Text
            variant="bodyLarge"
            style={[
              styles.planPrice,
              { color: theme.colors.primary, fontWeight: "600" },
            ]}
          >
            {price}
          </Text>

          <Button
            mode="contained"
            style={{ marginTop: 16, borderRadius: 10 }}
            contentStyle={{ height: 48 }}
            labelStyle={{ fontWeight: "600" }}
            onPress={() => router.push("/")}
          >
            {tier?.price_cents === 0 ? "Explore Upgrade Options" : "Manage Plan"}
          </Button>
        </Card.Content>
      </Card>

      {/* Lightweight Account Info (subsection, minimalist) */}
      <View style={[styles.accountContainer]}>
        <Divider style={{ marginVertical: 8, opacity: 0.15 }} />
        <Text
          style={{
            color: theme.colors.onSurfaceVariant,
            fontSize: 14,
            textAlign: "center",
            marginBottom: 4,
          }}
        >
          Signed in as
        </Text>
        <Text
          style={{
            color: theme.colors.onSurface,
            fontSize: 16,
            fontWeight: "500",
            textAlign: "center",
          }}
        >
          {user?.email ?? "—"}
        </Text>
        <Button
          mode="text"
          textColor={theme.colors.error}
          onPress={handleLogout}
          style={{ marginTop: 12 }}
          labelStyle={{ fontWeight: "600", fontSize: 15 }}
        >
          Log Out
        </Button>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 60,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  planCard: {
    borderRadius: 14,
    marginBottom: 32,
    elevation: 3,
    paddingVertical: 4,
  },
  planDetails: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.15)",
    marginTop: 12,
    paddingTop: 10,
  },
  detailText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    marginBottom: 3,
  },
  planPrice: {
    marginTop: 10,
    fontSize: 16,
  },
  accountContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
});