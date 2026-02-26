import React, { useEffect, useState } from "react";
import {
  View,
  FlatList,
  RefreshControl,
  StyleSheet,
  Alert as RNAlert,
  TouchableOpacity,
  Linking,
  DeviceEventEmitter,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Text,
  useTheme,
  IconButton,
  ActivityIndicator,
  Surface,
  Button,
  Divider,
} from "react-native-paper";
import Animated, { FadeIn, Layout } from "react-native-reanimated";
import { supabase } from "@/lib/supabase";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { getUserAlerts, deleteAlert } from "@/lib/api";
import { Alert as AlertType } from "@/types/alert";
import Toast from "react-native-toast-message";
import { useRouter } from "expo-router";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Robustly format a UTC ISO string into a specific timezone's local time string.
 * Uses native Intl.DateTimeFormat which is more reliable in React Native than dayjs.tz()
 */
function formatInTimeZone(
  utcString: string | undefined,
  tz: string,
  options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "numeric", hour12: true }
) {
  if (!utcString) return "";
  try {
    const date = new Date(utcString);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      ...options,
    }).format(date);
  } catch (e) {
    console.warn(`Timezone conversion failed for ${tz}:`, e);
    return dayjs.utc(utcString).format("h:mm A"); // Fallback
  }
}

/**
 * Helper to construct the true expiration time by merging:
 * - Date from `date_from` (User's target date)
 * - Time from `end_time` (User's target end time, in UTC)
 */
function getExpirationTime(alert: AlertType) {
  const datePart = dayjs.utc(alert.date_from);
  const timePart = dayjs.utc(alert.end_time);

  // Combine them into a single UTC datetime
  return datePart
    .hour(timePart.hour())
    .minute(timePart.minute())
    .second(timePart.second())
    .millisecond(0);
}

