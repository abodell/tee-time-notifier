import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Animated as RNAnimated,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Dimensions,
} from "react-native";
import { Text, TextInput, ActivityIndicator, useTheme } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { createAlert, triggerImmediateScan } from "@/lib/api";
import { registerForPushNotificationsAsync } from "@/lib/notifications";
import { Colors } from "@/constants/theme";
import PickerModal from "@/components/PickerModal";
import DateTimePicker from "@react-native-community/datetimepicker";
import OAuthSection from "@/components/auth/OAuthSection";
import * as Notifications from "expo-notifications";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, { FadeIn } from "react-native-reanimated";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const ONBOARDING_KEY = "onboarding_completed";

// Steps 0–6 (7 total): Welcome, How It Works, Find Course, Set Alert, Notifications, Auth, Armed
const STEPS = 6;

const BADGE_GRAD_START = "#052e16";
const BADGE_GRAD_END = "#14532d";

const BG_DARK = "#060d0a";
const BG_LIGHT = "#f7fff9";
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");


type Course = { id: number; name: string; city: string; state: string; time_zone: string };

export default function OnboardingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const isDark = theme.dark;
  const accent = theme.colors.primary;
  const labelColor = theme.colors.onSurfaceVariant;
  const cardBg = isDark ? "rgba(255,255,255,0.06)" : "#fff";
  const cardBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const dividerColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const gradColors = isDark
    ? (Colors.dark.gradients.primary as [string, string])
    : (Colors.light.gradients.primary as [string, string]);

  const [step, setStep] = useState(0);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  // Course search
  const [courseQuery, setCourseQuery] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Alert form
  const [date, setDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [startValid, setStartValid] = useState(false);
  const [endValid, setEndValid] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Picker visibility
  const [dateVisible, setDateVisible] = useState(false);
  const [startVisible, setStartVisible] = useState(false);
  const [endVisible, setEndVisible] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(new Date());
  const [tempStart, setTempStart] = useState<Date>(new Date());
  const [tempEnd, setTempEnd] = useState<Date>(new Date());

  // Auth wall
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Notifications
  const [notifGranted, setNotifGranted] = useState(false);

  // Pulse animation (step 6) — RN Animated to avoid conflict with reanimated
  const pulseScale = useRef(new RNAnimated.Value(1)).current;
  const pulseOpacity = useRef(new RNAnimated.Value(0.5)).current;
  // Ambient float animation for background orbs
  const floatAnim = useRef(new RNAnimated.Value(0)).current;

  // Time validation
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

  useEffect(() => {
    if (step !== 6) return;
    const anim = RNAnimated.loop(
      RNAnimated.parallel([
        RNAnimated.sequence([
          RNAnimated.timing(pulseScale, { toValue: 1.45, duration: 1100, useNativeDriver: true }),
          RNAnimated.timing(pulseScale, { toValue: 1, duration: 1100, useNativeDriver: true }),
        ]),
        RNAnimated.sequence([
          RNAnimated.timing(pulseOpacity, { toValue: 0.15, duration: 1100, useNativeDriver: true }),
          RNAnimated.timing(pulseOpacity, { toValue: 0.55, duration: 1100, useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [step]);

  // Ambient float — drives background orb bob animations
  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(floatAnim, { toValue: 1, duration: 5200, useNativeDriver: true }),
        RNAnimated.timing(floatAnim, { toValue: 0, duration: 5200, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  useEffect(() => {
    Notifications.getPermissionsAsync().then(({ status }) => {
      if (status === "granted") setNotifGranted(true);
    });
  }, []);

  const handleCourseSearch = useCallback((query: string) => {
    setCourseQuery(query);
    clearTimeout(searchTimeout.current);
    if (!query.trim()) {
      setCourses([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setCoursesLoading(true);
      const { data } = await supabase
        .from("courses")
        .select("id, name, city, state, time_zone")
        .ilike("name", `%${query}%`)
        .limit(25);
      setCourses(data || []);
      setCoursesLoading(false);
    }, 300);
  }, []);

  const advanceFromNotifications = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setStep(5);
    } else {
      handleCreateAlert();
    }
  };

  const handleEnableNotifications = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotifGranted(status === "granted");
    } catch {
      // ignore
    } finally {
      setTimeout(advanceFromNotifications, 800);
    }
  };

  const handleStartWatching = () => {
    if (!selectedCourse || !date || !startTime || !endTime) return;
    setStep(4);
  };

  const handleCreateAlert = async () => {
    if (!selectedCourse || !date || !startTime || !endTime) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;

    setSubmitting(true);
    setFormError(null);
    try {
      const tz = selectedCourse.time_zone || dayjs.tz.guess();
      const datePart = dayjs(date).format("YYYY-MM-DD");
      const combine = (t: Date) => dayjs.tz(`${datePart} ${dayjs(t).format("HH:mm:ss")}`, tz);
      const combinedStart = combine(startTime);
      const combinedEnd = combine(endTime);

      await registerForPushNotificationsAsync().catch((e) =>
        console.warn("[Onboarding] Push token error:", e)
      );

      const result = await createAlert({
        user_id: data.session.user.id,
        holes: 18,
        course_id: selectedCourse.id,
        date_from: combinedStart.startOf("day").toISOString(),
        date_to: combinedEnd.startOf("day").toISOString(),
        start_time: combinedStart.toISOString(),
        end_time: combinedEnd.toISOString(),
        is_recurring: false,
      });

      const createdId = result.alert?.id;
      if (createdId) triggerImmediateScan(createdId).catch(() => {});

      setStep(6);
    } catch (err: any) {
      setFormError(err.message || "Failed to create alert. Please try again.");
      setStep(3);
    } finally {
      setSubmitting(false);
    }
  };

  const complete = async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, "true");
    router.replace("/(tabs)/my-alerts");
  };

  const formDisabled = !date || !startTime || !endTime || !startValid || !endValid || submitting;
  const formattedDate = date ? dayjs(date).format("dddd, MMMM D") : "";
  const formattedStartTime = startTime ? dayjs(startTime).format("h:mm A") : "";
  const formattedEndTime = endTime ? dayjs(endTime).format("h:mm A") : "";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? BG_DARK : BG_LIGHT }]}>
      <BackgroundLayer step={step} isDark={isDark} floatAnim={floatAnim} />
      {/* Progress dots — steps 1–5 */}
      {step > 0 && step < 6 && (
        <View style={styles.progressRow}>
          {Array.from({ length: STEPS }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i < step ? theme.colors.primary : theme.colors.surfaceVariant,
                  width: i < step ? 20 : 8,
                },
              ]}
            />
          ))}
        </View>
      )}

      {/* ── STEP 0: Welcome hero ── */}
      {step === 0 && (
        <ScrollView contentContainerStyle={styles.centerContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.heroEmoji}>🏌️</Text>
          <Text style={[styles.heroTitle, { color: theme.colors.onBackground }]}>
            Book the courses everyone else can't.
          </Text>
          <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant }]}>
            TeeSignal watches the tee sheet 24/7 and notifies you the instant a spot opens — even at
            courses that are always booked solid.
          </Text>
          <View style={styles.counterCard}>
            <Text
              style={[styles.counterNumber, { color: accent, fontVariant: ["tabular-nums"] }]}
            >
              50+
            </Text>
            <Text style={[styles.counterLabel, { color: theme.colors.onSurfaceVariant }]}>
              Tee times snagged by TeeSignal{"\n"}users this month
            </Text>
          </View>
          <GradientButton
            onPress={() => setStep(1)}
            label="Get Started →"
            gradColors={gradColors}
            style={{ marginTop: 32, width: "100%" }}
          />
        </ScrollView>
      )}

      {/* ── STEP 1: How It Works ── */}
      {step === 1 && (
        <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          <Text style={[styles.stepTitle, { color: theme.colors.onBackground }]}>
            How TeeSignal works
          </Text>
          <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant, marginBottom: 28 }]}>
            Three steps between you and that impossible tee time.
          </Text>
          {[
            {
              icon: "golf" as const,
              label: "Courses release slots",
              desc: "Golfers cancel, courses free up prime times — often hours or days before the round.",
            },
            {
              icon: "radar" as const,
              label: "TeeSignal scans every 30 min",
              desc: "We watch your course continuously so you don't have to check yourself.",
            },
            {
              icon: "bell-ring" as const,
              label: "You get notified instantly",
              desc: "The moment a slot opens that matches your alert, we ping you before anyone else sees it.",
            },
          ].map((item, index) => (
            <View
              key={index}
              style={[
                styles.howItWorksCard,
                {
                  backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#FAFAFA",
                  borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                },
              ]}
            >
              <View style={styles.howItWorksBadge}>
                <LinearGradient
                  colors={[BADGE_GRAD_START, BADGE_GRAD_END]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={styles.howItWorksBadgeInner} />
                <MaterialCommunityIcons name={item.icon} size={22} color="rgba(255,255,255,0.88)" />
              </View>
              <View style={styles.howItWorksText}>
                <Text style={[styles.howItWorksLabel, { color: isDark ? "#F1F5F9" : "#1E293B" }]}>
                  {item.label}
                </Text>
                <Text
                  style={[styles.howItWorksDesc, { color: isDark ? "rgba(255,255,255,0.42)" : "#64748B" }]}
                >
                  {item.desc}
                </Text>
              </View>
            </View>
          ))}
          <GradientButton
            onPress={() => setStep(2)}
            label="Find My Course →"
            gradColors={gradColors}
            style={{ marginTop: 32, width: "100%" }}
          />
        </ScrollView>
      )}

      {/* ── STEP 2: Find a course ── */}
      {step === 2 && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.searchHeader}>
            <Text style={[styles.pageTitle, { color: theme.colors.onBackground }]}>
              Find your course
            </Text>
            <Text style={[styles.pageSubtitle, { color: theme.colors.onSurfaceVariant }]}>
              Which course are you trying to get on?
            </Text>
            <TextInput
              placeholder="Search courses..."
              value={courseQuery}
              onChangeText={handleCourseSearch}
              mode="outlined"
              left={<TextInput.Icon icon="magnify" color={theme.colors.onSurfaceVariant} />}
              style={[
                styles.searchBar,
                { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#fff" },
              ]}
              outlineStyle={{
                borderRadius: 14,
                borderWidth: isDark ? 1 : 0,
                borderColor: isDark ? "rgba(255,255,255,0.08)" : "transparent",
              }}
              textColor={theme.colors.onSurface}
              placeholderTextColor={theme.colors.onSurfaceVariant}
              autoFocus
            />
          </View>

          {coursesLoading ? (
            <View style={{ alignItems: "center", marginTop: 32 }}>
              <ActivityIndicator animating size="small" color={accent} />
            </View>
          ) : courses.length === 0 && courseQuery.length > 0 ? (
            <View style={{ alignItems: "center", marginTop: 32, paddingHorizontal: 24 }}>
              <Text style={{ textAlign: "center", color: theme.colors.onSurfaceVariant }}>
                No courses found for "{courseQuery}"
              </Text>
              <TouchableOpacity
                onPress={() => router.push("/request-course" as any)}
                style={{ marginTop: 12 }}
              >
                <Text style={{ color: accent, fontSize: 14, fontWeight: "600" }}>
                  Don't see your course? Request it →
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={courses}
              keyExtractor={(item) => String(item.id)}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
              renderItem={({ item, index }) => (
                <Animated.View entering={FadeIn.delay(index * 45).duration(320)}>
                  <TouchableOpacity
                    onPress={() => {
                      Keyboard.dismiss();
                      setSelectedCourse(item);
                      setStep(3);
                    }}
                    activeOpacity={0.7}
                    style={[styles.courseCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
                  >
                    <View style={styles.courseBadge}>
                      <LinearGradient
                        colors={[BADGE_GRAD_START, BADGE_GRAD_END]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFillObject}
                      />
                      <View style={styles.courseBadgeInner} />
                      <MaterialCommunityIcons
                        name="flag-variant"
                        size={20}
                        color="rgba(255,255,255,0.88)"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.courseName, { color: theme.colors.onSurface }]}>
                        {item.name}
                      </Text>
                      <Text style={[styles.courseMeta, { color: theme.colors.onSurfaceVariant }]}>
                        {item.city}, {item.state}
                      </Text>
                    </View>
                    <View style={[styles.courseArrowChip, { backgroundColor: `${accent}18` }]}>
                      <MaterialCommunityIcons name="arrow-right" size={15} color={accent} />
                    </View>
                  </TouchableOpacity>
                </Animated.View>
              )}
            />
          )}
        </KeyboardAvoidingView>
      )}

      {/* ── STEP 3: Set your alert ── */}
      {step === 3 && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            contentContainerStyle={styles.stepScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Nav row */}
            <View style={styles.navRow}>
              <TouchableOpacity
                onPress={() => setStep(2)}
                activeOpacity={0.75}
                style={[
                  styles.backBtn,
                  {
                    backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
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
                style={[styles.navTitle, { color: theme.colors.onSurface }]}
                numberOfLines={1}
              >
                {selectedCourse?.name || "Set Alert"}
              </Text>
              <View style={styles.navSpacer} />
            </View>

            <Text
              style={[styles.pageTitle, { color: theme.colors.onBackground, textAlign: "left", marginBottom: 4 }]}
            >
              When do you want to play?
            </Text>
            <Text
              style={[styles.pageSubtitle, { color: theme.colors.onSurfaceVariant, textAlign: "left", marginBottom: 20 }]}
            >
              We'll alert you the moment a slot opens.
            </Text>

            {/* TIME WINDOW card */}
            <Text style={[styles.sectionLabel, { color: labelColor }]}>TIME WINDOW</Text>
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
                    { color: date ? theme.colors.onSurface : theme.colors.onSurfaceVariant },
                  ]}
                >
                  {date ? dayjs(date).format("MMM D, YYYY") : "Select"}
                </Text>
              </TouchableOpacity>

              <View style={[styles.divider, { backgroundColor: dividerColor }]} />

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
                  <Text style={[styles.rowLabel, { color: labelColor }]}>Start</Text>
                </View>
                <Text
                  style={[
                    styles.rowValue,
                    { color: startTime ? theme.colors.onSurface : theme.colors.onSurfaceVariant },
                  ]}
                >
                  {startTime ? dayjs(startTime).format("h:mm A") : "Select"}
                </Text>
              </TouchableOpacity>

              <View style={[styles.divider, { backgroundColor: dividerColor }]} />

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
                    { color: endTime ? theme.colors.onSurface : theme.colors.onSurfaceVariant },
                  ]}
                >
                  {endTime ? dayjs(endTime).format("h:mm A") : "Select"}
                </Text>
              </TouchableOpacity>
            </View>

            {timeError ? (
              <Text style={[styles.errorText, { color: theme.colors.error }]}>{timeError}</Text>
            ) : null}

            {formError ? (
              <View style={[styles.errorBox, { backgroundColor: theme.colors.errorContainer }]}>
                <Text style={{ color: theme.colors.onErrorContainer, fontSize: 13 }}>
                  {formError}
                </Text>
              </View>
            ) : null}

            {/* Submit */}
            <TouchableOpacity
              onPress={handleStartWatching}
              disabled={formDisabled}
              activeOpacity={0.82}
              style={{ marginTop: 8 }}
            >
              <LinearGradient
                colors={
                  formDisabled
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
                        formDisabled
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
                          color: formDisabled
                            ? isDark
                              ? "rgba(255,255,255,0.25)"
                              : "#94A3B8"
                            : "#fff",
                        },
                      ]}
                    >
                      Start Watching
                    </Text>
                  </View>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ── STEP 4: Enable Notifications ── */}
      {step === 4 && (
        <View style={styles.centerContent}>
          <Text style={styles.stepEmoji}>🔔</Text>
          <Text style={[styles.stepTitle, { color: theme.colors.onBackground }]}>
            Turn on notifications
          </Text>
          <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant }]}>
            TeeSignal alerts are sent as push notifications. Without them, we can't reach you when a
            spot opens.
          </Text>
          {notifGranted ? (
            <>
              <View style={[styles.successPill, { backgroundColor: theme.colors.primaryContainer }]}>
                <Text
                  style={{ color: theme.colors.onPrimaryContainer, fontWeight: "700", fontSize: 15 }}
                >
                  ✓ Notifications enabled
                </Text>
              </View>
              <GradientButton
                onPress={advanceFromNotifications}
                label="Continue →"
                gradColors={gradColors}
                style={{ width: "100%", marginTop: 20 }}
              />
            </>
          ) : (
            <>
              <GradientButton
                onPress={handleEnableNotifications}
                label="Enable Notifications"
                gradColors={gradColors}
                style={{ width: "100%", marginTop: 8 }}
              />
              <TouchableOpacity onPress={advanceFromNotifications} style={{ marginTop: 20 }}>
                <Text
                  style={{ color: theme.colors.onSurfaceVariant, textAlign: "center", fontSize: 14 }}
                >
                  Maybe later
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* ── STEP 5: Auth wall ── */}
      {step === 5 && (
        <ScrollView contentContainerStyle={styles.centerContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.stepEmoji}>👋</Text>
          <Text style={[styles.stepTitle, { color: theme.colors.onBackground }]}>
            Almost there
          </Text>
          <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant }]}>
            Create a free account to activate your alert. We'll start watching the moment you're in.
          </Text>

          {oauthError && (
            <View
              style={[
                styles.errorBox,
                { backgroundColor: theme.colors.errorContainer, marginBottom: 8, width: "100%" },
              ]}
            >
              <Text style={{ color: theme.colors.onErrorContainer, fontSize: 13 }}>
                {oauthError}
              </Text>
            </View>
          )}

          <View style={{ width: "100%", marginTop: 16 }}>
            <OAuthSection
              loading={oauthLoading}
              setLoading={setOauthLoading}
              setError={setOauthError}
              onSuccess={handleCreateAlert}
            />
          </View>

          <TouchableOpacity
            onPress={() => router.push("/(auth)/sign-in?redirectTo=/onboarding" as any)}
            style={{ marginTop: 28 }}
          >
            <Text
              style={{ color: accent, fontSize: 14, fontWeight: "600", textAlign: "center" }}
            >
              Already have an account? Sign in →
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setStep(4)} style={{ marginTop: 12 }}>
            <Text
              style={{ color: theme.colors.onSurfaceVariant, fontSize: 14, textAlign: "center" }}
            >
              ← Back
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── STEP 6: Sniper Armed ── */}
      {step === 6 && (
        <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          {/* Pulsing radar */}
          <View style={styles.pulseContainer}>
            <RNAnimated.View
              style={[
                styles.pulseRing,
                {
                  borderColor: theme.colors.primary,
                  transform: [{ scale: pulseScale }],
                  opacity: pulseOpacity,
                },
              ]}
            />
            <View style={[styles.pulseCore, { backgroundColor: `${theme.colors.primary}18` }]}>
              <Text style={{ fontSize: 48 }}>🎯</Text>
            </View>
          </View>

          <Text style={[styles.stepTitle, { color: theme.colors.onBackground, marginTop: 32 }]}>
            You're locked in.
          </Text>

          {/* Rich alert summary */}
          <View
            style={[
              styles.armedSummaryCard,
              {
                backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "#FAFAFA",
                borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
              },
            ]}
          >
            <Text style={[styles.armedCourseName, { color: isDark ? "#F1F5F9" : "#1E293B" }]}>
              {selectedCourse?.name}
            </Text>
            {formattedDate ? (
              <Text
                style={[styles.armedDetail, { color: isDark ? "rgba(255,255,255,0.6)" : "#475569" }]}
              >
                {formattedDate}
              </Text>
            ) : null}
            {formattedStartTime && formattedEndTime ? (
              <Text
                style={[styles.armedDetail, { color: isDark ? "rgba(255,255,255,0.6)" : "#475569" }]}
              >
                {formattedStartTime} – {formattedEndTime}
              </Text>
            ) : null}
            <View
              style={[
                styles.armedDivider,
                {
                  backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                },
              ]}
            />
            <Text
              style={[styles.armedScanNote, { color: isDark ? "rgba(255,255,255,0.42)" : "#64748B" }]}
            >
              Scanning every 30 minutes. We just ran one for you.
            </Text>
          </View>

          {/* Upsell */}
          <View style={[styles.upsellCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Text
              style={{ color: theme.colors.onSurface, fontWeight: "800", fontSize: 16, marginBottom: 6 }}
            >
              Want faster scans?
            </Text>
            <Text
              style={{
                color: theme.colors.onSurfaceVariant,
                fontSize: 14,
                lineHeight: 20,
                marginBottom: 18,
              }}
            >
              You're on Free — we scan every 60 minutes. Pro users get 1-minute scans, 10 active
              alerts, and recurring weekly alerts.
            </Text>
            <GradientButton
              onPress={() => {
                complete();
                router.push("/upgrade" as any);
              }}
              label="Start 14-Day Free Trial"
              gradColors={gradColors}
            />
          </View>

          <TouchableOpacity onPress={complete} style={{ marginTop: 20, paddingVertical: 8 }}>
            <Text
              style={{ color: theme.colors.onSurfaceVariant, textAlign: "center", fontSize: 14 }}
            >
              Continue to My Alerts →
            </Text>
          </TouchableOpacity>

          {__DEV__ && (
            <TouchableOpacity
              onPress={async () => {
                await AsyncStorage.removeItem(ONBOARDING_KEY);
                setStep(0);
              }}
              style={{ marginTop: 12, paddingVertical: 8 }}
            >
              <Text style={{ color: "red", textAlign: "center", fontSize: 12 }}>
                [DEV] Reset onboarding
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

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

// ── Background Layer ──────────────────────────────────────────────────────────
const BackgroundLayer = React.memo(
  ({ step, isDark, floatAnim }: { step: number; isDark: boolean; floatAnim: RNAnimated.Value }) => {
    const floatY = floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });

    // Shared color shorthands
    const g = (a: number) => isDark ? `rgba(34,197,94,${a})` : `rgba(21,128,61,${a})`;

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">

        {/* ── Step 0 — Aurora Diagonal Streak ── */}
        {step === 0 && (
          <>
            {/* Soft ambient bloom behind the streak */}
            <View style={{ position: "absolute", top: SCREEN_H * 0.08, left: SCREEN_W * 0.05, width: SCREEN_W * 0.9, height: SCREEN_H * 0.42, borderRadius: SCREEN_W * 0.45, backgroundColor: g(isDark ? 0.055 : 0.04) }} />
            {/* Primary streak — narrow diagonal band, animated float */}
            <RNAnimated.View style={{ position: "absolute", top: SCREEN_H * 0.25, left: -60, width: SCREEN_W + 120, height: 58, borderRadius: 29, overflow: "hidden", opacity: isDark ? 0.62 : 0.42, transform: [{ rotate: "-26deg" }, { translateY: floatY }] }}>
              <LinearGradient
                colors={["transparent", isDark ? "#22c55e" : "#4ade80", isDark ? "#a3e635" : "#22c55e", isDark ? "#22c55e" : "#4ade80", "transparent"]}
                start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </RNAnimated.View>
            {/* Wide soft halo around the streak */}
            <View style={{ position: "absolute", top: SCREEN_H * 0.22, left: -60, width: SCREEN_W + 120, height: 130, borderRadius: 65, overflow: "hidden", opacity: isDark ? 0.10 : 0.07, transform: [{ rotate: "-26deg" }] }}>
              <LinearGradient
                colors={["transparent", isDark ? "#22c55e" : "#4ade80", "transparent"]}
                start={{ x: 0.15, y: 0.5 }} end={{ x: 0.85, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </View>
          </>
        )}

        {/* ── Step 1 — Flowing Silk Waves ── */}
        {step === 1 && (
          <>
            {/* Wave 1 — large, bottom, forward layer */}
            <View style={{ position: "absolute", bottom: -90, left: -SCREEN_W * 0.2, width: SCREEN_W * 1.4, height: 300, borderTopLeftRadius: 200, borderTopRightRadius: 280, overflow: "hidden", opacity: isDark ? 0.13 : 0.10 }}>
              <LinearGradient colors={[isDark ? "#22c55e" : "#16a34a", isDark ? "#15803d" : "#4ade80"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            </View>
            {/* Wave 2 — mid, slightly offset shape */}
            <View style={{ position: "absolute", bottom: 170, left: SCREEN_W * 0.18, width: SCREEN_W * 1.15, height: 210, borderTopLeftRadius: 240, borderTopRightRadius: 130, overflow: "hidden", opacity: isDark ? 0.08 : 0.06 }}>
              <LinearGradient colors={[isDark ? "#16a34a" : "#22c55e", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            </View>
            {/* Wave 3 — top, reverse curve */}
            <View style={{ position: "absolute", top: -70, left: -SCREEN_W * 0.1, width: SCREEN_W * 0.82, height: 250, borderBottomRightRadius: 220, overflow: "hidden", opacity: isDark ? 0.07 : 0.05 }}>
              <LinearGradient colors={[isDark ? "#22c55e" : "#4ade80", "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            </View>
          </>
        )}

        {/* ── Step 2 — Centered Emerald Sphere Glow ── */}
        {step === 2 && (
          <>
            {/* Layered concentric glow rings — largest to smallest */}
            <View style={{ position: "absolute", top: SCREEN_H * 0.5 - 210, left: SCREEN_W * 0.5 - 210, width: 420, height: 420, borderRadius: 210, backgroundColor: g(isDark ? 0.042 : 0.035) }} />
            <View style={{ position: "absolute", top: SCREEN_H * 0.5 - 148, left: SCREEN_W * 0.5 - 148, width: 296, height: 296, borderRadius: 148, backgroundColor: g(isDark ? 0.075 : 0.060) }} />
            <View style={{ position: "absolute", top: SCREEN_H * 0.5 - 96, left: SCREEN_W * 0.5 - 96,  width: 192, height: 192, borderRadius: 96,  backgroundColor: g(isDark ? 0.13  : 0.10 ) }} />
            <View style={{ position: "absolute", top: SCREEN_H * 0.5 - 54, left: SCREEN_W * 0.5 - 54,  width: 108, height: 108, borderRadius: 54,  backgroundColor: g(isDark ? 0.22  : 0.17 ) }} />
            <View style={{ position: "absolute", top: SCREEN_H * 0.5 - 28, left: SCREEN_W * 0.5 - 28,  width: 56,  height: 56,  borderRadius: 28,  backgroundColor: g(isDark ? 0.35  : 0.27 ) }} />
          </>
        )}

        {/* ── Step 3 — Dark Matte: almost nothing ── */}
        {step === 3 && (
          // Barely-there top vignette — lets the form be the sole focus
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: SCREEN_H * 0.30, overflow: "hidden", opacity: isDark ? 0.055 : 0.04 }}>
            <LinearGradient colors={[isDark ? "#22c55e" : "#16a34a", "transparent"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
          </View>
        )}

        {/* ── Step 4 — Gold / Amber Energy Wave (breaks the green palette intentionally) ── */}
        {step === 4 && (
          <>
            {/* Teal wash from top */}
            <View style={{ position: "absolute", top: -120, left: -50, width: SCREEN_W + 100, height: 380, borderBottomLeftRadius: 220, borderBottomRightRadius: 170, overflow: "hidden", opacity: isDark ? 0.13 : 0.09 }}>
              <LinearGradient colors={[isDark ? "#0f766e" : "#14b8a6", "transparent"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
            </View>
            {/* Primary gold sweep */}
            <View style={{ position: "absolute", top: SCREEN_H * 0.17, left: -80, width: SCREEN_W * 1.35, height: 88, borderRadius: 44, overflow: "hidden", opacity: isDark ? 0.40 : 0.28, transform: [{ rotate: "20deg" }] }}>
              <LinearGradient
                colors={["transparent", isDark ? "#d97706" : "#f59e0b", isDark ? "#fbbf24" : "#d97706", "transparent"]}
                start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </View>
            {/* Secondary softer gold halo */}
            <View style={{ position: "absolute", top: SCREEN_H * 0.19, left: -80, width: SCREEN_W * 1.35, height: 160, borderRadius: 80, overflow: "hidden", opacity: isDark ? 0.12 : 0.08, transform: [{ rotate: "20deg" }] }}>
              <LinearGradient
                colors={["transparent", isDark ? "#fbbf24" : "#f59e0b", "transparent"]}
                start={{ x: 0.1, y: 0.5 }} end={{ x: 0.9, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </View>
            {/* Warm bottom-right accent */}
            <View style={{ position: "absolute", bottom: -55, right: -55, width: 230, height: 230, borderRadius: 115, backgroundColor: isDark ? "rgba(217,119,6,0.10)" : "rgba(245,158,11,0.07)" }} />
          </>
        )}

        {/* ── Step 5 — Flowing Green Ribbons ── */}
        {step === 5 && (
          <>
            {/* Ribbon 1 — upper-right diagonal */}
            <View style={{ position: "absolute", top: SCREEN_H * 0.07, left: SCREEN_W * 0.22, width: SCREEN_W * 0.88, height: 52, borderRadius: 26, overflow: "hidden", opacity: isDark ? 0.28 : 0.20, transform: [{ rotate: "34deg" }] }}>
              <LinearGradient colors={["transparent", isDark ? "#22c55e" : "#16a34a", "transparent"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
            </View>
            {/* Ribbon 2 — mid, counter-angle, wider */}
            <View style={{ position: "absolute", top: SCREEN_H * 0.40, left: -SCREEN_W * 0.18, width: SCREEN_W * 0.95, height: 42, borderRadius: 21, overflow: "hidden", opacity: isDark ? 0.20 : 0.14, transform: [{ rotate: "-18deg" }] }}>
              <LinearGradient colors={["transparent", isDark ? "#16a34a" : "#22c55e", isDark ? "#22c55e" : "#16a34a", "transparent"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
            </View>
            {/* Ribbon 3 — lower, gentle angle */}
            <View style={{ position: "absolute", bottom: SCREEN_H * 0.17, left: SCREEN_W * 0.08, width: SCREEN_W * 0.85, height: 34, borderRadius: 17, overflow: "hidden", opacity: isDark ? 0.14 : 0.10, transform: [{ rotate: "10deg" }] }}>
              <LinearGradient colors={["transparent", isDark ? "#15803d" : "#22c55e", "transparent"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
            </View>
            {/* Soft ambient bloom — upper right */}
            <View style={{ position: "absolute", top: -50, right: -65, width: 195, height: 195, borderRadius: 98, backgroundColor: g(isDark ? 0.07 : 0.055) }} />
          </>
        )}

        {/* ── Step 6 — Large Radial Sphere (triumphant payoff) ── */}
        {step === 6 && (
          <>
            {/* Outer halo — wide, very faint */}
            <View style={{ position: "absolute", top: SCREEN_H * 0.60 - 255, left: SCREEN_W * 0.5 - 255, width: 510, height: 510, borderRadius: 255, backgroundColor: g(isDark ? 0.035 : 0.028) }} />
            {/* Mid layer */}
            <View style={{ position: "absolute", top: SCREEN_H * 0.60 - 175, left: SCREEN_W * 0.5 - 175, width: 350, height: 350, borderRadius: 175, backgroundColor: g(isDark ? 0.07  : 0.055) }} />
            {/* Inner glow */}
            <View style={{ position: "absolute", top: SCREEN_H * 0.60 - 110, left: SCREEN_W * 0.5 - 110, width: 220, height: 220, borderRadius: 110, backgroundColor: g(isDark ? 0.13  : 0.10 ) }} />
            {/* Core sphere */}
            <View style={{ position: "absolute", top: SCREEN_H * 0.60 - 60,  left: SCREEN_W * 0.5 - 60,  width: 120, height: 120, borderRadius: 60,  backgroundColor: g(isDark ? 0.24  : 0.18 ) }} />
            <View style={{ position: "absolute", top: SCREEN_H * 0.60 - 28,  left: SCREEN_W * 0.5 - 28,  width: 56,  height: 56,  borderRadius: 28,  backgroundColor: g(isDark ? 0.40  : 0.30 ) }} />
            {/* Subtle top vignette for depth */}
            <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: SCREEN_H * 0.28, overflow: "hidden", opacity: isDark ? 0.065 : 0.05 }}>
              <LinearGradient colors={[isDark ? "#22c55e" : "#16a34a", "transparent"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
            </View>
          </>
        )}

      </View>
    );
  }
);

// ── Gradient Button ────────────────────────────────────────────────────────────
const GradientButton: React.FC<{
  onPress: () => void;
  label: string;
  disabled?: boolean;
  gradColors: [string, string];
  style?: object;
}> = ({ onPress, label, disabled, gradColors, style }) => {
  const theme = useTheme();
  const isDark = theme.dark;
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.8} style={style}>
      <LinearGradient
        colors={
          disabled
            ? isDark
              ? ["rgba(255,255,255,0.08)", "rgba(255,255,255,0.08)"]
              : ["#E2E8F0", "#E2E8F0"]
            : gradColors
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.gradientButton}
      >
        <Text
          style={{
            color: disabled
              ? isDark
                ? "rgba(255,255,255,0.25)"
                : "#94A3B8"
              : "#FFF",
            fontWeight: "700",
            fontSize: 16,
          }}
        >
          {label}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },

  progressRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingTop: 16,
    paddingBottom: 8,
  },
  dot: { height: 8, borderRadius: 4 },

  // Shared layouts
  centerContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingVertical: 40,
  },

  // Step 0 – hero
  heroEmoji: { fontSize: 72, marginBottom: 24 },
  heroTitle: {
    fontSize: 30,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 16,
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  bodyText: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    marginBottom: 8,
  },
  counterCard: {
    width: "100%",
    marginTop: 32,
    alignItems: "center",
  },
  counterNumber: {
    fontSize: 72,
    fontWeight: "800",
    letterSpacing: -2,
    lineHeight: 76,
  },
  counterLabel: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
    textAlign: "center",
  },

  // Steps 1 / 4 / 5
  stepEmoji: { fontSize: 56, marginBottom: 20, textAlign: "center" },
  stepTitle: {
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: -0.5,
  },

  // Step 1 – How It Works cards
  howItWorksCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 8,
    width: "100%",
  },
  howItWorksBadge: {
    width: 46,
    height: 46,
    borderRadius: 14,
    marginRight: 14,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
    flexShrink: 0,
  },
  howItWorksBadgeInner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.18)",
  },
  howItWorksText: { flex: 1 },
  howItWorksLabel: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  howItWorksDesc: { fontSize: 13, lineHeight: 19 },

  // Step 2 – course search
  searchHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
    lineHeight: 36,
    marginBottom: 4,
  },
  pageSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  searchBar: {
    marginBottom: 8,
  },
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
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.18)",
  },
  courseName: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  courseMeta: { fontSize: 12, lineHeight: 17 },
  courseArrowChip: {
    width: 28,
    height: 28,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },

  // Step 3 – alert form
  stepScroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
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
  navSpacer: { width: 38, flexShrink: 0 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
    marginBottom: 8,
    marginLeft: 4,
  },
  section: { marginBottom: 16 },
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
  rowLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  rowIcon: { marginRight: 10, opacity: 0.7 },
  rowLabel: { fontSize: 15, fontWeight: "400" },
  rowValue: { fontSize: 15, fontWeight: "500" },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  errorText: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: -10,
    marginBottom: 12,
    marginLeft: 4,
  },
  errorBox: { borderRadius: 12, padding: 12, marginTop: 12 },
  submitButton: {
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  submitInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  submitText: { fontWeight: "700", fontSize: 16, letterSpacing: -0.2 },

  // Step 4 – notifications
  successPill: {
    borderRadius: 30,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 20,
  },

  // Step 6 – armed
  pulseContainer: {
    width: 160,
    height: 160,
    justifyContent: "center",
    alignItems: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
  },
  pulseCore: {
    width: 110,
    height: 110,
    borderRadius: 55,
    justifyContent: "center",
    alignItems: "center",
  },
  armedSummaryCard: {
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginBottom: 20,
    alignItems: "center",
  },
  armedCourseName: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
    textAlign: "center",
    marginBottom: 6,
  },
  armedDetail: {
    fontSize: 15,
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 2,
  },
  armedDivider: {
    height: StyleSheet.hairlineWidth,
    width: "100%",
    marginVertical: 12,
  },
  armedScanNote: { fontSize: 13, textAlign: "center" },
  upsellCard: {
    borderRadius: 20,
    padding: 24,
    width: "100%",
    borderWidth: 1,
    marginBottom: 4,
  },

  // Gradient button
  gradientButton: {
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#15803d",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
});
