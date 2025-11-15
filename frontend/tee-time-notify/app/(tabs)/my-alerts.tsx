import React, { useEffect, useState } from "react";
import {
  View,
  FlatList,
  RefreshControl,
  StyleSheet,
  Alert as RNAlert,
} from "react-native";
import {
  Text,
  useTheme,
  Card,
  IconButton,
  ActivityIndicator,
  Surface,
} from "react-native-paper";
import Animated, { FadeIn } from "react-native-reanimated";
import { supabase } from "@/lib/supabase";
import { getUserAlerts, deleteAlert } from "@/lib/api";
import { Alert as AlertType } from "@/types/alert";
import Toast from "react-native-toast-message";
import { useRouter } from "expo-router";
import dayjs from "dayjs";

export default function MyAlertsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [maxAlerts, setMaxAlerts] = useState<number | null>(null);
  const [tierName, setTierName] = useState("—");

  useEffect(() => {
    loadAlerts();
    loadTier();
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) return;
      const result = await getUserAlerts(user.id);
      setAlerts(result);
    } catch (err: any) {
      Toast.show({
        type: "error",
        text1: "Failed to load alerts",
        text2: err.message,
        position: "top",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadTier = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const baseUrl =
        process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/membership/profile/${user.id}`);
      const data = await res.json();
      const tier = data.membership_tiers;
      setTierName(tier?.name || "—");
      setMaxAlerts(tier?.max_alerts ?? null);
    } catch (e) {
      console.log("Tier load error", e);
    }
  };

  const deleteConfirm = (id: number) =>
    RNAlert.alert("Delete Alert", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => handleDelete(id) },
    ]);

  const handleDelete = async (id: number) => {
    try {
      await deleteAlert(id);
      setAlerts((p) => p.filter((a) => a.id !== id));
      Toast.show({ type: "success", text1: "Alert deleted" });
    } catch (err: any) {
      Toast.show({ type: "error", text1: "Failed", text2: err.message });
    }
  };

  const atQuota = maxAlerts !== null && alerts.length >= (maxAlerts || 0);

  const renderItem = ({ item }: { item: AlertType }) => {
    const course = item.courses || {};
    return (
      <Card
        style={[
          styles.card,
          { backgroundColor: theme.colors.surface, borderRadius: 12 },
        ]}
        mode="elevated"
      >
        <Card.Title
          title={course.name || `Course #${item.course_id}`}
          subtitle={`${course.city ?? ""}${course.state ? `, ${course.state}` : ""}`}
          right={(props) => (
            <IconButton
              {...props}
              icon="delete"
              iconColor={theme.colors.primary}
              onPress={() => deleteConfirm(item.id!)}
            />
          )}
        />
        <Card.Content>
          <Text style={{ color: theme.colors.primary, fontWeight: "600" }}>
            {item.holes} Holes
          </Text>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            {dayjs(item.date_from).format("MMM D, YYYY")} →{" "}
            {dayjs(item.end_time).format("h:mm A")}
          </Text>
        </Card.Content>
      </Card>
    );
  };

  if (loading)
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Soft notice */}
      <Animated.View entering={FadeIn.duration(600)}>
        <Surface style={styles.noticeCard} elevation={1}>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <IconButton
              icon={atQuota ? "alert-circle-outline" : "information-outline"}
              size={22}
              iconColor={
                atQuota ? theme.colors.primary : theme.colors.onSurfaceVariant
              }
              style={{ margin: 0, marginRight: 8 }}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: theme.colors.onSurfaceVariant,
                  fontSize: 14,
                  lineHeight: 20,
                }}
              >
                {atQuota ? (
                  <>
                    You've used all alerts on the{" "}
                    <Text style={{ fontWeight: "600" }}>{tierName}</Text> plan.{" "}
                    <Text
                      style={{
                        color: theme.colors.primary,
                        fontWeight: "600",
                      }}
                      onPress={() => router.push("/upgrade")}
                    >
                      Upgrade
                    </Text>{" "}
                    to track more tee times.
                  </>
                ) : (
                  <>
                    You’re using{" "}
                    <Text style={{ fontWeight: "600" }}>{alerts.length}</Text>
                    {maxAlerts ? ` of ${maxAlerts}` : ""} alerts on your{" "}
                    <Text style={{ fontWeight: "600" }}>{tierName}</Text> plan.
                  </>
                )}
              </Text>
            </View>
          </View>
        </Surface>
      </Animated.View>

      <FlatList
        data={alerts}
        keyExtractor={(i) => i.id!.toString()}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadAlerts();
              loadTier();
            }}
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <IconButton icon="bell-outline" size={48} iconColor={theme.colors.primary} />
            <Text
              variant="bodyLarge"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}
            >
              No alerts yet
            </Text>
            <Text
              variant="bodySmall"
              style={{
                color: theme.colors.onSurfaceVariant,
                opacity: 0.7,
                textAlign: "center",
                marginTop: 4,
              }}
            >
              Create one to start tracking tee times.
            </Text>
          </View>
        }
        contentContainerStyle={{ padding: 16 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  noticeCard: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "transparent",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  card: {
    marginBottom: 16,
    elevation: 1,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
});