export default function MyAlertsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [maxAlerts, setMaxAlerts] = useState<number | null>(null);
  const [tierName, setTierName] = useState("—");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const authSub = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      loadAlerts();
      loadTier();
    });

    loadAlerts();
    loadTier();

    const sub1 = DeviceEventEmitter.addListener("membershipUpdated", () => {
      loadTier();
      loadAlerts();
    });
    const sub2 = DeviceEventEmitter.addListener("notificationReceived", () => {
      loadAlerts();
    });

    return () => {
      sub1.remove();
      sub2.remove();
      authSub.data.subscription.unsubscribe();
    };
  }, []);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) return;
      const result = await getUserAlerts(user.id);

      // Sort: Active first, Expired last
      result.sort((a: AlertType, b: AlertType) => {
        const aExpired = dayjs.utc().isAfter(dayjs.utc(a.end_time));
        const bExpired = dayjs.utc().isAfter(dayjs.utc(b.end_time));
        if (aExpired === bExpired) return 0;
        return aExpired ? 1 : -1;
      });

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
      // Notify other screens to refresh data
      DeviceEventEmitter.emit("alertsUpdated");
    } catch (err: any) {
      Toast.show({ type: "error", text1: "Failed", text2: err.message });
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBookNow = (url: string | undefined, date: string, tz?: string) => {
    if (!url) {
      Toast.show({ type: "error", text1: "No booking URL available" });
      return;
    }
    // Construct ForeUp URL with date parameter in course local time
    const dateStr = dayjs(date).tz(tz || "UTC").format("MM-DD-YYYY");
    const bookingUrl = `${url}?date=${dateStr}`;
    Linking.openURL(bookingUrl).catch((err) =>
      Toast.show({ type: "error", text1: "Could not open link", text2: err.message })
    );
  };
  const atQuota = maxAlerts !== null && alerts.length >= (maxAlerts || 0);

  const renderItem = ({ item, index }: { item: AlertType; index: number }) => {
    const course = item.courses || {};
    const isExpanded = item.id ? expandedIds.has(item.id) : false;
    const notifications = item.alert_notifications || [];
    const hasNotifications = notifications.length > 0;
    const itemTz = course.time_zone || "UTC";

    // Check expiration using UTC comparison
    const isExpired = dayjs.utc().isAfter(dayjs.utc(item.end_time));

    return (
      <Animated.View layout={Layout.springify()}>
        <Surface
          style={[
            {
              backgroundColor: theme.colors.surface,
              borderRadius: 12,
              marginBottom: 12,
              elevation: 1,
              opacity: isExpired ? 0.6 : 1, // Dim expired alerts
            },
          ]}
          elevation={1}
        >
          <View style={{ overflow: "hidden", borderRadius: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 16 }}>

              <View style={{ flex: 1 }}>
                <Text variant="titleMedium" style={{ fontWeight: "600", color: theme.colors.onSurface }}>
                  {course.name || `Course #${item.course_id}`}
                  {isExpired && (
                    <Text style={{ color: theme.colors.error, fontWeight: "800", fontSize: 12 }}>
                      {"  "}EXPIRED
                    </Text>
                  )}
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                  {dayjs.utc(item.date_from).format("ddd, MMM D")} • {item.holes} Holes
                </Text>
                <Text variant="bodySmall" style={{ color: theme.colors.primary, marginTop: 2, fontWeight: "500" }}>
                  {formatInTimeZone(item.start_time, itemTz)} - {formatInTimeZone(item.end_time, itemTz)}
                </Text>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {!isExpired && (
                  <IconButton
                    icon={isExpanded ? "chevron-up" : "chevron-down"}
                    size={20}
                    onPress={() => item.id && toggleExpand(item.id)}
                    iconColor={theme.colors.onSurfaceVariant}
                  />
                )}
                <TouchableOpacity
                  onPress={() => deleteConfirm(item.id!)}
                  style={{ padding: 8 }}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={22} color={theme.colors.error} style={{ opacity: 0.8 }} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Expanded Notifications Section */}
            {isExpanded && (
              <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.outline, padding: 16, backgroundColor: theme.colors.surfaceVariant + "40" }}>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                  Found Openings
                </Text>
                {!hasNotifications ? (
                  <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, fontStyle: "italic" }}>
                    No tee times available currently.
                  </Text>
                ) : (
                  notifications
                    .sort((a, b) => {
                      const timeA = a.availability?.tee_time ? new Date(a.availability.tee_time).getTime() : 0;
                      const timeB = b.availability?.tee_time ? new Date(b.availability.tee_time).getTime() : 0;
                      return timeA - timeB;
                    })
                    .map((notif) => {
                      const teeTime = notif.availability?.tee_time;
                      if (!teeTime) return null;
                      return (
                        <View key={notif.id} style={styles.notificationRow}>
                          <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                            <MaterialCommunityIcons name="golf" size={16} color={theme.colors.primary} style={{ marginRight: 8 }} />
                            <View>
                              <Text variant="bodyMedium" style={{ fontWeight: "600", color: theme.colors.onSurface }}>
                                {formatInTimeZone(teeTime, itemTz)}
                              </Text>
                              {notif.availability?.price ? (
                                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                                  ${notif.availability.price.toFixed(2)}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                          <Button
                            mode="contained"
                            compact
                            onPress={() => handleBookNow(course.provider_url, teeTime, course.time_zone)}
                            style={{ borderRadius: 8 }}
                            labelStyle={{ fontSize: 12, marginHorizontal: 8, marginVertical: 4 }}
                            contentStyle={{ height: 32 }}
                          >
                            Book
                          </Button>
                        </View>
                      );
                    })
                )}

              </View>
            )}
          </View>
        </Surface>
      </Animated.View>
    );
  };


  if (loading && !refreshing)
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text variant="headlineMedium" style={{ fontWeight: "700", color: theme.colors.onBackground }}>
          My Alerts
        </Text>
      </View>

      {/* Soft notice */}
      <Animated.View entering={FadeIn.duration(600)} style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <Surface style={{ backgroundColor: theme.colors.surface, borderRadius: 12 }} elevation={0}>
          <View style={[styles.noticeCard, { backgroundColor: theme.colors.surface }]}>

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
                  {!session ? (
                    <>
                      Join now to start tracking tee times.{" "}
                      <Text
                        style={{ color: theme.colors.primary, fontWeight: "600" }}
                        onPress={() => router.push("/upgrade")}
                      >
                        See Pricing
                      </Text>
                    </>
                  ) : atQuota ? (
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
                      {(tierName === "Free" || tierName === "Plus") && (
                        <>
                          {" "}
                          <Text
                            style={{ color: theme.colors.primary, fontWeight: "600" }}
                            onPress={() => router.push("/upgrade")}
                          >
                            Upgrade
                          </Text>
                        </>
                      )}
                    </>
                  )}
                </Text>
              </View>
            </View>
          </View>
        </Surface>
      </Animated.View>


      <FlatList
        data={alerts}
        keyExtractor={(i) => i.id!.toString()}
        renderItem={renderItem}
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
        ListFooterComponent={
          alerts.length > 0 ? (
            <View style={styles.footerContainer}>
              <Surface
                style={[styles.footerAction, { backgroundColor: theme.colors.surface }]}
                elevation={1}
              >
                <TouchableOpacity
                  onPress={() => router.push("/")}
                  style={styles.fullTouch}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="plus" size={32} color={theme.colors.primary} />
                </TouchableOpacity>
              </Surface>
            </View>
          ) : null
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
    </SafeAreaView>
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
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  listItem: {
  },
  notificationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
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
  footerContainer: {
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  footerAction: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  fullTouch: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
});