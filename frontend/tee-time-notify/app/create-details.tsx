import React, { useState, useRef, useEffect } from "react";
import { createAlert, updateAlert, getAlert } from "@/lib/api";
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
import PressableScale from "@/components/PressableScale";
import { haptics } from "@/lib/haptics";
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

// All UTC <-> course-timezone conversion below uses native Intl.DateTimeFormat
// directly (the same primitive the My Alerts card's formatInTimeZone() uses),
// not dayjs's timezone plugin — which produced inconsistent results in this
// app's JS runtime despite checking out fine in a plain Node test.

function tzParts(utcDate: Date, tz: string) {
  // Only Intl's .format() is used here, never .formatToParts() — Hermes (the
  // JS engine Expo ships) has an incomplete Intl implementation where
  // formatToParts yields unusable output, producing NaN date components.
  // "en-CA" because it formats dates as YYYY-MM-DD, which parses unambiguously.
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(utcDate);
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(utcDate);

  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);

  return {
    year,
    month: month - 1, // Date's month is 0-indexed
    day,
    hour: hour % 24, // some engines render midnight as "24"
    minute,
    second,
  };
}

/**
 * Takes a UTC ISO string and the course's timezone, and returns a "forged"
 * Date whose device-local digits equal the course-local wall-clock time —
 * e.g. a 22:00 UTC / 5pm-Chicago instant becomes a Date that reads "5:00 PM"
 * on screen no matter what timezone the device itself is in. Native pickers
 * only ever render in device-local time, so this is how we get them to show
 * the course's wall-clock time rather than the device's.
 */
function forgeLocalDate(utcIso: string, tz: string): Date {
  const utcDate = new Date(utcIso);
  try {
    const p = tzParts(utcDate, tz);
    const forged = new Date(p.year, p.month, p.day, p.hour, p.minute, p.second);
    if (isNaN(forged.getTime())) throw new Error("forged an invalid date");
    return forged;
  } catch (e) {
    // Never hand an Invalid Date to the pickers — it silently breaks the
    // start/end validation in ways that look like a validation bug.
    console.warn(`Course-timezone conversion failed for ${tz}:`, e);
    return utcDate;
  }
}

/**
 * date_from/date_to are calendar dates, stored as midnight UTC — not real
 * instants. So they're read straight off the UTC digits (never timezone
 * converted, which would shift midnight backwards into the previous day for
 * any western timezone) and re-stamped into a device-local Date for the
 * picker. This matches how the My Alerts card reads them with dayjs.utc().
 */
function forgeLocalCalendarDate(utcIso: string): Date {
  const d = new Date(utcIso);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Inverse of forgeLocalCalendarDate: a picked calendar date -> midnight UTC. */
function calendarDateToUtcMidnight(picked: Date): string {
  return new Date(
    Date.UTC(picked.getFullYear(), picked.getMonth(), picked.getDate())
  ).toISOString();
}

/** The course's current UTC offset, in minutes, at the given instant (DST-aware). */
function tzOffsetMinutes(utcDate: Date, tz: string): number {
  const p = tzParts(utcDate, tz);
  const asUtc = Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second);
  return (asUtc - utcDate.getTime()) / 60000;
}

/** Reverses forgeLocalDate: course-local wall-clock digits -> the real UTC instant. */
function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string
): Date {
  const guess = new Date(Date.UTC(year, month, day, hour, minute, second));
  const offset = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - offset * 60000);
}

