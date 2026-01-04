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
  const { id, name } = useLocalSearchParams();
  const router = useRouter();
  const theme = useTheme();
  const { width } = useWindowDimensions();

  const [holes, setHoles] = useState<string>("18");
  const [date, setDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [course, setCourse] = useState<any>(null);
  const [startValid, setStartValid] = useState(false);
  const [endValid, setEndValid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    const fetchCourse = async () => {
      const courseId = Array.isArray(id) ? parseInt(id[0]) : parseInt(id || "0");
      if (courseId) {
        const { data } = await supabase
          .from("courses")
          .select("time_zone")
          .eq("id", courseId)
          .single();
        if (data) setCourse(data);
      }
    };
    fetchCourse();
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
        course_id: courseId,
        date_from: combinedStart?.startOf("day").toISOString(),
        date_to: combinedEnd?.startOf("day").toISOString(),
        start_time: combinedStart?.toISOString(),
        end_time: combinedEnd?.toISOString(),
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
            style={[
              styles.groupedSurface,
              { backgroundColor: theme.colors.surface },
            ]}
            elevation={0}
          >
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
          </Surface>
        </View>

        {/* Grouped Form: Window */}
        <View style={styles.sectionContainer}>
          <Text style={[styles.sectionLabel, { color: onSurfaceVariant }]}>
            TIME WINDOW
          </Text>
          <Surface
            style={[
              styles.groupedSurface,
              { backgroundColor: theme.colors.surface, padding: 16 },
            ]}
            elevation={0}
          >
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
    overflow: "hidden",
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