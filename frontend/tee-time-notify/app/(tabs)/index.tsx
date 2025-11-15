import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  SafeAreaView,
  Platform,
} from "react-native";
import {
  Text,
  TextInput,
  Card,
  ActivityIndicator,
  useTheme,
  Button,
  Surface,
} from "react-native-paper";
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

  const [query, setQuery] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);

  // Quota / tier state
  const [tierName, setTierName] = useState<string>("—");
  const [maxAlerts, setMaxAlerts] = useState<number | null>(null);
  const [alertCount, setAlertCount] = useState<number>(0);
  const [fetchingQuota, setFetchingQuota] = useState(true);

  const isDark = theme.dark;

  useEffect(() => {
    loadQuotaData();
  }, []);

  const loadQuotaData = async () => {
    try {
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

      if (!profileRes.ok) {
        const msg = await profileRes.text();
        throw new Error(`Profile request failed: ${msg}`);
      }
      if (!alertsRes.ok) {
        const msg = await alertsRes.text();
        throw new Error(`Alerts request failed: ${msg}`);
      }

      const profileData = await profileRes.json();
      const tier = profileData.membership_tiers as MembershipTierInfo;
      setTierName(tier?.name || "—");
      setMaxAlerts(tier?.max_alerts ?? null);

      const userAlerts = await alertsRes.json();
      setAlertCount(userAlerts?.length || 0);
    } catch (e: any) {
      console.error("Quota loading failed:", e.message);
    } finally {
      setFetchingQuota(false);
    }
  };

  const reachedQuota =
    maxAlerts !== null && alertCount >= (maxAlerts || 0) && !fetchingQuota;

  // Query courses
  useEffect(() => {
    if (!query.trim() || reachedQuota) {
      setCourses([]);
      return;
    }

    const fetchCourses = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("courses")
        .select("id, name, city, state, provider")
        .ilike("name", `%${query.trim()}%`)
        .limit(25);

      if (error) console.error(error);
      else setCourses(data || []);
      setLoading(false);
    };

    const debounce = setTimeout(fetchCourses, 300);
    return () => clearTimeout(debounce);
  }, [query, reachedQuota]);

  const handleSelectCourse = (course: Course) => {
    router.push({
      pathname: "/create-details",
      params: { id: course.id, name: course.name },
    });
  };

  // -------------------------------------------------------------------
  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.container}>
        {/* Subtitle */}
        <Text
          variant="bodyMedium"
          style={{
            color: theme.colors.onSurfaceVariant,
            marginBottom: 14,
          }}
        >
          Choose a course to monitor for open tee times
        </Text>

        {/* Quota or shimmer */}
        {fetchingQuota ? (
          <View style={{ marginBottom: 16 }}>
            <Skeleton
              colorMode={isDark ? "dark" : "light"}
              width="100%"
              height={52}
              radius={12}
            />
          </View>
        ) : (
          <Surface
            style={[
              styles.quotaCard,
              {
                backgroundColor: reachedQuota
                  ? theme.colors.errorContainer
                  : theme.colors.surfaceVariant,
              },
            ]}
          >
            <Text
              style={{
                color: reachedQuota
                  ? theme.colors.onErrorContainer
                  : theme.colors.onSurfaceVariant,
                fontSize: 15,
                textAlign: "center",
                fontWeight: "500",
              }}
            >
              {reachedQuota
                ? `You’ve reached your limit of ${
                    maxAlerts || 0
                  } alerts on the ${tierName} plan.`
                : `You’re using ${alertCount}${
                    maxAlerts ? ` of ${maxAlerts}` : ""
                  } alerts on your ${tierName} plan.`}
            </Text>

            {reachedQuota && (
              <Button
                mode="contained-tonal"
                compact
                style={{ marginTop: 6, borderRadius: 8 }}
                labelStyle={{
                  fontWeight: "600",
                  color: theme.colors.primary,
                }}
                onPress={() => router.push("/upgrade")}
              >
                Upgrade Plan
              </Button>
            )}
          </Surface>
        )}

        {/* Search / Courses */}
        <TextInput
          label="Search course"
          value={query}
          onChangeText={setQuery}
          mode="outlined"
          right={<TextInput.Icon icon="magnify" />}
          style={[
            styles.search,
            {
              backgroundColor: theme.colors.surface,
            },
          ]}
          textColor={theme.colors.onSurface}
          placeholderTextColor={isDark ? "#ccc" : "#666"}
          disabled={reachedQuota}
        />

        {reachedQuota ? (
          <Text
            style={{
              textAlign: "center",
              color: theme.colors.onSurfaceVariant,
              marginTop: 24,
            }}
          >
            Upgrade your plan to add more alerts.
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
                  {
                    backgroundColor: isDark
                      ? theme.colors.surface
                      : "#fff",
                  },
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
            ListEmptyComponent={
              query ? (
                <Text
                  style={[
                    styles.helper,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  No courses found.
                </Text>
              ) : (
                <Text
                  style={[
                    styles.helper,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  Start typing to search courses.
                </Text>
              )
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },
  quotaCard: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
    elevation: 0,
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
  helper: { textAlign: "center", marginTop: 24, fontSize: 14 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
});