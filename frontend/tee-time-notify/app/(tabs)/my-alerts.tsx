import React, { useEffect, useRef, useState } from "react";
import {
  View,
  RefreshControl,
  StyleSheet,
  Alert as RNAlert,
  TouchableOpacity,
  Linking,
  DeviceEventEmitter,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text, useTheme, ActivityIndicator } from "react-native-paper";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { supabase } from "@/lib/supabase";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Skeleton } from "moti/skeleton";
import { useColorScheme } from "react-native";
import { deleteAlert } from "@/lib/api";
import { Alert as AlertType } from "@/types/alert";
import Toast from "react-native-toast-message";
import { useRouter, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from "react-native-draggable-flatlist";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";

dayjs.extend(utc);
dayjs.extend(timezone);

const ALERT_ORDER_KEY = "@alert_order_v1";
const REORDER_TIP_KEY = "@reorder_tip_seen";

function formatInTimeZone(
  utcString: string | undefined,
  tz: string,
  options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "numeric", hour12: true }
) {
  if (!utcString) return "";
  try {
    const date = new Date(utcString);
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...options }).format(date);
  } catch (e) {
    console.warn(`Timezone conversion failed for ${tz}:`, e);
    return dayjs.utc(utcString).format("h:mm A");
  }
}

function getExpirationTime(alert: AlertType) {
  const datePart = dayjs.utc(alert.date_from);
  const timePart = dayjs.utc(alert.end_time);
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
  const [showReorderTip, setShowReorderTip] = useState(false);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const params = useLocalSearchParams();

  const savedOrderRef = useRef<number[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(ALERT_ORDER_KEY).then((val) => {
      if (val) savedOrderRef.current = JSON.parse(val);
    });
    AsyncStorage.getItem(REORDER_TIP_KEY).then((val) => {
      if (!val) setShowReorderTip(true);
    });
  }, []);

  useEffect(() => {
    if (!showReorderTip) return;
    const t = setTimeout(dismissTip, 6000);
    return () => clearTimeout(t);
  }, [showReorderTip]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      loadQuotaData();
    });

    loadQuotaData();

    const sub1 = DeviceEventEmitter.addListener("membershipUpdated", () => loadQuotaData());
    const sub2 = DeviceEventEmitter.addListener("alertsUpdated", () => loadQuotaData());
    const sub3 = DeviceEventEmitter.addListener("notificationReceived", () => loadQuotaData());

    return () => {
      sub1.remove();
      sub2.remove();
      sub3.remove();
      authSub.subscription.unsubscribe();
    };
  }, []);

  const applyOrder = (fetchedAlerts: AlertType[]) => {
    const savedOrder = savedOrderRef.current;
    if (!savedOrder.length) return fetchedAlerts;
    const orderMap = new Map(savedOrder.map((id, i) => [id, i]));
    return [...fetchedAlerts].sort((a, b) => {
      const posA = orderMap.has(a.id!) ? orderMap.get(a.id!)! : Infinity;
      const posB = orderMap.has(b.id!) ? orderMap.get(b.id!)! : Infinity;
      return posA - posB;
    });
  };

  const loadQuotaData = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setFetchingQuota(false);
        setHasData(false);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (!hasData) setFetchingQuota(true);

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
      const ordered = applyOrder(userAlerts);
      setAlerts(ordered);
      setAlertCount(userAlerts.length);
      setHasData(true);
    } catch (err: any) {
      console.log("Quota load failed", err);
      Toast.show({ type: "error", text1: "Failed to load data", text2: err.message });
    } finally {
      setFetchingQuota(false);
      setLoading(false);
      setRefreshing(false);
    }
  };

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

  const dismissTip = () => {
    setShowReorderTip(false);
    AsyncStorage.setItem(REORDER_TIP_KEY, "1");
  };

  const handleDragEnd = async ({ data }: { data: AlertType[] }) => {
    setAlerts(data);
    const ids = data.map((a) => a.id!);
    savedOrderRef.current = ids;
    await AsyncStorage.setItem(ALERT_ORDER_KEY, JSON.stringify(ids));
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
      const newOrder = savedOrderRef.current.filter((oid) => oid !== id);
      savedOrderRef.current = newOrder;
      await AsyncStorage.setItem(ALERT_ORDER_KEY, JSON.stringify(newOrder));
      Toast.show({ type: "success", text1: "Alert deleted", visibilityTime: 1000 });
      DeviceEventEmitter.emit("alertsUpdated");
    } catch (err: any) {
      Toast.show({ type: "error", text1: "Failed", text2: err.message });
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBookNow = (url: string | undefined, date: string, tz?: string) => {
    if (!url) {
      Toast.show({ type: "error", text1: "No booking URL available" });
      return;
    }
    const dateStr = dayjs(date).tz(tz || "UTC").format("MM-DD-YYYY");
    Linking.openURL(`${url}?date=${dateStr}`).catch((err) =>
      Toast.show({ type: "error", text1: "Could not open link", text2: err.message })
    );
  };

  const reachedQuota = maxAlerts !== null && alertCount >= (maxAlerts || 0) && hasData;

  const renderItem = ({ item, drag, isActive }: RenderItemParams<AlertType>) => {
    const course = item.courses || {};
    const isExpanded = item.id ? expandedIds.has(item.id) : false;
    const notifications = item.alert_notifications || [];
    const itemTz = course.time_zone || "UTC";
    const isExpired = !item.is_recurring && dayjs.utc().isAfter(dayjs.utc(item.end_time));
    const visibleSlots = notifications
      .filter((n) => {
        const spots = n.availability?.spots_available;
        if (item.players != null && spots != null && spots < item.players) return false;
        return true;
      })
      .sort((a, b) => {
        const tA = a.availability?.tee_time ? new Date(a.availability.tee_time).getTime() : 0;
        const tB = b.availability?.tee_time ? new Date(b.availability.tee_time).getTime() : 0;
        return tA - tB;
      });

    const hasSlots = visibleSlots.length > 0;

    return (
      <ScaleDecorator activeScale={0.988}>
        <View
          style={[
            styles.alertCard,
            {
              backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#ffffff",
              borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)",
              shadowColor: isDark ? "transparent" : "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.06,
              shadowRadius: 8,
              elevation: isActive ? 10 : 2,
              opacity: isExpired ? 0.5 : 1,
            },
          ]}
        >
          {/* ── Tappable body ── */}
          <TouchableOpacity
            onPress={() => !isExpired && item.id && toggleExpand(item.id)}
            activeOpacity={0.97}
            disabled={isExpired}
            style={styles.cardBody}
          >
            {/* Date label */}
            <Text style={[styles.cardDateLabel, { color: theme.colors.primary }]}>
              {dayjs.utc(item.date_from).format("ddd, MMM D").toUpperCase()}
            </Text>

            {/* Row 1: course name + status pill + chevron */}
            <View style={styles.cardTopRow}>
              <Text style={[styles.courseName, { color: theme.colors.onSurface }]} numberOfLines={1}>
                {course.name || `Course #${item.course_id}`}
              </Text>
              <View style={styles.cardActions}>
                {item.is_recurring && !isExpired && (
                  <MaterialCommunityIcons
                    name="repeat"
                    size={12}
                    color={theme.colors.primary}
                    style={{ opacity: 0.78 }}
                  />
                )}
                {isExpired ? (
                  <Text style={[styles.expiredLabel, { color: theme.colors.onSurfaceVariant }]}>
                    Expired
                  </Text>
                ) : (
                  <MaterialCommunityIcons
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={theme.colors.onSurfaceVariant}
                    style={{ opacity: 0.38 }}
                  />
                )}
              </View>
            </View>

            {/* Row 2: format meta */}
            <View style={styles.metaRow}>
              {item.holes != null && (
                <Text style={[styles.metaLine, { color: theme.colors.onSurfaceVariant }]}>{item.holes} holes</Text>
              )}
              {item.holes != null && item.players != null && (
                <Text style={[styles.metaDot, { color: theme.colors.onSurfaceVariant }]}>·</Text>
              )}
              {item.players != null && (
                <>
                  <MaterialCommunityIcons
                    name="account-outline"
                    size={12}
                    color={theme.colors.onSurfaceVariant}
                    style={{ opacity: 0.7 }}
                  />
                  <Text style={[styles.metaLine, { color: theme.colors.onSurfaceVariant }]}>{item.players}</Text>
                </>
              )}
            </View>

            {/* Slot time previews — shown when openings exist */}
            {hasSlots && !isExpired && (
              <View style={styles.slotPreviewRow}>
                {visibleSlots.slice(0, 3).map((notif, i) => {
                  const teeTime = notif.availability?.tee_time;
                  if (!teeTime) return null;
                  return (
                    <View key={i} style={[styles.slotPreviewChip, {
                      borderColor: isDark ? "rgba(74,222,128,0.25)" : "rgba(21,128,61,0.2)",
                    }]}>
                      <Text style={[styles.slotPreviewTime, { color: theme.colors.primary }]}>
                        {formatInTimeZone(teeTime, itemTz)}
                      </Text>
                    </View>
                  );
                })}
                {visibleSlots.length > 3 && (
                  <Text style={[styles.slotPreviewMore, { color: theme.colors.onSurfaceVariant }]}>
                    +{visibleSlots.length - 3}
                  </Text>
                )}
              </View>
            )}

            {/* Row 3: time + inline drag/delete */}
            <View style={styles.cardBottomRow}>
              <View style={styles.timeToken}>
                <View style={[styles.timeTokenBar, {
                  backgroundColor: isExpired ? theme.colors.onSurfaceVariant : theme.colors.primary,
                  opacity: isExpired ? 0.2 : 0.65,
                }]} />
                <Text style={[styles.timeTokenText, {
                  color: isExpired ? theme.colors.onSurfaceVariant : theme.colors.onSurface,
                }]}>
                  {formatInTimeZone(item.start_time, itemTz)} – {formatInTimeZone(item.end_time, itemTz)}
                </Text>
              </View>
              <View style={styles.inlineActions}>
                <TouchableOpacity
                  onPressIn={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    drag();
                  }}
                  hitSlop={{ top: 12, bottom: 12, left: 8, right: 4 }}
                >
                  <MaterialCommunityIcons
                    name="dots-grid"
                    size={14}
                    color={theme.colors.onSurfaceVariant}
                    style={{ opacity: 0.48 }}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => deleteConfirm(item.id!)}
                  hitSlop={{ top: 12, bottom: 12, left: 4, right: 8 }}
                >
                  <MaterialCommunityIcons
                    name="trash-can-outline"
                    size={14}
                    color={theme.colors.error}
                    style={{ opacity: 0.65 }}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>

          {/* ── Expanded: open slots ── */}
          {isExpanded && (
            <View style={[styles.expandedSection, {
              borderTopColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
              backgroundColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.015)",
            }]}>
              {!hasSlots ? (
                <View style={styles.watchingWrap}>
                  <View style={styles.watchingHeader}>
                    <View style={[styles.liveBadge, {
                      backgroundColor: isDark ? "rgba(74,222,128,0.12)" : "rgba(21,128,61,0.08)",
                    }]}>
                      <Text style={[styles.liveBadgeText, { color: theme.colors.primary }]}>LIVE</Text>
                    </View>
                    <Text style={[styles.watchingStatus, { color: theme.colors.onSurface }]}>
                      0 openings found
                    </Text>
                  </View>
                </View>
              ) : (
                <>
                  <Text style={[styles.slotsLabel, { color: theme.colors.onSurfaceVariant }]}>
                    OPEN SLOTS
                  </Text>
                  {visibleSlots.map((notif, idx) => {
                    const teeTime = notif.availability?.tee_time;
                    if (!teeTime) return null;
                    return (
                      <View
                        key={notif.id}
                        style={[
                          styles.slotRow,
                          idx < visibleSlots.length - 1 && {
                            borderBottomWidth: StyleSheet.hairlineWidth,
                            borderBottomColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                          },
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.slotTime, { color: theme.colors.onSurface }]}>
                            {formatInTimeZone(teeTime, itemTz)}
                          </Text>
                          {(notif.availability?.price || notif.availability?.spots_available != null) && (
                            <Text style={[styles.slotMeta, { color: theme.colors.onSurfaceVariant }]}>
                              {notif.availability.price ? `$${notif.availability.price.toFixed(2)}` : ""}
                              {notif.availability.spots_available != null
                                ? `${notif.availability.price ? " · " : ""}${notif.availability.spots_available} spots`
                                : ""}
                            </Text>
                          )}
                        </View>
                        <TouchableOpacity
                          onPress={() => handleBookNow(course.provider_url, teeTime, course.time_zone)}
                          style={[styles.bookBtn, {
                            borderColor: isDark ? "rgba(74,222,128,0.35)" : "rgba(21,128,61,0.28)",
                          }]}
                          activeOpacity={0.72}
                        >
                          <Text style={[styles.bookBtnText, { color: theme.colors.primary }]}>Book</Text>
                          <MaterialCommunityIcons name="arrow-right" size={12} color={theme.colors.primary} style={{ marginLeft: 3 }} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </>
              )}
            </View>
          )}

        </View>
      </ScaleDecorator>
    );
  };

  if (loading && !refreshing && !hasData)
    return (
      <View style={[styles.loadingWrap, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );

  const usagePercent = maxAlerts ? Math.min(alertCount / maxAlerts, 1) : 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={["top"]}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: theme.colors.onBackground }]}>My Alerts</Text>
      </View>

      {/* ── Reorder tip ── */}
      {showReorderTip && alerts.length > 1 && (
        <Animated.View entering={FadeInDown.duration(400).delay(600)} style={styles.tipWrap}>
          <View style={[styles.tipCard, { backgroundColor: theme.colors.primaryContainer }]}>
            <MaterialCommunityIcons name="dots-grid" size={15} color={theme.colors.primary} style={{ marginRight: 8 }} />
            <Text style={[styles.tipText, { color: theme.colors.onPrimaryContainer, flex: 1 }]}>
              Hold the <Text style={{ fontWeight: "700" }}>grid icon</Text> at the bottom of a card to reorder
            </Text>
            <TouchableOpacity onPress={dismissTip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialCommunityIcons name="close" size={14} color={theme.colors.onPrimaryContainer} style={{ opacity: 0.5 }} />
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {/* ── Quota banner ── */}
      {fetchingQuota && !hasData && session ? (
        <View style={styles.skeletonWrap}>
          <Skeleton colorMode={isDark ? "dark" : "light"} width="100%" height={72} radius={14} />
        </View>
      ) : session && hasData ? (
        <Animated.View entering={FadeIn.duration(400)} style={styles.quotaWrap}>
          <View
            style={[
              styles.quotaCard,
              {
                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#fff",
                borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)",
                shadowColor: isDark ? "transparent" : "#101c0f",
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.07,
                shadowRadius: 10,
              },
            ]}
          >
            <View style={styles.quotaTopRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
                  <Text style={[styles.quotaBigNum, { color: theme.colors.onSurface }]}>
                    {alertCount}
                  </Text>
                  <Text style={[styles.quotaOfMax, { color: theme.colors.onSurfaceVariant }]}>
                    /{maxAlerts ?? "∞"}
                  </Text>
                </View>
                <Text style={[styles.quotaSubLabel, { color: theme.colors.onSurfaceVariant }]}>
                  alerts active
                </Text>
              </View>
              {tierName !== "Pro" && !reachedQuota && (
                <TouchableOpacity onPress={() => router.push("/upgrade")} style={styles.upgradeBtn}>
                  <Text style={[styles.upgradeBtnText, { color: theme.colors.primary }]}>Upgrade</Text>
                </TouchableOpacity>
              )}
            </View>
            {maxAlerts != null && (
              maxAlerts <= 10 ? (
                <View style={styles.pipRow}>
                  {Array.from({ length: maxAlerts }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.pip,
                        {
                          backgroundColor: i < alertCount
                            ? theme.colors.primary
                            : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)"),
                        },
                      ]}
                    />
                  ))}
                </View>
              ) : (
                <View style={[styles.progressTrack, {
                  backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)",
                }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.round(usagePercent * 100)}%` as any,
                        backgroundColor: theme.colors.primary,
                      },
                    ]}
                  />
                </View>
              )
            )}
            {reachedQuota && tierName !== "Pro" && (
              <>
                <View style={[styles.quotaFooterDivider, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)" }]} />
                <TouchableOpacity onPress={() => router.push("/upgrade")} style={styles.quotaFooterRow} activeOpacity={0.7}>
                  <Text style={[styles.quotaLimitText, { color: theme.colors.onSurfaceVariant }]}>
                    Alert limit reached
                  </Text>
                  <Text style={[styles.quotaUpgradeLink, { color: theme.colors.primary }]}>Upgrade</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Animated.View>
      ) : null}

      {/* ── Pro promo banner ── */}
      {(!session || tierName === "Free") && (
        <Animated.View entering={FadeIn.delay(250).duration(500)} style={styles.promoWrap}>
          <LinearGradient
            colors={
              isDark
                ? ["#14532D", "#166534", "#15803d"]
                : ["#15803d", "#16a34a", "#22c55e"]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.promoBanner}
          >
            <View style={styles.promoOrb} />
            <View style={styles.promoOrb2} />
            <View style={styles.promoInner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.promoEyebrow}>PRO TRIAL</Text>
                <Text style={styles.promoHeadline}>14 Days Free</Text>
                <Text style={styles.promoSub}>10 alerts · real-time scanning</Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.88}
                onPress={() => {
                  if (!session) router.push("/(auth)/sign-up?redirectTo=/upgrade");
                  else router.push("/upgrade");
                }}
                style={styles.promoBtn}
              >
                <Text style={[styles.promoBtnText, { color: isDark ? "#166534" : "#15803d" }]}>
                  Try Free
                </Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Animated.View>
      )}

      {/* ── Alert list ── */}
      <DraggableFlatList
        data={alerts}
        keyExtractor={(i) => i.id!.toString()}
        renderItem={renderItem}
        onDragEnd={handleDragEnd}
        dragItemOverflow
        activationDistance={10}
        contentContainerStyle={styles.listContent}
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
          alerts.length > 0 && !reachedQuota ? (
            <TouchableOpacity
              onPress={() => router.push("/")}
              activeOpacity={0.72}
              style={styles.addAlertFooter}
            >
              <View style={[styles.addAlertPill, {
                borderColor: isDark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.1)",
              }]}>
                <MaterialCommunityIcons name="plus" size={13} color={theme.colors.primary} />
                <Text style={[styles.addAlertText, { color: theme.colors.onSurfaceVariant }]}>Add alert</Text>
              </View>
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="bell-ring-outline"
              size={40}
              color={theme.colors.primary}
              style={{ marginBottom: 4 }}
            />
            <Text style={[styles.emptyTitle, { color: theme.colors.onSurface }]}>No alerts yet</Text>
            <Text style={[styles.emptySubtitle, { color: theme.colors.onSurfaceVariant }]}>
              Set an alert and we'll watch your tee sheets around the clock.
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/")}
              activeOpacity={0.88}
              style={{ borderRadius: 50, overflow: "hidden", marginTop: 24 }}
            >
              <LinearGradient
                colors={Colors.light.gradients.primary as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.emptyBtn}
              >
                <Text style={styles.emptyBtnText}>Find a Course</Text>
                <MaterialCommunityIcons name="arrow-right" size={15} color="#fff" style={{ marginLeft: 6 }} />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },

  // Card date label
  cardDateLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 5,
    opacity: 0.75,
  },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
    lineHeight: 36,
  },

  // Tip
  tipWrap: { paddingHorizontal: 16, marginBottom: 10 },
  tipCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tipText: { fontSize: 13, lineHeight: 18 },

  // Skeleton
  skeletonWrap: { marginBottom: 12, paddingHorizontal: 16 },

  // Quota card
  quotaWrap: { paddingHorizontal: 16, marginBottom: 12 },
  quotaCard: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderWidth: 1,
  },
  quotaTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  quotaBigNum: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  quotaOfMax: {
    fontSize: 15,
    fontWeight: "500",
  },
  quotaSubLabel: {
    fontSize: 11,
    fontWeight: "400",
    marginTop: 1,
  },
  upgradeBtn: { paddingLeft: 8 },
  upgradeBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  pipRow: {
    flexDirection: "row",
    gap: 4,
  },
  pip: {
    flex: 1,
    height: 5,
    borderRadius: 100,
  },
  progressTrack: {
    height: 5,
    borderRadius: 100,
    overflow: "hidden",
  },
  progressFill: {
    height: 5,
    borderRadius: 100,
  },
  quotaFooterDivider: { height: StyleSheet.hairlineWidth, marginTop: 12 },
  quotaFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
  },
  quotaLimitText: { fontSize: 12, fontWeight: "500" },
  quotaUpgradeLink: { fontSize: 12, fontWeight: "700" },

  // Promo banner
  promoWrap: { paddingHorizontal: 16, marginBottom: 12 },
  promoBanner: {
    borderRadius: 16,
    overflow: "hidden",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  promoOrb: {
    position: "absolute",
    right: -25,
    top: -35,
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  promoOrb2: {
    position: "absolute",
    right: 50,
    bottom: -45,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  promoInner: {
    flexDirection: "row",
    alignItems: "center",
  },
  promoEyebrow: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  promoHeadline: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.4,
    lineHeight: 22,
  },
  promoSub: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  promoBtn: {
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 50,
    marginLeft: 14,
  },
  promoBtnText: {
    fontSize: 13,
    fontWeight: "800",
  },

  // List
  listContent: { paddingHorizontal: 16, paddingBottom: 160 },

  // Alert card
  alertCard: {
    borderRadius: 18,
    marginBottom: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 4,
  },
  courseName: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.3,
    lineHeight: 20,
    flex: 1,
    marginRight: 10,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    paddingTop: 1,
  },
  expiredLabel: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 10,
  },
  metaLine: {
    fontSize: 12,
    fontWeight: "400",
    lineHeight: 17,
  },
  metaDot: {
    fontSize: 12,
    fontWeight: "400",
    opacity: 0.4,
  },
  slotPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10,
  },
  slotPreviewChip: {
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  slotPreviewTime: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  slotPreviewMore: {
    fontSize: 11,
    fontWeight: "500",
    opacity: 0.6,
  },
  cardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timeToken: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  timeTokenBar: {
    width: 2,
    height: 14,
    borderRadius: 2,
  },
  timeTokenText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  inlineActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },

  // Expanded slots
  expandedSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
  },
  watchingWrap: {
    paddingVertical: 2,
    gap: 4,
  },
  watchingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  liveBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  watchingStatus: {
    fontSize: 13,
    fontWeight: "500",
  },
  slotsLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  slotTime: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  slotMeta: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  bookBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 26,
    borderWidth: 1,
  },
  bookBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },


  // Add alert footer
  addAlertFooter: {
    alignItems: "center",
    paddingVertical: 16,
    marginBottom: 12,
  },
  addAlertPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 50,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  addAlertText: {
    fontSize: 13,
    fontWeight: "500",
  },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    fontWeight: "400",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 21,
    maxWidth: 260,
  },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 50,
  },
  emptyBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
});
