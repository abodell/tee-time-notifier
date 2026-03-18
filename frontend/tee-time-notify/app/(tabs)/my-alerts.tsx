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
import { TextInput, Text, useTheme, IconButton, ActivityIndicator, Surface, Button, Divider } from "react-native-paper";
import Animated, { FadeIn, Layout } from "react-native-reanimated";
import { supabase } from "@/lib/supabase";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Skeleton } from "moti/skeleton";
import { useColorScheme } from "react-native";
import { getUserAlerts, deleteAlert } from "@/lib/api";
import { Alert as AlertType } from "@/types/alert";
import Toast from "react-native-toast-message";
import { useRouter, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";
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
  const [fetchingQuota, setFetchingQuota] = useState(false);
  const [hasData, setHasData] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const params = useLocalSearchParams();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      loadQuotaData();
    });

    loadQuotaData();

    const sub1 = DeviceEventEmitter.addListener("membershipUpdated", () => {
      loadQuotaData();
    });
    const sub2 = DeviceEventEmitter.addListener("alertsUpdated", () => {
      loadQuotaData();
    });
    const sub3 = DeviceEventEmitter.addListener("notificationReceived", () => {
      loadQuotaData();
    });

    return () => {
      sub1.remove();
      sub2.remove();
      sub3.remove();
      authSub.subscription.unsubscribe();
    };
  }, []);

  const loadQuotaData = async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setFetchingQuota(false);
        setHasData(false);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (!hasData) {
        setFetchingQuota(true);
      }

      const baseUrl = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";
      const [profileRes, alertsRes] = await Promise.all([
        fetch(`${baseUrl}/membership/profile/${user.id}`),
        fetch(`${baseUrl}/alerts/user/${user.id}`),
      ]);

      const profile = await profileRes.json();
      const tier = profile.membership_tiers;
      setTierName(tier?.name || "—");
      setMaxAlerts(tier?.max_alerts ?? null);

      const userAlerts = await alertsRes.json();
      // Sort: Active first, Expired last
      userAlerts.sort((a: AlertType, b: AlertType) => {
        const aExpired = dayjs.utc().isAfter(dayjs.utc(a.end_time));
        const bExpired = dayjs.utc().isAfter(dayjs.utc(b.end_time));
        if (aExpired === bExpired) return 0;
        return aExpired ? 1 : -1;
      });

      setAlerts(userAlerts);
      setAlertCount(userAlerts.length);
      setHasData(true);

    } catch (err: any) {
      console.log("Quota load failed", err);
      Toast.show({
        type: "error",
        text1: "Failed to load data",
        text2: err.message,
      });
    } finally {
      setFetchingQuota(false);
      setLoading(false);
      setRefreshing(false);
    }
  };

  // React to deep link params changing (works in background and foreground)
  useEffect(() => {
    if (params.alertId && hasData) {
      const idNum = Number(params.alertId);
      if (!isNaN(idNum)) {
        setExpandedIds((prev) => {
          if (prev.has(idNum)) return prev;
          const next = new Set(prev);
          next.add(idNum);
          return next;
        });
      }
    }
  }, [params.alertId, hasData]);

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
  const reachedQuota =
    maxAlerts !== null && alertCount >= (maxAlerts || 0) && hasData;

  const renderItem = ({ item, index }: { item: AlertType; index: number }) => {
    const course = item.courses || {};
    const isExpanded = item.id ? expandedIds.has(item.id) : false;
    const notifications = item.alert_notifications || [];
    const hasNotifications = notifications.length > 0;
    const itemTz = course.time_zone || "UTC";

    // Check expiration using UTC comparison, recurring alerts never "expire" in UI
    const isExpired = !item.is_recurring && dayjs.utc().isAfter(dayjs.utc(item.end_time));

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
                  {item.is_recurring && (
                    <Text style={{ color: theme.colors.primary, fontWeight: "800", fontSize: 12 }}>
                      {"  "}RECURRING
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


  if (loading && !refreshing && !hasData)
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

      {/* Quota Banner - Only for logged-in users */}
      {fetchingQuota && !hasData && session ? (
        <View style={{ marginBottom: 16, paddingHorizontal: 16 }}>
          <Skeleton colorMode={isDark ? "dark" : "light"} width="100%" height={60} radius={12} />
        </View>
      ) : session && hasData && (
        <Animated.View entering={FadeIn.duration(400)} style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <Surface style={{ backgroundColor: theme.colors.surface, borderRadius: 12 }} elevation={0}>
            <View style={[styles.noticeCard, { backgroundColor: theme.colors.surface }]}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <MaterialCommunityIcons
                  name={reachedQuota ? "alert-circle-outline" : "information-outline"}
                  size={20}
                  color={reachedQuota ? theme.colors.error : theme.colors.primary}
                  style={{ marginRight: 4 }}
                />

                <View style={{ flex: 1, marginLeft: 4 }}>
                  <Text style={{ color: theme.colors.onSurface, fontSize: 15, lineHeight: 20 }}>
                    {reachedQuota ? (
                      <>
                        Alert limit reached on <Text style={{ fontWeight: "600" }}>{tierName}</Text>.{" "}
                        <Text
                          style={{ color: theme.colors.primary, fontWeight: "600" }}
                          onPress={() => router.push("/upgrade")}
                        >
                          Upgrade
                        </Text>
                      </>
                    ) : (
                      <>
                        Using <Text style={{ fontWeight: "600" }}>{alertCount}</Text>
                        {maxAlerts ? `/${maxAlerts}` : ""} alerts on <Text style={{ fontWeight: "600" }}>{tierName}</Text>.
                        {tierName === "Plus" && (
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
      )}

      {/* 🚀 Integrated Trial Promotion Banner */}
      {(!session || tierName === "Free") && (
        <Animated.View entering={FadeIn.delay(300).duration(500)} style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <LinearGradient
            colors={Colors.light.gradients.primary as [string, string, ...string[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.promoBanner}
          >
            <View style={styles.promoContent}>
              <View style={{ flex: 1 }}>
                <Text style={styles.promoTextBold}>
                  Try Pro Free for 14 Days
                </Text>
                <Text style={styles.promoSubtext}>
                  Unlock 10 alerts and 1-minute scans.
                </Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => {
                  if (!session) {
                    router.push("/(auth)/sign-up?redirectTo=/upgrade");
                  } else {
                    router.push("/upgrade");
                  }
                }}
                style={styles.promoButton}
              >
                <Text style={styles.promoButtonText}>Start Trial</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Animated.View>
      )}

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
              loadQuotaData();
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
                <View style={{ overflow: "hidden", borderRadius: 30, width: "100%", height: "100%" }}>
                  <TouchableOpacity
                    onPress={() => router.push("/")}
                    style={styles.fullTouch}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="plus" size={32} color={theme.colors.primary} />
                  </TouchableOpacity>
                </View>
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
    </SafeAreaView >
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
  },
  fullTouch: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  promoBanner: {
    borderRadius: 12,
    overflow: "hidden",
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  promoContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  promoTextBold: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "800",
  },
  promoSubtext: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 12,
    fontWeight: "500",
  },
  promoButton: {
    backgroundColor: "#FFF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  promoButtonText: {
    color: "#15803d",
    fontSize: 13,
    fontWeight: "700",
  },
});