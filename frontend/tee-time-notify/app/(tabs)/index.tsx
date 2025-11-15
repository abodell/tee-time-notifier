import React, { useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import {
  View,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Platform,
} from "react-native";
import {
  Text,
  TextInput,
  Card,
  ActivityIndicator,
  useTheme,
  Surface,
} from "react-native-paper";
import Animated, { FadeIn } from "react-native-reanimated";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Skeleton } from "moti/skeleton";
import { supabase } from "../../lib/supabase";
import { useRouter } from "expo-router";

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

  const [tierName, setTierName] = useState<string>("—");
  const [maxAlerts, setMaxAlerts] = useState<number | null>(null);
  const [alertCount, setAlertCount] = useState<number>(0);

  const [fetchingQuota, setFetchingQuota] = useState(true);
  const [hasData, setHasData] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadQuotaData();
    }, [])
  );

  const loadQuotaData = async () => {
    try {
      // keep placeholder visible during refreshes
      setFetchingQuota(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

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
      .ilike("name", `%${search.trim()}%`)
      .limit(25);
    if (!error) setCourses(data || []);
    setLoading(false);
  };

  React.useEffect(() => {
    if (!query.trim() || reachedQuota) {
      setCourses([]);
      return;
    }
    const t = setTimeout(() => fetchCourses(query), 300);
    return () => clearTimeout(t);
  }, [query, reachedQuota]);

  const handleSelectCourse = (course: Course) => {
    router.push({
      pathname: "/create-details",
      params: { id: course.id, name: course.name },
    });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.container}>
        <Text
          variant="bodyMedium"
          style={{
            color: theme.colors.onSurfaceVariant,
            marginBottom: 14,
            textAlign: "center",
          }}
        >
          Choose a course to monitor for open tee times
        </Text>

        {/* Quota notification or skeleton */}
        {fetchingQuota && !hasData ? (
          <View style={{ marginBottom: 10 }}>
            <Skeleton
              colorMode={isDark ? "dark" : "light"}
              width="100%"
              height={50}
              radius={12}
            />
          </View>
        ) : (
          <Animated.View entering={FadeIn.duration(400)}>
            <Surface style={styles.noticeCard} elevation={1}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View
                  style={{
                    justifyContent: "center",
                    alignItems: "center",
                    height: 24,
                    width: 26,
                    marginRight: 8,
                  }}
                >
                  <MaterialCommunityIcons
                    name={
                      reachedQuota
                        ? "alert-circle-outline"
                        : "information-outline"
                    }
                    size={22}
                    color={
                      reachedQuota
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant
                    }
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: theme.colors.onSurfaceVariant,
                      fontSize: 14,
                      lineHeight: 20,
                    }}
                  >
                    {reachedQuota ? (
                      <>
                        You’ve used all alerts on the{" "}
                        <Text style={{ fontWeight: "600" }}>{tierName}</Text>{" "}
                        plan.{" "}
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
                        <Text style={{ fontWeight: "600" }}>{alertCount}</Text>
                        {maxAlerts ? ` of ${maxAlerts}` : ""} alerts on your{" "}
                        <Text style={{ fontWeight: "600" }}>{tierName}</Text> plan.
                      </>
                    )}
                  </Text>
                </View>
              </View>
            </Surface>
          </Animated.View>
        )}

        {/* Search Field */}
        <TextInput
          label="Search course"
          value={query}
          onChangeText={setQuery}
          mode="outlined"
          right={<TextInput.Icon icon="magnify" />}
          style={[styles.search, { backgroundColor: theme.colors.surface }]}
          textColor={theme.colors.onSurface}
          placeholderTextColor={isDark ? "#ccc" : "#666"}
          disabled={reachedQuota}
        />

        {reachedQuota ? (
          <Text
            style={{
              textAlign: "center",
              color: theme.colors.onSurfaceVariant,
              marginTop: 20,
            }}
          >
            You’ve reached your alert limit — upgrade to add more.
          </Text>
        ) : loading ? (
          <View style={styles.center}>
            <ActivityIndicator animating color={theme.colors.primary} />
          </View>
        ) : (
          <FlatList
            data={courses}
            keyExtractor={(item) => item.id.toString()}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingVertical: 10 }}
            renderItem={({ item }) => (
              <Card
                mode="elevated"
                style={[
                  styles.card,
                  { backgroundColor: isDark ? theme.colors.surface : "#fff" },
                ]}
                onPress={() => handleSelectCourse(item)}
              >
                <Card.Title
                  title={item.name}
                  subtitle={`${item.city}, ${item.state}`}
                  titleStyle={[
                    styles.cardTitle,
                    { color: theme.colors.onSurface },
                  ]}
                  subtitleStyle={[
                    styles.cardSubtitle,
                    { color: isDark ? "#bbb" : "#555" },
                  ]}
                />
              </Card>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },
  noticeCard: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "transparent",
    marginBottom: 10,
  },
  search: { marginBottom: 12 },
  card: {
    marginBottom: 8,
    borderRadius: 10,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.1,
        shadowRadius: 4,
        shadowOffset: { height: 2, width: 0 },
      },
      android: { elevation: 1 },
    }),
  },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  cardSubtitle: { fontSize: 13 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
});