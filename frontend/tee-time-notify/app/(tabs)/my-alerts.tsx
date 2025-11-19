import React, { useEffect, useState } from "react";
import {
  View,
  FlatList,
  RefreshControl,
  StyleSheet,
  Alert as RNAlert,
  TouchableOpacity,
} from "react-native";
import {
  Text,
  useTheme,
  IconButton,
  ActivityIndicator,
  Surface,
} from "react-native-paper";
import Animated, { FadeIn } from "react-native-reanimated";
import { supabase } from "@/lib/supabase";
import { MaterialCommunityIcons } from "@expo/vector-icons";
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
    RNAlert.alert("Delete Alert", "Are you sure you want to remove this alert?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => handleDelete(id) },
    ]);

  const handleDelete = async (id: number) => {
    try {
      await deleteAlert(id);
      setAlerts((p) => p.filter((a) => a.id !== id));
      Toast.show({ type: "success", text1: "Alert deleted", visibilityTime: 1000 });
    } catch (err: any) {
      Toast.show({ type: "error", text1: "Failed", text2: err.message });
    }
  };

  const atQuota = maxAlerts !== null && alerts.length >= (maxAlerts || 0);

  const renderItem = ({ item, index }: { item: AlertType; index: number }) => {
    const course = item.courses || {};
    return (
      <View
        style={[
          styles.listItem,
          {
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: index === 0 ? 12 : 0,
            borderTopRightRadius: index === 0 ? 12 : 0,
            borderBottomLeftRadius: index === alerts.length - 1 ? 12 : 0,
            borderBottomRightRadius: index === alerts.length - 1 ? 12 : 0,
          }
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium" style={{ fontWeight: "600", color: theme.colors.onSurface }}>
            {course.name || `Course #${item.course_id}`}
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
            {dayjs(item.date_from).format("ddd, MMM D")} • {item.holes} Holes
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.primary, marginTop: 2, fontWeight: "500" }}>
            {dayjs(item.start_time).format("h:mm A")} - {dayjs(item.end_time).format("h:mm A")}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => deleteConfirm(item.id!)}
          style={{ padding: 8 }}
        >
          <MaterialCommunityIcons name="trash-can-outline" size={22} color={theme.colors.error} style={{ opacity: 0.8 }} />
        </TouchableOpacity>
      </View>
    );
  };

  if (loading && !refreshing)
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Text variant="headlineMedium" style={{ fontWeight: "700", color: theme.colors.onBackground }}>
          My Alerts
        </Text>
      </View>

      {/* Soft notice */}
      <Animated.View entering={FadeIn.duration(600)} style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <Surface style={[styles.noticeCard, { backgroundColor: theme.colors.surface }]} elevation={0}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: atQuota ? theme.colors.error + "20" : theme.colors.primary + "20" },
              ]}
            >
              <MaterialCommunityIcons
                name={atQuota ? "alert-circle" : "information"}
                size={24}
                color={atQuota ? theme.colors.error : theme.colors.primary}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: theme.colors.onSurface, fontSize: 15, lineHeight: 20 }}>
                {atQuota ? (
                  <>
                    Limit reached on <Text style={{ fontWeight: "600" }}>{tierName}</Text>.{" "}
                    <Text
                      style={{ color: theme.colors.primary, fontWeight: "600" }}
                      onPress={() => router.push("/upgrade")}
                    >
                      Upgrade
                    </Text>
                  </>
                ) : (
                  <>
                    Using <Text style={{ fontWeight: "600" }}>{alerts.length}</Text>
                    {maxAlerts ? `/${maxAlerts}` : ""} alerts on <Text style={{ fontWeight: "600" }}>{tierName}</Text>.
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
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.colors.outline, marginLeft: 16 }} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadAlerts();
              loadTier();
            }}
            tintColor={theme.colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <View style={[styles.emptyIcon, { backgroundColor: theme.colors.surface }]}>
              <MaterialCommunityIcons name="bell-off-outline" size={32} color={theme.colors.onSurfaceVariant} />
            </View>
            <Text
              variant="titleMedium"
              style={{ color: theme.colors.onSurface, marginTop: 16, fontWeight: "600" }}
            >
              No alerts yet
            </Text>
            <Text
              variant="bodyMedium"
              style={{
                color: theme.colors.onSurfaceVariant,
                textAlign: "center",
                marginTop: 8,
                maxWidth: 250,
              }}
            >
              Create an alert to get notified when tee times become available.
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/")}
              style={{ marginTop: 24 }}
            >
              <Text style={{ color: theme.colors.primary, fontSize: 16, fontWeight: "600" }}>
                Find a Course
              </Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
  },
  noticeCard: {
    borderRadius: 12,
    padding: 12,
    overflow: "hidden",
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
  },
});