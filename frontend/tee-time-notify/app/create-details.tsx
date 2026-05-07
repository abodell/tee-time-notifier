import React, { useState, useRef, useEffect } from "react";
import { createAlert } from "@/lib/api";
import Toast from "react-native-toast-message";
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Text, useTheme, Switch, ActivityIndicator } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import PickerModal from "../components/PickerModal";
import DateTimePicker from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";
import Animated, {
  useSharedValue,
  withSpring,
  useAnimatedStyle,
} from "react-native-reanimated";
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

type PillOption = { value: string; label: string };

const PILL_PADDING = 4;
const PILL_GAP = 4;

function PillGroup({
  options,
  value,
  onChange,
  disabled,
  isDark,
  accent,
}: {
  options: PillOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  isDark: boolean;
  accent: string;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const activeIndex = options.findIndex((o) => o.value === value);
  const thumbX = useSharedValue(0);
  const isFirstLayout = useRef(true);

  const pillWidth =
    trackWidth > 0
      ? (trackWidth - PILL_PADDING * 2 - PILL_GAP * (options.length - 1)) /
        options.length
      : 0;

  useEffect(() => {
    if (pillWidth > 0) {
      const target = activeIndex * (pillWidth + PILL_GAP);
      if (isFirstLayout.current) {
        thumbX.value = target;
        isFirstLayout.current = false;
      } else {
        thumbX.value = withSpring(target, {
          damping: 24,
          stiffness: 320,
          mass: 0.7,
        });
      }
    }
  }, [activeIndex, pillWidth]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  const activeTextColor = isDark ? "#052e16" : "#fff";
  const inactiveTextColor = isDark ? "rgba(255,255,255,0.45)" : "#64748B";

  return (
    <View
      style={[
        pillStyles.track,
        {
          backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9",
          opacity: disabled ? 0.38 : 1,
        },
      ]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      {trackWidth > 0 && (
        <Animated.View
          style={[
            {
              position: "absolute",
              left: PILL_PADDING,
              top: PILL_PADDING,
              bottom: PILL_PADDING,
              width: pillWidth,
              borderRadius: 11,
              backgroundColor: accent,
            },
            thumbStyle,
          ]}
        />
      )}
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => !disabled && onChange(opt.value)}
            activeOpacity={0.75}
            style={pillStyles.pill}
          >
            <Text
              style={[
                pillStyles.pillText,
                {
                  color: active ? activeTextColor : inactiveTextColor,
                  fontWeight: active ? "700" : "500",
                },
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const pillStyles = StyleSheet.create({
  track: {
    flexDirection: "row",
    borderRadius: 14,
    padding: PILL_PADDING,
    gap: PILL_GAP,
  },
  pill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: {
    fontSize: 14,
    letterSpacing: -0.2,
  },
});

export default function CreateDetailsScreen() {
  const { id, name, tierName: tierNameParam } = useLocalSearchParams();
  const router = useRouter();
  const theme = useTheme();

  const [holes, setHoles] = useState<string>("18");
  const [players, setPlayers] = useState<string>("0");
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

  // Picker visibility
  const [dateVisible, setDateVisible] = useState(false);
  const [startVisible, setStartVisible] = useState(false);
  const [endVisible, setEndVisible] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(new Date());
  const [tempStart, setTempStart] = useState<Date>(new Date());
  const [tempEnd, setTempEnd] = useState<Date>(new Date());
  const [timeError, setTimeError] = useState<string | null>(null);

  const isDark = theme.dark;
  const accent = theme.colors.primary;
  const gradColors = isDark
    ? (Colors.dark.gradients.primary as [string, string])
    : (Colors.light.gradients.primary as [string, string]);

  const cardBg = isDark ? "rgba(255,255,255,0.06)" : "#fff";
  const cardBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const dividerColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

  // Validate time fields
  useEffect(() => {
    if (!startTime) {
      setStartValid(false);
      setTimeError(null);
      return;
    }
    const now = new Date();
    const isToday = date && dayjs(date).isSame(dayjs(now), "day");
    if (isToday && dayjs(startTime).isBefore(dayjs(now))) {
      setStartValid(false);
      setEndValid(false);
      setTimeError("Start time has already passed today.");
      return;
    }
    setStartValid(true);

    if (!endTime) {
      setEndValid(false);
      setTimeError(null);
      return;
    }
    if (dayjs(endTime).isBefore(dayjs(startTime))) {
      setEndValid(false);
      setTimeError("End time must be after start time.");
      return;
    }
    setEndValid(true);
    setTimeError(null);
  }, [startTime, endTime, date]);

  React.useEffect(() => {
    const fetchCourseAndProfile = async () => {
      const courseId = Array.isArray(id)
        ? parseInt(id[0])
        : parseInt(id || "0");
      if (courseId) {
        const { data } = await supabase
          .from("courses")
          .select("time_zone")
          .eq("id", courseId)
          .single();
        if (data) setCourse(data);
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        try {
          const baseUrl =
            process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";
          const profileRes = await fetch(
            `${baseUrl}/membership/profile/${session.user.id}`
          );
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
      const tz = course?.time_zone || dayjs.tz.guess();
      const combinedStart =
        date && startTime ? combinedDateAndTime(date, startTime, tz) : null;
      const combinedEnd =
        date && endTime ? combinedDateAndTime(date, endTime, tz) : null;
      const courseId = Array.isArray(id)
        ? parseInt(id[0])
        : parseInt(id || "0");
      if (!courseId) throw new Error("Invalid course ID");

      await createAlert({
        user_id: data.session.user.id,
        holes: parseInt(holes),
        players: players === "0" ? null : parseInt(players),
        course_id: courseId,
        date_from: combinedStart?.startOf("day").toISOString(),
        date_to: combinedEnd?.startOf("day").toISOString(),
        start_time: combinedStart?.toISOString(),
        end_time: combinedEnd?.toISOString(),
        is_recurring: tierName === "Pro" ? isRecurring : false,
      });

      Toast.show({
        type: "success",
        text1: "Alert created successfully!",
        position: "top",
        visibilityTime: 2000,
      });
      setTimeout(() => router.push("/(tabs)/my-alerts"), 600);
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
  const isPaidTier = tierName === "Plus" || tierName === "Pro";

  const labelColor = theme.colors.onSurfaceVariant;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.container}>
        {/* ── Nav row ── */}
        <View style={styles.navRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.75}
            style={[
              styles.backBtn,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(0,0,0,0.05)",
                borderColor: cardBorder,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={18}
              color={theme.colors.onSurface}
            />
          </TouchableOpacity>
          <Text
            style={[
              styles.navTitle,
              { color: theme.colors.onSurface },
            ]}
            numberOfLines={1}
          >
            {name || "Create Alert"}
          </Text>
          {/* Spacer to balance the back button */}
          <View style={styles.navSpacer} />
        </View>

        {/* ── HOLES ── */}
        <Text style={[styles.sectionLabel, { color: labelColor }]}>HOLES</Text>
        <View style={styles.section}>
          <PillGroup
            options={[
              { value: "9", label: "9 Holes" },
              { value: "18", label: "18 Holes" },
            ]}
            value={holes}
            onChange={setHoles}
            isDark={isDark}
            accent={accent}
          />
        </View>

        {/* ── PLAYERS ── */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionLabel, { color: labelColor }]}>
            PLAYERS
          </Text>
          {!isPaidTier && tierName !== null && (
            <TouchableOpacity
              onPress={() => router.push("/upgrade")}
              style={[styles.lockChip, { backgroundColor: `${accent}18` }]}
            >
              <MaterialCommunityIcons
                name="lock-outline"
                size={11}
                color={accent}
              />
              <Text style={[styles.lockChipText, { color: accent }]}>
                Upgrade
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.section}>
          <PillGroup
            options={[
              { value: "0", label: "Any" },
              { value: "1", label: "1" },
              { value: "2", label: "2" },
              { value: "3", label: "3" },
              { value: "4", label: "4" },
            ]}
            value={players}
            onChange={setPlayers}
            disabled={!isPaidTier && tierName !== null}
            isDark={isDark}
            accent={accent}
          />
        </View>

        {/* ── TIME WINDOW ── */}
        <Text style={[styles.sectionLabel, { color: labelColor }]}>
          TIME WINDOW
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: cardBg, borderColor: cardBorder },
            styles.section,
          ]}
        >
          {/* Date row */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              setTempDate(date || new Date());
              setDateVisible(true);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <MaterialCommunityIcons
                name="calendar-outline"
                size={16}
                color={labelColor}
                style={styles.rowIcon}
              />
              <Text style={[styles.rowLabel, { color: labelColor }]}>Date</Text>
            </View>
            <Text
              style={[
                styles.rowValue,
                {
                  color: date
                    ? theme.colors.onSurface
                    : theme.colors.onSurfaceVariant,
                },
              ]}
            >
              {date ? dayjs(date).format("MMM D, YYYY") : "Select"}
            </Text>
          </TouchableOpacity>

          <View
            style={[styles.divider, { backgroundColor: dividerColor }]}
          />

          {/* Start time row */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              setTempStart(startTime || new Date());
              setStartVisible(true);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <MaterialCommunityIcons
                name="weather-sunset-up"
                size={16}
                color={labelColor}
                style={styles.rowIcon}
              />
              <Text style={[styles.rowLabel, { color: labelColor }]}>
                Start
              </Text>
            </View>
            <Text
              style={[
                styles.rowValue,
                {
                  color: startTime
                    ? theme.colors.onSurface
                    : theme.colors.onSurfaceVariant,
                },
              ]}
            >
              {startTime ? dayjs(startTime).format("h:mm A") : "Select"}
            </Text>
          </TouchableOpacity>

          <View
            style={[styles.divider, { backgroundColor: dividerColor }]}
          />

          {/* End time row */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              setTempEnd(endTime || new Date());
              setEndVisible(true);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <MaterialCommunityIcons
                name="weather-sunset-down"
                size={16}
                color={labelColor}
                style={styles.rowIcon}
              />
              <Text style={[styles.rowLabel, { color: labelColor }]}>End</Text>
            </View>
            <Text
              style={[
                styles.rowValue,
                {
                  color: endTime
                    ? theme.colors.onSurface
                    : theme.colors.onSurfaceVariant,
                },
              ]}
            >
              {endTime ? dayjs(endTime).format("h:mm A") : "Select"}
            </Text>
          </TouchableOpacity>
        </View>
        {timeError ? (
          <Text style={[styles.errorText, { color: theme.colors.error }]}>
            {timeError}
          </Text>
        ) : null}

        {/* ── AUTOMATION ── */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionLabel, { color: labelColor }]}>
            AUTOMATION
          </Text>
          {tierName !== "Pro" && tierName !== null && (
            <TouchableOpacity
              onPress={() => router.push("/upgrade")}
              style={[styles.lockChip, { backgroundColor: `${accent}18` }]}
            >
              <MaterialCommunityIcons
                name="lock-outline"
                size={11}
                color={accent}
              />
              <Text style={[styles.lockChipText, { color: accent }]}>Upgrade</Text>
            </TouchableOpacity>
          )}
        </View>
        <View
          style={[
            styles.card,
            styles.section,
            {
              backgroundColor: cardBg,
              borderColor: cardBorder,
              opacity: tierName !== "Pro" && tierName !== null ? 0.4 : 1,
            },
          ]}
        >
          <View pointerEvents={tierName === "Pro" ? "auto" : "none"}>
            <View style={[styles.row, { minHeight: 52 }]}>
              <View style={styles.rowLeft}>
                <MaterialCommunityIcons
                  name="refresh-auto"
                  size={16}
                  color={tierName === "Pro" ? accent : labelColor}
                  style={styles.rowIcon}
                />
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text
                    style={[
                      styles.rowLabel,
                      { color: theme.colors.onSurface },
                    ]}
                  >
                    Recurring Alert
                  </Text>
                  <Text
                    style={[styles.rowMeta, { color: labelColor }]}
                  >
                    Automatically repeats for the same window each week
                  </Text>
                </View>
              </View>
              <Switch
                value={isRecurring}
                onValueChange={setIsRecurring}
                color={accent}
                disabled={tierName !== "Pro"}
              />
            </View>
          </View>
        </View>

        {/* ── Submit ── */}
        <View style={styles.submitWrap}>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={buttonDisabled}
            activeOpacity={0.82}
          >
            <LinearGradient
              colors={
                buttonDisabled
                  ? isDark
                    ? ["rgba(255,255,255,0.08)", "rgba(255,255,255,0.08)"]
                    : ["#E2E8F0", "#E2E8F0"]
                  : gradColors
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitButton}
            >
              {submitting ? (
                <ActivityIndicator animating size="small" color="#fff" />
              ) : (
                <View style={styles.submitInner}>
                  <MaterialCommunityIcons
                    name="bell-plus-outline"
                    size={17}
                    color={
                      buttonDisabled
                        ? isDark
                          ? "rgba(255,255,255,0.25)"
                          : "#94A3B8"
                        : "#fff"
                    }
                  />
                  <Text
                    style={[
                      styles.submitText,
                      {
                        color: buttonDisabled
                          ? isDark
                            ? "rgba(255,255,255,0.25)"
                            : "#94A3B8"
                          : "#fff",
                      },
                    ]}
                  >
                    Create Alert
                  </Text>
                </View>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Picker modals ── */}
      <PickerModal
        visible={dateVisible}
        title="Select Date"
        onClose={() => setDateVisible(false)}
        onConfirm={() => {
          setDate(tempDate);
          setDateVisible(false);
        }}
      >
        <View
          style={{
            backgroundColor: isDark ? theme.colors.surface : "#fff",
            borderRadius: 12,
            paddingVertical: 4,
          }}
        >
          <DateTimePicker
            value={tempDate}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            themeVariant={isDark ? "dark" : "light"}
            minimumDate={new Date()}
            onChange={(_, d) => {
              if (d) setTempDate(d);
            }}
          />
        </View>
      </PickerModal>

      <PickerModal
        visible={startVisible}
        title="Start Time"
        onClose={() => setStartVisible(false)}
        onConfirm={() => {
          setStartTime(tempStart);
          setStartVisible(false);
        }}
      >
        <View
          style={{
            backgroundColor: isDark ? theme.colors.surface : "#fff",
            borderRadius: 12,
            paddingVertical: 4,
          }}
        >
          <DateTimePicker
            value={tempStart}
            mode="time"
            display="spinner"
            is24Hour={false}
            themeVariant={isDark ? "dark" : "light"}
            onChange={(_, t) => {
              if (t) setTempStart(t);
            }}
          />
        </View>
      </PickerModal>

      <PickerModal
        visible={endVisible}
        title="End Time"
        onClose={() => setEndVisible(false)}
        onConfirm={() => {
          setEndTime(tempEnd);
          setEndVisible(false);
        }}
      >
        <View
          style={{
            backgroundColor: isDark ? theme.colors.surface : "#fff",
            borderRadius: 12,
            paddingVertical: 4,
          }}
        >
          <DateTimePicker
            value={tempEnd}
            mode="time"
            display="spinner"
            is24Hour={false}
            themeVariant={isDark ? "dark" : "light"}
            onChange={(_, t) => {
              if (t) setTempEnd(t);
            }}
          />
        </View>
      </PickerModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },

  // Nav
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  navTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginHorizontal: 8,
  },
  navSpacer: {
    width: 38,
    flexShrink: 0,
  },

  // Section labels
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    marginLeft: 4,
  },
  lockChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 3,
    marginRight: 4,
  },
  lockChipText: {
    fontSize: 11,
    fontWeight: "700",
  },

  section: {
    marginBottom: 16,
  },

  // Cards (profile-style)
  card: {
    borderRadius: 18,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    justifyContent: "space-between",
    minHeight: 52,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  rowIcon: {
    marginRight: 10,
    opacity: 0.7,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "400",
  },
  rowMeta: {
    fontSize: 12,
    fontWeight: "400",
    marginTop: 1,
  },
  rowValue: {
    fontSize: 15,
    fontWeight: "500",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
  errorText: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: -10,
    marginBottom: 12,
    marginLeft: 4,
  },

  // Submit
  submitWrap: {
    marginTop: "auto" as any,
  },
  submitButton: {
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  submitInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  submitText: {
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: -0.2,
  },
});
