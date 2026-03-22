import React, { useState } from "react";
import { createAlert } from "@/lib/api";
import Toast from "react-native-toast-message";
import {
  StyleSheet,
  View,
  ScrollView,
  useWindowDimensions,
  TouchableOpacity,
  Platform,
} from "react-native";
import {
  Text,
  SegmentedButtons,
  Button,
  IconButton,
  useTheme,
  Divider,
  Surface,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { Switch } from "react-native-paper";
import DatePickerField from "../components/DatePickerField";
import TimePickerField from "../components/TimePickerField";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

function combinedDateAndTime(date: Date, time: Date, tz: string) {
  const datePart = dayjs(date).format("YYYY-MM-DD");
  const timePart = dayjs(time).format("HH:mm:ss");
  return dayjs.tz(`${datePart} ${timePart}`, tz);
}

export default function CreateDetailsScreen() {
  const { id, name, tierName: tierNameParam } = useLocalSearchParams();
  const router = useRouter();
  const theme = useTheme();
  const { width } = useWindowDimensions();

  const [holes, setHoles] = useState<string>("18");
  const [players, setPlayers] = useState<string>("0"); // "0" = Any
  const [date, setDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [course, setCourse] = useState<any>(null);
  const [startValid, setStartValid] = useState(false);
  const [endValid, setEndValid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [tierName, setTierName] = useState<string | null>(
    typeof tierNameParam === "string" ? tierNameParam : null
  );

  React.useEffect(() => {
    const fetchCourseAndProfile = async () => {
      const courseId = Array.isArray(id) ? parseInt(id[0]) : parseInt(id || "0");
      if (courseId) {
        const { data } = await supabase
          .from("courses")
          .select("time_zone")
          .eq("id", courseId)
          .single();
        if (data) setCourse(data);
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        // Fetch profile to get tier info using the backend endpoint for consistency
        try {
          const baseUrl = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";
          const profileRes = await fetch(`${baseUrl}/membership/profile/${session.user.id}`);
          if (profileRes.ok) {
            const profile = await profileRes.json();
            if (profile?.membership_tiers?.name) {
              setTierName(profile.membership_tiers.name);
            }
          }
        } catch (err) {
          console.log("Failed to load tier info", err);
        }
      }
    };
    fetchCourseAndProfile();
  }, [id]);

  const handleSubmit = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.push("/(auth)/sign-in");
      return;
    }

    try {
      setSubmitting(true);
      // Combine the selected date with the chosen times
      // Use the course's timezone or fallback to local guess
      const tz = course?.time_zone || dayjs.tz.guess();

      const combinedStart =
        date && startTime ? combinedDateAndTime(date, startTime, tz) : null;
      const combinedEnd =
        date && endTime ? combinedDateAndTime(date, endTime, tz) : null;

      // Parse course ID from params
      const courseId = Array.isArray(id) ? parseInt(id[0]) : parseInt(id || "0");
      if (!courseId) throw new Error("Invalid course ID");

      const alertPayload = {
        user_id: data.session.user.id,
        holes: parseInt(holes),
        players: players === "0" ? null : parseInt(players),
        course_id: courseId,
        date_from: combinedStart?.startOf("day").toISOString(),
        date_to: combinedEnd?.startOf("day").toISOString(),
        start_time: combinedStart?.toISOString(),
        end_time: combinedEnd?.toISOString(),
        is_recurring: tierName === "Pro" ? isRecurring : false,
      };
      await createAlert(alertPayload);

      Toast.show({
        type: "success",
        text1: "Alert created successfully!",
        position: "top",
        visibilityTime: 2000,
      });

      // Short pause to let toast appear
      setTimeout(() => {
        // Navigate to My Alerts tab
        router.push("/(tabs)/my-alerts");
      }, 600);
    } catch (err: any) {
      Toast.show({
        type: "error",
        text1: "Failed to create alert",
        text2: err.message,
        position: "top",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const buttonDisabled =
    !date || !startTime || !endTime || !startValid || !endValid || submitting;

  const { onBackground, onSurfaceVariant } = theme.colors;
  const containerWidth = Math.min(width - 32, 480);
  const isDark = theme.dark;

  return (
    <SafeAreaView
      style={[
        styles.safe,
        { backgroundColor: theme.colors.background, alignItems: "center" },
      ]}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { width: containerWidth }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <IconButton
            icon="arrow-left"
            size={24}
            onPress={() => router.back()}
            style={styles.backBtn}
            iconColor={theme.colors.primary}
          />
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text
              variant="titleMedium"
              style={[styles.title, { color: onBackground }]}
              numberOfLines={1}
            >
              {name || "Create Alert"}
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <Text style={[styles.subtitle, { color: onSurfaceVariant }]}>
          Set your preferences for this course.
        </Text>

        {/* Grouped Form: Holes */}
        <View style={styles.sectionContainer}>
          <Text style={[styles.sectionLabel, { color: onSurfaceVariant }]}>
            HOLES
          </Text>
          <Surface
            style={{ backgroundColor: theme.colors.surface, borderRadius: 12 }}
            elevation={0}
          >
            <View style={[styles.groupedSurface, { backgroundColor: theme.colors.surface }]}>
              <SegmentedButtons
                value={holes}
                onValueChange={setHoles}
                buttons={[
                  {
                    value: "9",
                    label: "9 Holes",
                    style: { borderTopLeftRadius: 12, borderBottomLeftRadius: 12 },
                  },
                  {
                    value: "18",
                    label: "18 Holes",
                    style: {
                      borderTopRightRadius: 12,
                      borderBottomRightRadius: 12,
                    },
                  },
                ]}
                style={styles.segmentedBtn}
                density="medium"
              />
            </View>
          </Surface>

        </View>

        {/* Grouped Form: Players */}
        {(() => {
          const isPaidTier = tierName === "Plus" || tierName === "Pro";
          return (
            <View style={styles.sectionContainer}>
              <Text style={[styles.sectionLabel, { color: onSurfaceVariant }]}>
                PLAYERS
              </Text>
              <Surface
                style={{ backgroundColor: theme.colors.surface, borderRadius: 12 }}
                elevation={0}
              >
                <View style={[styles.groupedSurface, { backgroundColor: theme.colors.surface }]}>
                  <View pointerEvents={isPaidTier ? "auto" : "none"} style={{ opacity: isPaidTier ? 1 : 0.4 }}>
                    <SegmentedButtons
                      value={players}
                      onValueChange={setPlayers}
                      buttons={[
                        { value: "1", label: "1", style: { borderTopLeftRadius: 12, borderBottomLeftRadius: 12 } },
                        { value: "2", label: "2" },
                        { value: "3", label: "3" },
                        { value: "4", label: "4", style: { borderTopRightRadius: 12, borderBottomRightRadius: 12 } },
                      ]}
                      style={styles.segmentedBtn}
                      density="medium"
                    />
                  </View>
                </View>

                {!isPaidTier && tierName !== null && (
                  <View style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: theme.colors.surfaceVariant + "40", padding: 12, borderRadius: 8 }}>
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, lineHeight: 18 }}>
                      Filter by group size with Plus or Pro.{" "}
                      <Text
                        style={{ color: theme.colors.primary, fontWeight: "700" }}
                        onPress={() => router.push("/upgrade")}
                      >
                        Upgrade
                      </Text>
                    </Text>
                  </View>
                )}
              </Surface>
            </View>
          );
        })()}

        {/* Grouped Form: Window */}
        <View style={styles.sectionContainer}>
          <Text style={[styles.sectionLabel, { color: onSurfaceVariant }]}>
            TIME WINDOW
          </Text>
          <Surface
            style={{ backgroundColor: theme.colors.surface, borderRadius: 12 }}
            elevation={0}
          >
            <View style={[styles.groupedSurface, { backgroundColor: theme.colors.surface, padding: 16 }]}>

              <View style={{ marginBottom: 16 }}>
                <DatePickerField
                  label="Date"
                  value={date}
                  onChange={setDate}
                />
              </View>
              <Divider style={{ marginBottom: 16, opacity: 0.5 }} />
              <View style={{ marginBottom: 16 }}>
                <TimePickerField
                  label="Start Time"
                  value={startTime}
                  onChange={setStartTime}
                  selectedDate={date}
                  onValidityChange={setStartValid}
                />
              </View>
              <TimePickerField
                label="End Time"
                value={endTime}
                onChange={setEndTime}
                selectedDate={date}
                startTime={startTime}
                onValidityChange={setEndValid}
              />
            </View>
          </Surface>

        </View>

        {/* Grouped Form: Recurring Alert (Pro Only) */}
        <View style={styles.sectionContainer}>
          <Text style={[styles.sectionLabel, { color: onSurfaceVariant }]}>
            AUTOMATION
          </Text>
          <Surface
            style={{ backgroundColor: theme.colors.surface, borderRadius: 12 }}
            elevation={0}
          >
            <View style={[styles.groupedSurface, { backgroundColor: theme.colors.surface, padding: 16 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flex: 1, paddingRight: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                    <Text variant="titleMedium" style={{ fontWeight: "600", color: theme.colors.onSurface }}>
                      Recurring Alert
                    </Text>
                    {tierName === "Pro" && (
                      <View style={{ backgroundColor: theme.colors.primaryContainer, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginLeft: 8 }}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: theme.colors.onPrimaryContainer }}>PRO</Text>
                      </View>
                    )}
                  </View>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    Automatically set this exact same alert for 7 days later once the time window passes.
                  </Text>
                </View>

                <Switch
                  value={isRecurring}
                  onValueChange={(val) => {
                    if (tierName !== "Pro") {
                      // Optional: could auto-route them or show a native alert
                      return;
                    }
                    setIsRecurring(val);
                  }}
                  color={theme.colors.primary}
                  disabled={tierName !== "Pro"}
                />
              </View>

              {/* Pro Nudge if not Pro */}
              {tierName !== "Pro" && tierName !== null && (
                <View style={{ marginTop: 16, backgroundColor: theme.colors.surfaceVariant + "40", padding: 12, borderRadius: 8 }}>
                  <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, lineHeight: 18 }}>
                    Want to automatically repeat this alert every week without hitting your quota?{" "}
                    <Text
                      style={{ color: theme.colors.primary, fontWeight: "700" }}
                      onPress={() => router.push("/upgrade")}
                    >
                      Upgrade to Pro
                    </Text>
                  </Text>
                </View>
              )}
            </View>
          </Surface>
        </View>

        {/* Gradient Action Button */}
        <View style={{ marginTop: 32, marginBottom: 20 }}>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={buttonDisabled}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={
                (buttonDisabled
                  ? [theme.colors.surfaceDisabled, theme.colors.surfaceDisabled]
                  : Colors.light.gradients.primary) as [string, string, ...string[]]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[
                styles.gradientButton,
                { opacity: buttonDisabled ? 0.6 : 1 },
              ]}
            >
              <Text
                style={{
                  color: buttonDisabled
                    ? theme.colors.onSurfaceDisabled
                    : "#FFF",
                  fontWeight: "700",
                  fontSize: 16,
                }}
              >
                {submitting ? "Creating..." : "Create Alert"}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scroll: {
    paddingTop: 10,
    paddingBottom: 40,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    justifyContent: "space-between",
  },
  backBtn: {
    margin: 0,
  },
  title: {
    fontWeight: "700",
    fontSize: 17,
  },
  subtitle: {
    marginBottom: 24,
    textAlign: "center",
    fontSize: 15,
    paddingHorizontal: 20,
  },
  sectionContainer: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    marginLeft: 12,
    textTransform: "uppercase",
    opacity: 0.7,
  },
  groupedSurface: {
    borderRadius: 12,
  },
  segmentedBtn: {
    margin: 16,
  },
  gradientButton: {
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2F80ED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
});