function combinedDateAndTime(date: Date, time: Date, tz: string) {
  // The pickers always render in the device's own timezone (native pickers
  // don't reliably honor a forced timezone) — so date/time here are plain
  // device-local Date objects whose digits are exactly what the user picked,
  // intended as the course's wall-clock time. Re-stamp those digits as
  // course-local and convert to the real UTC instant.
  return dayjs(
    zonedWallClockToUtc(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      time.getHours(),
      time.getMinutes(),
      time.getSeconds(),
      tz
    )
  );
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
  const { id, name, tierName: tierNameParam, alertId } = useLocalSearchParams();
  const router = useRouter();
  const theme = useTheme();

  const isEditing = !!alertId;

  const [holes, setHoles] = useState<string>("18");
  const [players, setPlayers] = useState<string>("0");
  const [date, setDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [course, setCourse] = useState<any>(null);
  const [courseId, setCourseId] = useState<number | null>(null);
  // The course's own local timezone — tee-time windows are always edited in
  // course-local wall-clock time, not the device's timezone, so pickers must
  // be forced to this zone regardless of where the person testing/using the
  // app physically is.
  const tz = course?.time_zone || dayjs.tz.guess();
  const [courseName, setCourseName] = useState<string | null>(null);
  const [startValid, setStartValid] = useState(false);
  const [endValid, setEndValid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(isEditing);
  const [tierName, setTierName] = useState<string | null>(
    typeof tierNameParam === "string" ? tierNameParam : null
  );
  // The profile fetch runs alongside the alert fetch and drives tier-gated UI
  // (player pills, recurring toggle, upgrade chip). Gate the first paint on it
  // too, or those controls visibly flip state a beat after the screen appears.
  // Skipped when the tier was already passed in as a route param.
  const [loadingProfile, setLoadingProfile] = useState(
    typeof tierNameParam !== "string"
  );
  const [lifetimeAlertsCreated, setLifetimeAlertsCreated] = useState<number | null>(null);
  const [freeLifetimeLimit, setFreeLifetimeLimit] = useState<number | null>(null);

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
    const loadExistingAlert = async () => {
      try {
        const existing = await getAlert(Number(alertId));
        setCourseId(existing.course_id);
        setCourseName(existing.courses?.name || null);
        const courseInfo = { time_zone: existing.courses?.time_zone };
        setCourse(courseInfo);

        const tz = courseInfo.time_zone || dayjs.tz.guess();
        setHoles(String(existing.holes ?? "18"));
        setPlayers(existing.players != null ? String(existing.players) : "0");
        setIsRecurring(!!existing.is_recurring);
        // existing.date_from/start_time/end_time are already UTC-offset ISO
        // strings from the API — parse them normally first, then shift the
        // display zone with .tz(). Passing them straight into dayjs.tz(str, tz)
        // instead re-stamps the raw clock digits as if already local to `tz`,
        // silently discarding the real offset and producing a wrong instant.
        if (existing.date_from) setDate(forgeLocalCalendarDate(existing.date_from));
        if (existing.start_time) setStartTime(forgeLocalDate(existing.start_time, tz));
        if (existing.end_time) setEndTime(forgeLocalDate(existing.end_time, tz));
      } catch (err: any) {
        Toast.show({
          type: "error",
          text1: "Failed to load alert",
          text2: err.message,
          position: "top",
        });
        router.back();
      } finally {
        setLoadingExisting(false);
      }
    };

    const fetchNewAlertCourse = async () => {
      const courseIdNum = Array.isArray(id) ? parseInt(id[0]) : parseInt(id || "0");
      if (courseIdNum) {
        setCourseId(courseIdNum);
        const { data } = await supabase
          .from("courses")
          .select("time_zone")
          .eq("id", courseIdNum)
          .single();
        if (data) setCourse(data);
      }
    };

    const fetchProfile = async () => {
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
            if (profile?.lifetime_alerts_created != null) {
              setLifetimeAlertsCreated(profile.lifetime_alerts_created);
            }
            if (profile?.free_lifetime_alert_limit != null) {
              setFreeLifetimeLimit(profile.free_lifetime_alert_limit);
            }
          }
        } catch (err) {
          console.log("Failed to load tier info", err);
        } finally {
          setLoadingProfile(false);
        }
      } else {
        setLoadingProfile(false);
      }
    };

    if (isEditing) {
      loadExistingAlert();
    } else {
      fetchNewAlertCourse();
    }
    fetchProfile();
  }, [id, alertId]);

  const handleSubmit = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.push("/(auth)/sign-in");
      return;
    }
    try {
      setSubmitting(true);
      const combinedStart =
        date && startTime ? combinedDateAndTime(date, startTime, tz) : null;
      const combinedEnd =
        date && endTime ? combinedDateAndTime(date, endTime, tz) : null;
      if (!courseId) throw new Error("Invalid course ID");

      const payload = {
        user_id: data.session.user.id,
        holes: parseInt(holes),
        players: players === "0" ? null : parseInt(players),
        course_id: courseId,
        // Calendar dates, stored as midnight UTC — derived from the picked
        // date's own digits rather than .startOf("day") on a device-local
        // instant, which lands on the wrong calendar day east of UTC.
        date_from: date ? calendarDateToUtcMidnight(date) : undefined,
        date_to: date ? calendarDateToUtcMidnight(date) : undefined,
        start_time: combinedStart?.toISOString(),
        end_time: combinedEnd?.toISOString(),
        is_recurring: tierName === "Pro" ? isRecurring : false,
      };

      if (isEditing) {
        await updateAlert(Number(alertId), payload);
      } else {
        await createAlert(payload);
      }

      haptics.success();
      Toast.show({
        type: "success",
        text1: isEditing ? "Alert updated" : "Alert created successfully!",
        position: "top",
        visibilityTime: 2000,
      });
      setTimeout(() => router.push("/(tabs)/my-alerts"), 600);
    } catch (err: any) {
      haptics.error();
      Toast.show({
        type: "error",
        text1: isEditing ? "Failed to update alert" : "Failed to create alert",
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

  if (loadingExisting || loadingProfile) {
    return (
      <SafeAreaView
        style={[
          styles.safe,
          styles.loadingWrap,
          { backgroundColor: theme.colors.background },
        ]}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

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
            {isEditing ? courseName || "Edit Alert" : name || "Create Alert"}
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
          {tierName === "Free" &&
            freeLifetimeLimit != null &&
            lifetimeAlertsCreated != null &&
            lifetimeAlertsCreated === freeLifetimeLimit - 1 && (
              <View style={styles.lastFreeNudge}>
                <MaterialCommunityIcons name="information-outline" size={13} color={theme.colors.onSurfaceVariant} style={{ opacity: 0.7 }} />
                <Text style={[styles.lastFreeNudgeText, { color: theme.colors.onSurfaceVariant }]}>
                  This is your last free alert.{" "}
                  <Text style={{ color: accent, fontWeight: "600" }} onPress={() => router.push("/upgrade")}>
                    Go unlimited
                  </Text>
                </Text>
              </View>
            )}
          <PressableScale
            onPress={handleSubmit}
            disabled={buttonDisabled}
            haptic="press"
            scaleTo={0.96}
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
                    name={isEditing ? "content-save-outline" : "bell-plus-outline"}
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
                    {isEditing ? "Save Changes" : "Create Alert"}
                  </Text>
                </View>
              )}
            </LinearGradient>
          </PressableScale>
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
  loadingWrap: { justifyContent: "center", alignItems: "center" },
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
  lastFreeNudge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginBottom: 10,
  },
  lastFreeNudgeText: {
    fontSize: 12.5,
  },
});
