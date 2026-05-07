import React, { useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  DeviceEventEmitter,
  Keyboard,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Text,
  TextInput,
  ActivityIndicator,
  useTheme,
  Button,
} from "react-native-paper";
import Animated, { FadeIn } from "react-native-reanimated";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Skeleton } from "moti/skeleton";
import { supabase } from "../../lib/supabase";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";
import GolfEmptyState from "@/components/icons/GolfEmptyState";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ONBOARDING_KEY } from "@/app/onboarding";

type Course = {
  id: number;
  name: string;
  city: string;
  state: string;
  provider: string;
};

interface MembershipTierInfo {
  name: string;
  max_alerts: number | null;
}

const AVATAR_GRAD_START = "#052e16";
const AVATAR_GRAD_END = "#14532d";

export default function CourseSearchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const isDark = theme.dark;

  const accent = theme.colors.primary;

  const [query, setQuery] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [debouncing, setDebouncing] = useState(false);

  const [tierName, setTierName] = useState<string>("—");
  const [maxAlerts, setMaxAlerts] = useState<number | null>(null);
  const [alertCount, setAlertCount] = useState<number>(0);
  const [session, setSession] = useState<any>(null);

  const [fetchingQuota, setFetchingQuota] = useState(true);
  const [hasData, setHasData] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadQuotaData();
    }, [])
  );

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: authSub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      loadQuotaData();
    });

    const sub1 = DeviceEventEmitter.addListener("alertsUpdated", () => {
      loadQuotaData();
    });
    const sub2 = DeviceEventEmitter.addListener("membershipUpdated", () => {
      loadQuotaData();
    });
    return () => {
      sub1.remove();
      sub2.remove();
      authSub.subscription.unsubscribe();
    };
  }, []);

  const loadQuotaData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setFetchingQuota(false);
        setHasData(false);
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
      const tier = profile.membership_tiers as MembershipTierInfo;
      setTierName(tier?.name || "—");
      setMaxAlerts(tier?.max_alerts ?? null);

      const userAlerts = await alertsRes.json();
      setAlertCount(userAlerts?.length || 0);

      setHasData(true);
    } catch (err) {
      console.log("Quota load failed", err);
    } finally {
      setFetchingQuota(false);
    }
  };

  const reachedQuota =
    maxAlerts !== null && alertCount >= (maxAlerts || 0) && hasData;
  const usagePercent = maxAlerts ? Math.min(alertCount / maxAlerts, 1) : 0;

  const fetchCourses = async (search: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("courses")
      .select("id, name, city, state, provider")
      .ilike("name_city_state", `%${search.trim()}%`)
      .limit(25);
    if (!error) setCourses(data || []);
    setLoading(false);
  };

  React.useEffect(() => {
    if (!query.trim()) {
      setCourses([]);
      setDebouncing(false);
      return;
    }
    const t = setTimeout(() => {
      fetchCourses(query);
      setDebouncing(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query, reachedQuota]);

  const handleSelectCourse = (course: Course) => {
    Keyboard.dismiss();
    if (reachedQuota) {
      Alert.alert(
        "Alert Limit Reached",
        tierName === "Pro"
          ? "You've used all your alert slots. Remove an existing alert to track a new course."
          : "You've reached your plan's alert limit. Upgrade to add more.",
        tierName === "Pro"
          ? [
              { text: "Manage Alerts", onPress: () => router.push("/(tabs)/my-alerts") },
              { text: "OK", style: "cancel" },
            ]
          : [
              { text: "Manage Alerts", onPress: () => router.push("/(tabs)/my-alerts") },
              { text: "Upgrade", onPress: () => router.push("/upgrade") },
            ]
      );
      return;
    }
    router.push({
      pathname: "/create-details",
      params: { id: course.id, name: course.name, tierName },
    });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.container}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: theme.colors.onBackground }]}>
            Find a Course
          </Text>
          <Text style={[styles.headerSub, { color: theme.colors.onSurfaceVariant }]}>
            Search by name or city to set an alert.
          </Text>
          {__DEV__ && (
            <TouchableOpacity
              onPress={async () => {
                await AsyncStorage.removeItem(ONBOARDING_KEY);
                router.replace("/onboarding" as any);
              }}
              style={{ marginTop: 8 }}
            >
              <Text style={{ color: "red", fontSize: 12 }}>[DEV] Reset onboarding</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Quota card ── */}
        {fetchingQuota && !hasData && session ? (
          <View style={styles.quotaWrap}>
            <Skeleton colorMode={isDark ? "dark" : "light"} width="100%" height={72} radius={18} />
          </View>
        ) : session && hasData ? (
          <Animated.View entering={FadeIn.duration(400)} style={styles.quotaWrap}>
            <View
              style={[
                styles.quotaCard,
                {
                  backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#fff",
                  borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)",
                  shadowColor: isDark ? "transparent" : "#000",
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
                    <Text style={[styles.upgradeBtnText, { color: accent }]}>Upgrade</Text>
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
                            backgroundColor:
                              i < alertCount
                                ? accent
                                : isDark
                                ? "rgba(255,255,255,0.08)"
                                : "rgba(0,0,0,0.07)",
                          },
                        ]}
                      />
                    ))}
                  </View>
                ) : (
                  <View
                    style={[
                      styles.progressTrack,
                      {
                        backgroundColor: isDark
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(0,0,0,0.07)",
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.round(usagePercent * 100)}%` as any,
                          backgroundColor: accent,
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
                    <Text style={[styles.quotaUpgradeLink, { color: accent }]}>Upgrade</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </Animated.View>
        ) : null}

        {/* ── Pro promo banner ── */}
        {(!session || tierName === "Free") && (
          <Animated.View entering={FadeIn.delay(300).duration(500)} style={styles.promoWrap}>
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
                    if (!session) {
                      router.push("/(auth)/sign-up?redirectTo=/upgrade");
                    } else {
                      router.push("/upgrade");
                    }
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

        {/* ── Search bar ── */}
        <View style={styles.searchWrap}>
          <TextInput
            placeholder="Search courses..."
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setDebouncing(text.trim().length > 0);
            }}
            mode="outlined"
            left={<TextInput.Icon icon="magnify" color={theme.colors.onSurfaceVariant} />}
            style={[
              styles.searchBar,
              { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : theme.colors.surface },
            ]}
            outlineStyle={{
              borderRadius: 14,
              borderWidth: isDark ? 1 : 0,
              borderColor: isDark ? "rgba(255,255,255,0.08)" : "transparent",
            }}
            textColor={theme.colors.onSurface}
            placeholderTextColor={theme.colors.onSurfaceVariant}
            returnKeyType="search"
          />
        </View>

        {/* ── Results / Loading / Empty ── */}
        {loading || debouncing ? (
          <View style={styles.skeletonWrap}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <Skeleton
                  colorMode={isDark ? "dark" : "light"}
                  width="100%"
                  height={68}
                  radius={18}
                />
              </View>
            ))}
          </View>
        ) : (
          <FlatList
            data={courses}
            keyExtractor={(item) => item.id.toString()}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            renderItem={({ item, index }) => (
              <Animated.View entering={FadeIn.delay(index * 45).duration(320)}>
                <TouchableOpacity
                  activeOpacity={0.72}
                  onPress={() => handleSelectCourse(item)}
                  style={[
                    styles.courseCard,
                    {
                      backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#FAFAFA",
                      borderColor: isDark
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(0,0,0,0.06)",
                    },
                  ]}
                >
                  {/* Layered course badge */}
                  <View style={styles.courseBadge}>
                    <LinearGradient
                      colors={[AVATAR_GRAD_START, AVATAR_GRAD_END]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    {/* Inner refraction border */}
                    <View style={styles.courseBadgeInner} />
                    <MaterialCommunityIcons
                      name="flag-variant"
                      size={22}
                      color="rgba(255,255,255,0.88)"
                    />
                  </View>

                  {/* Course info */}
                  <View style={styles.courseInfo}>
                    <Text
                      style={[
                        styles.courseName,
                        { color: isDark ? "#F1F5F9" : "#1E293B" },
                      ]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <View style={styles.courseMeta}>
                      <Text
                        style={[
                          styles.courseLocationText,
                          {
                            color: isDark
                              ? "rgba(255,255,255,0.42)"
                              : "#64748B",
                          },
                        ]}
                      >
                        {item.city}, {item.state}
                      </Text>
                    </View>
                  </View>

                  {/* Arrow chip */}
                  <View
                    style={[
                      styles.courseArrowChip,
                      { backgroundColor: `${accent}18` },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="arrow-right"
                      size={13}
                      color={accent}
                    />
                  </View>
                </TouchableOpacity>
              </Animated.View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                {query.trim() ? (
                  <View style={{ alignItems: "center" }}>
                    {/* Stacked icon treatment */}
                    <View style={styles.emptyIconStack}>
                      <LinearGradient
                        colors={
                          isDark
                            ? ["rgba(255,255,255,0.06)", "rgba(255,255,255,0.03)"]
                            : ["#F1F5F9", "#E2E8F0"]
                        }
                        style={StyleSheet.absoluteFillObject}
                      />
                      <View
                        style={[
                          StyleSheet.absoluteFillObject,
                          styles.emptyIconStackBorder,
                          {
                            borderColor: isDark
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(0,0,0,0.06)",
                          },
                        ]}
                      />
                      <MaterialCommunityIcons
                        name="golf"
                        size={26}
                        color={
                          isDark
                            ? "rgba(255,255,255,0.2)"
                            : "rgba(0,0,0,0.15)"
                        }
                      />
                      <View
                        style={[
                          styles.emptyBadgeDot,
                          { backgroundColor: accent },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name="close"
                          size={8}
                          color="#0D1B26"
                        />
                      </View>
                    </View>
                    <Text
                      style={[
                        styles.emptyTitle,
                        { color: isDark ? "#F1F5F9" : "#1E293B" },
                      ]}
                    >
                      No courses found
                    </Text>
                    <Text
                      style={[
                        styles.emptySubtitle,
                        {
                          color: isDark
                            ? "rgba(255,255,255,0.42)"
                            : "#64748B",
                        },
                      ]}
                    >
                      Try a different name or city
                    </Text>
                  </View>
                ) : (
                  <View style={{ alignItems: "center" }}>
                    <GolfEmptyState isDark={isDark} width={192} height={122} />
                    <Text
                      style={[
                        styles.emptyTitle,
                        { color: isDark ? "#F1F5F9" : "#1E293B" },
                      ]}
                    >
                      Find your course
                    </Text>
                    <Text
                      style={[
                        styles.emptySubtitle,
                        {
                          color: isDark
                            ? "rgba(255,255,255,0.42)"
                            : "#64748B",
                        },
                      ]}
                    >
                      Type a course name or city above
                    </Text>
                  </View>
                )}
                <Button
                  mode="text"
                  onPress={() =>
                    session ? router.push("/request-course") : router.push("/upgrade")
                  }
                  style={{ marginTop: 12 }}
                  textColor={accent}
                  labelStyle={{ fontWeight: "600" }}
                >
                  {session ? "Can't find your course?" : "View Pricing & Memberships"}
                </Button>
              </View>
            }
            ListFooterComponent={
              courses.length > 0 ? (
                <View style={{ paddingVertical: 24, alignItems: "center" }}>
                  <Button
                    mode="text"
                    onPress={() =>
                      session ? router.push("/request-course") : router.push("/upgrade")
                    }
                    textColor={accent}
                    labelStyle={{ fontSize: 13, fontWeight: "600" }}
                  >
                    {session ? "Can't find your course?" : "View Pricing & Memberships"}
                  </Button>
                </View>
              ) : null
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1 },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  headerSub: {
    fontSize: 14,
    fontWeight: "400",
    marginTop: 3,
    lineHeight: 20,
  },

  // Quota card
  quotaWrap: { paddingHorizontal: 16, marginBottom: 12 },
  quotaCard: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
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

  // Search
  searchWrap: { paddingHorizontal: 16, marginBottom: 12 },
  searchBar: {
    height: 46,
    fontSize: 16,
  },

  // Loading skeletons
  skeletonWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 4,
  },

  // Course card
  courseCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 13,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 8,
  },
  courseBadge: {
    width: 46,
    height: 46,
    borderRadius: 14,
    marginRight: 13,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  courseBadgeInner: {
    position: "absolute",
    inset: 0,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.18)",
  },
  courseInfo: { flex: 1, minWidth: 0 },
  courseName: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  courseMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
    flexWrap: "nowrap",
  },
  courseLocationText: {
    fontSize: 12,
    fontWeight: "400",
  },
  courseArrowChip: {
    width: 28,
    height: 28,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },

  // Empty state
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 48,
    paddingBottom: 100,
  },
  emptyIconStack: {
    width: 72,
    height: 72,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 1,
    position: "relative",
  },
  emptyIconStackBorder: {
    position: "absolute",
    inset: 0,
    borderRadius: 22,
    borderWidth: 1,
  },
  emptyBadgeDot: {
    position: "absolute",
    bottom: 10,
    right: 10,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    fontWeight: "400",
    textAlign: "center",
    marginTop: 4,
    lineHeight: 20,
    maxWidth: 240,
  },
});
