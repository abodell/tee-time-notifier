import React, { useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import {
  View,
  FlatList,
  StyleSheet,
  Platform,
  TouchableOpacity,
  DeviceEventEmitter,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Text,
  TextInput,
  ActivityIndicator,
  useTheme,
  Surface,
  IconButton,
  Button,
} from "react-native-paper";
import Animated, { FadeIn } from "react-native-reanimated";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Skeleton } from "moti/skeleton";
import { supabase } from "../../lib/supabase";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";
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

export default function CourseSearchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const isDark = theme.dark;

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

  // Listen for global alert updates (e.g. from My Alerts deletion)
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

      // Only show skeleton if we don't have data yet
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
    if (!query.trim() || reachedQuota) {
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
    router.push({
      pathname: "/create-details",
      params: { id: course.id, name: course.name },
    });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text variant="headlineMedium" style={{ fontWeight: "700", color: theme.colors.onBackground }}>
            Find a Course
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
            Search for a course to start tracking.
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

        {/* Search Bar */}
        <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <TextInput
            placeholder="Search courses..."
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setDebouncing(text.trim().length > 0);
            }}
            mode="outlined"
            left={<TextInput.Icon icon="magnify" color={theme.colors.onSurfaceVariant} />}
            style={[styles.searchBar, { backgroundColor: theme.colors.surface }]}
            outlineStyle={{ borderRadius: 12, borderWidth: 0 }}
            textColor={theme.colors.onSurface}
            placeholderTextColor={theme.colors.onSurfaceVariant}
            disabled={reachedQuota}
            returnKeyType="search"
          />
        </View>

        {/* Content */}
        {reachedQuota ? (
          <View style={styles.center}>
            <MaterialCommunityIcons name="lock-outline" size={48} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.5 }} />
            <Text style={{ textAlign: "center", color: theme.colors.onSurfaceVariant, marginTop: 16, maxWidth: 250 }}>
              Upgrade your plan to track more courses and never miss a tee time.
            </Text>
          </View>
        ) : loading || debouncing ? (
          <View style={styles.center}>
            <ActivityIndicator animating color={theme.colors.primary} />
          </View>
        ) : (
          <FlatList
            data={courses}
            keyExtractor={(item) => item.id.toString()}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.colors.onSurface + "12", marginLeft: 16 }} />}
            renderItem={({ item, index, separators }) => (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => handleSelectCourse(item)}
                style={[
                  styles.listItem,
                  {
                    backgroundColor: theme.colors.surface,
                    borderTopLeftRadius: index === 0 ? 12 : 0,
                    borderTopRightRadius: index === 0 ? 12 : 0,
                    borderBottomLeftRadius: index === courses.length - 1 ? 12 : 0,
                    borderBottomRightRadius: index === courses.length - 1 ? 12 : 0,
                  }
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="titleMedium" style={{ fontWeight: "600", color: theme.colors.onSurface }}>
                    {item.name}
                  </Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
                    {item.city}, {item.state}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.5 }} />
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={[styles.center, { marginTop: 40 }]}>
                {query.trim() ? (
                  <View style={{ alignItems: "center" }}>
                    <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: "center", marginBottom: 16 }}>
                      No courses found matching "{query}"
                    </Text>
                  </View>
                ) : (
                  <View style={{ alignItems: "center", opacity: 0.6 }}>
                    <MaterialCommunityIcons name="golf" size={48} color={theme.colors.onSurfaceVariant} />
                    <Text style={{ marginTop: 16, color: theme.colors.onSurfaceVariant }}>
                      Start typing to search
                    </Text>
                  </View>
                )}
                <Button
                  mode="text"
                  onPress={() => session ? router.push("/request-course") : router.push("/upgrade")}
                  style={{ marginTop: 12 }}
                  textColor={theme.colors.primary}
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
                    onPress={() => session ? router.push("/request-course") : router.push("/upgrade")}
                    textColor={theme.colors.primary}
                    labelStyle={{ fontSize: 13, opacity: 1 }}
                  >
                    {session ? "Can't find your course?" : "View Pricing & Memberships"}
                  </Button>
                </View>
              ) : null
            }
          />
        )}
      </View>
    </SafeAreaView >
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
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
  searchBar: {
    height: 46,
    fontSize: 16,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 100 },
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