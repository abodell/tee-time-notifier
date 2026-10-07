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
import { createAlert, triggerImmediateScan, redeemReferralCode } from "@/lib/api";
import { registerForPushNotificationsAsync } from "@/lib/notifications";
import { Colors } from "@/constants/theme";
import PickerModal from "@/components/PickerModal";
import { useProTrialDays } from "@/lib/trial";
import DateTimePicker from "@react-native-community/datetimepicker";
import OAuthSection from "@/components/auth/OAuthSection";
import * as Notifications from "expo-notifications";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { SlideInRight, SlideInLeft, SlideOutLeft, SlideOutRight, runOnJS } from "react-native-reanimated";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const ONBOARDING_KEY = "onboarding_completed";

// Steps 0–6 (7 total): Welcome, How It Works, Find Course, Set Alert, Notifications, Auth, Armed
const STEPS = 6;

const BG_DARK = "#000000";
const BG_LIGHT = "#FFFFFF";
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const SWIPE_DISTANCE_THRESHOLD = SCREEN_W * 0.22;
const SWIPE_VELOCITY_THRESHOLD = 600;

type Course = { id: number; name: string; city: string; state: string; time_zone: string };

export default function OnboardingScreen() {
  const router = useRouter();
  const theme = useTheme();
  const isDark = theme.dark;
  const accent = theme.colors.primary;
  const labelColor = theme.colors.onSurfaceVariant;
  const cardBg = isDark ? "rgba(255,255,255,0.06)" : "#fff";
  const cardBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const badgeBorder = isDark ? "rgba(74,222,128,0.35)" : "rgba(21,128,61,0.28)";
  const badgeFill = isDark ? "rgba(74,222,128,0.08)" : "rgba(21,128,61,0.05)";
  const dividerColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const gradColors = isDark
    ? (Colors.dark.gradients.primary as [string, string])
    : (Colors.light.gradients.primary as [string, string]);

  const trialDays = useProTrialDays();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
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
  const [referralCode, setReferralCode] = useState("");
  const [showReferral, setShowReferral] = useState(false);
  const [referralRedeemed, setReferralRedeemed] = useState(false);

  // Notifications
  const [notifGranted, setNotifGranted] = useState(false);

  // Step 6 payoff — "ink stamp" impact animation
  const stampScale = useRef(new RNAnimated.Value(1.5)).current;
  const stampOpacity = useRef(new RNAnimated.Value(0)).current;

  // Reentrancy guards against a fast double-tap firing the alert-creation
  // flow twice. Refs (not state) because state updates aren't synchronous
  // across rapid taps — the check has to be immune to render timing.
  const advancingRef = useRef(false);
  const creatingAlertRef = useRef(false);
  const [advancing, setAdvancing] = useState(false);
  const [enabling, setEnabling] = useState(false);

  // Directional slide transition — wraps setStep so the carousel knows which
  // way to animate (button taps and swipes both funnel through this).
  const goToStep = (newStep: number) => {
    setDirection(newStep >= step ? 1 : -1);
    setStep(newStep);
  };

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
    stampScale.setValue(1.5);
    stampOpacity.setValue(0);
    RNAnimated.sequence([
      RNAnimated.delay(150),
      RNAnimated.parallel([
        RNAnimated.spring(stampScale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
        RNAnimated.timing(stampOpacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]),
    ]).start();
  }, [step]);

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
    if (advancingRef.current) return;
    advancingRef.current = true;
    setAdvancing(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        goToStep(5);
      } else {
        await handleCreateAlert();
      }
    } finally {
      advancingRef.current = false;
      setAdvancing(false);
    }
  };

  const handleEnableNotifications = async () => {
    if (enabling) return;
    setEnabling(true);
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotifGranted(status === "granted");
    } catch {
      // ignore
    } finally {
      setTimeout(() => {
        setEnabling(false);
        advanceFromNotifications();
      }, 800);
    }
  };

  const handleStartWatching = () => {
    if (!selectedCourse || !date || !startTime || !endTime) return;
    goToStep(4);
  };

  // Guards against a fast double-tap firing two overlapping alert-creation
  // calls — both the step-4 "Continue" path and the step-5 OAuth-success
  // path can reach this, so the guard lives here rather than on either button.
  const handleCreateAlert = async () => {
    if (!selectedCourse || !date || !startTime || !endTime) return;
    if (creatingAlertRef.current) return;
    creatingAlertRef.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;

      const tz = selectedCourse.time_zone || dayjs.tz.guess();
      const datePart = dayjs(date).format("YYYY-MM-DD");
      const combine = (t: Date) => dayjs.tz(`${datePart} ${dayjs(t).format("HH:mm:ss")}`, tz);
      const combinedStart = combine(startTime);
      const combinedEnd = combine(endTime);

      await registerForPushNotificationsAsync().catch((e) =>
        console.warn("[Onboarding] Push token error:", e)
      );

      if (referralCode.trim()) {
        try {
          await redeemReferralCode(data.session.user.id, referralCode.trim());
          setReferralRedeemed(true);
        } catch (e) {
          console.warn("[Onboarding] Referral redemption failed:", e);
        }
      }

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

      goToStep(6);
    } catch (err: any) {
      setFormError(err.message || "Failed to create alert. Please try again.");
      goToStep(3);
    } finally {
      setSubmitting(false);
      creatingAlertRef.current = false;
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

  // ── Swipe navigation ──
  // Mirrors exactly what each step's own button/row already does, so swiping
  // never bypasses validation, async alert creation, or the OAuth step.
  const handleSwipeForward = () => {
    if (step === 0) goToStep(1);
    else if (step === 1) goToStep(2);
    else if (step === 3 && !formDisabled) handleStartWatching();
    else if (step === 4) advanceFromNotifications();
    // steps 2 (pick a course) and 5 (tap an OAuth button) require a deliberate tap.
  };
  const handleSwipeBack = () => {
    if (step === 1) goToStep(0);
    else if (step === 2) goToStep(1);
    else if (step === 3) goToStep(2);
    else if (step === 4) goToStep(3);
    else if (step === 5) goToStep(4);
    // step 6 is the terminal payoff screen — no swiping back out of it.
  };

  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-15, 15])
    .onEnd((e) => {
      "worklet";
      if (e.translationX < -SWIPE_DISTANCE_THRESHOLD || e.velocityX < -SWIPE_VELOCITY_THRESHOLD) {
        runOnJS(handleSwipeForward)();
      } else if (e.translationX > SWIPE_DISTANCE_THRESHOLD || e.velocityX > SWIPE_VELOCITY_THRESHOLD) {
        runOnJS(handleSwipeBack)();
      }
    });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? BG_DARK : BG_LIGHT }]}>
      <ScorecardBackground step={step} isDark={isDark} accent={accent} />

      {/* Hole marker — steps 1–5 */}
      {step > 0 && step < 6 && (
        <View style={styles.holeMarkerRow}>
          <Text style={[styles.holeMarkerText, { color: theme.colors.onSurfaceVariant }]}>
            HOLE <Text style={{ color: accent, fontWeight: "800" }}>{String(step).padStart(2, "0")}</Text> OF 06
          </Text>
          <View
            style={[
              styles.holeProgressTrack,
              { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)" },
            ]}
          >
            <View
              style={[
                styles.holeProgressFill,
                { width: `${(step / STEPS) * 100}%` as any, backgroundColor: accent },
              ]}
            />
          </View>
        </View>
      )}

      <GestureDetector gesture={swipeGesture}>
        <View style={{ flex: 1 }}>
          <Animated.View
            key={step}
            entering={direction === 1 ? SlideInRight.duration(280) : SlideInLeft.duration(280)}
            exiting={direction === 1 ? SlideOutLeft.duration(280) : SlideOutRight.duration(280)}
            style={{ flex: 1 }}
          >
            {/* ── STEP 0: Welcome hero ── */}
            {step === 0 && (
              <ScrollView contentContainerStyle={styles.centerContent} keyboardShouldPersistTaps="handled">
                <Text style={[styles.heroTitle, { color: theme.colors.onBackground }]}>
                  Book the courses everyone else can't.
                </Text>
                <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant }]}>
                  TeeSignal watches the tee sheet 24/7 and notifies you the instant a spot opens,
                  even at courses that are always booked solid.
                </Text>

                <LiveTicker accent={accent} isDark={isDark} />

                <CountUpStat accent={accent} labelColor={theme.colors.onSurfaceVariant} />
                <GradientButton
                  onPress={() => goToStep(1)}
                  label="Get Started →"
                  gradColors={gradColors}
                  style={{ marginTop: 32, width: "100%" }}
                />

                {__DEV__ && (
                  <TouchableOpacity
                    onPress={async () => {
                      await AsyncStorage.setItem(ONBOARDING_KEY, "true");
                      router.push("/(auth)/sign-in" as any);
                    }}
                    style={{ marginTop: 12, paddingVertical: 8 }}
                  >
                    <Text style={{ color: "red", textAlign: "center", fontSize: 12 }}>
                      [DEV] Skip to Sign In
                    </Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}

            {/* ── STEP 1: How It Works ── */}
            {step === 1 && (
              <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
                <Text style={[styles.stepTitle, { color: theme.colors.onBackground }]}>
                  How TeeSignal works
                </Text>
                <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant, marginBottom: 24 }]}>
                  Watch it happen in real time.
                </Text>

                <MiniScanDemo accent={accent} isDark={isDark} />

                <View style={{ width: "100%" }}>
                  {[
                    {
                      n: "01",
                      label: "Courses release slots",
                      desc: "Golfers cancel, courses free up prime times — often hours or days before the round.",
                    },
                    {
                      n: "02",
                      label: "TeeSignal scans every 30 min",
                      desc: "We watch your course continuously so you don't have to check yourself.",
                    },
                    {
                      n: "03",
                      label: "You get notified instantly",
                      desc: "The moment a slot opens that matches your alert, we ping you before anyone else sees it.",
                    },
                  ].map((item, index) => (
                    <View
                      key={index}
                      style={[
                        styles.workRow,
                        index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: dividerColor },
                      ]}
                    >
                      <Text style={[styles.workNumeral, { color: accent }]}>{item.n}</Text>
                      <View style={{ flex: 1 }}>
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
                </View>
                <GradientButton
                  onPress={() => goToStep(2)}
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
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        onPress={() => {
                          Keyboard.dismiss();
                          setSelectedCourse(item);
                          goToStep(3);
                        }}
                        activeOpacity={0.7}
                        style={[styles.courseCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
                      >
                        <View style={[styles.courseBadge, { borderColor: badgeBorder, backgroundColor: badgeFill }]}>
                          <MaterialCommunityIcons name="flag-variant" size={19} color={accent} />
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
                      onPress={() => goToStep(2)}
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
                <Text style={[styles.stepTitle, { color: theme.colors.onBackground }]}>
                  Turn on notifications
                </Text>
                <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant }]}>
                  TeeSignal alerts are sent as push notifications. Without them, we can't reach you when a
                  spot opens.
                </Text>
                {notifGranted ? (
                  <>
                    <View
                      style={[
                        styles.successPill,
                        { borderWidth: 1.5, borderColor: badgeBorder, backgroundColor: badgeFill },
                      ]}
                    >
                      <Text style={{ color: accent, fontWeight: "700", fontSize: 15 }}>
                        ✓ Notifications enabled
                      </Text>
                    </View>
                    <GradientButton
                      onPress={advanceFromNotifications}
                      label="Continue →"
                      loading={advancing || submitting}
                      gradColors={gradColors}
                      style={{ width: "100%", marginTop: 20 }}
                    />
                  </>
                ) : (
                  <>
                    <GradientButton
                      onPress={handleEnableNotifications}
                      label="Enable Notifications"
                      loading={enabling}
                      disabled={advancing || submitting}
                      gradColors={gradColors}
                      style={{ width: "100%", marginTop: 8 }}
                    />
                    <TouchableOpacity
                      onPress={advanceFromNotifications}
                      disabled={enabling || advancing || submitting}
                      style={{ marginTop: 20, opacity: enabling || advancing || submitting ? 0.4 : 1 }}
                    >
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

                {!showReferral ? (
                  <TouchableOpacity
                    onPress={() => setShowReferral(true)}
                    style={{ marginTop: 20, paddingVertical: 8, paddingHorizontal: 12 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text
                      style={{ color: accent, fontSize: 15, fontWeight: "700", textAlign: "center" }}
                    >
                      Have a referral code? Tap here →
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TextInput
                    mode="outlined"
                    placeholder="Referral code"
                    value={referralCode}
                    onChangeText={(t) => setReferralCode(t.toUpperCase())}
                    autoCapitalize="characters"
                    style={[
                      styles.referralInput,
                      { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#fff" },
                    ]}
                    outlineStyle={{
                      borderRadius: 14,
                      borderWidth: isDark ? 1 : 0,
                      borderColor: isDark ? "rgba(255,255,255,0.08)" : "transparent",
                    }}
                    textColor={theme.colors.onSurface}
                  />
                )}

                <TouchableOpacity
                  onPress={() => router.push("/(auth)/sign-in?redirectTo=/onboarding" as any)}
                  style={{ marginTop: 20 }}
                >
                  <Text
                    style={{ color: accent, fontSize: 14, fontWeight: "600", textAlign: "center" }}
                  >
                    Already have an account? Sign in →
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => goToStep(4)} style={{ marginTop: 12 }}>
                  <Text
                    style={{ color: theme.colors.onSurfaceVariant, fontSize: 14, textAlign: "center" }}
                  >
                    ← Back
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}

            {/* ── STEP 6: Confirmed ── */}
            {step === 6 && (
              <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
                {/* Ink-stamp payoff */}
                <RNAnimated.View
                  style={[
                    styles.stampBadge,
                    {
                      borderColor: accent,
                      transform: [{ scale: stampScale }, { rotate: "-4deg" }],
                      opacity: stampOpacity,
                    },
                  ]}
                >
                  <MaterialCommunityIcons name="flag-checkered" size={20} color={accent} />
                  <Text style={[styles.stampText, { color: accent }]}>CONFIRMED</Text>
                </RNAnimated.View>

                <Text style={[styles.stepTitle, { color: theme.colors.onBackground, marginTop: 28 }]}>
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
                  {referralRedeemed ? (
                    <>
                      <Text
                        style={{ color: theme.colors.onSurface, fontWeight: "800", fontSize: 16, marginBottom: 6 }}
                      >
                        You're on Pro for 7 days
                      </Text>
                      <Text
                        style={{
                          color: theme.colors.onSurfaceVariant,
                          fontSize: 14,
                          lineHeight: 20,
                        }}
                      >
                        Your referral code unlocked 1-minute scans, 10 active alerts, and recurring
                        weekly alerts — on us, for a week.
                      </Text>
                    </>
                  ) : (
                    <>
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
                        label={`Start ${trialDays}-Day Free Trial`}
                        gradColors={gradColors}
                      />
                    </>
                  )}
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
                      goToStep(0);
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
          </Animated.View>
        </View>
      </GestureDetector>

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

// ── Scorecard Background ──────────────────────────────────────────────────────
// Restrained in-palette decoration: a few rule lines echoing a scorecard
// table, plus an oversized hole-number watermark that doubles as the step
// indicator (structure as information, not a gradient blob).
const ScorecardBackground = React.memo(
  ({ step, isDark, accent }: { step: number; isDark: boolean; accent: string }) => {
    const ink = isDark ? "rgba(74,222,128,0.07)" : "rgba(21,128,61,0.055)";
    const line = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.045)";
    // Step 0 is the welcome screen, not a hole — it gets no number. Steps 1–5
    // match the "HOLE 0X" marker exactly (not step + 1, which was off by one).
    const label = step === 0 ? null : step === 6 ? "✓" : String(step).padStart(2, "0");
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {[0.12, 0.17, 0.22].map((t, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              top: SCREEN_H * t,
              left: 0,
              right: 0,
              height: StyleSheet.hairlineWidth,
              backgroundColor: line,
            }}
          />
        ))}
        {label && (
        <Text
          style={{
            position: "absolute",
            bottom: -SCREEN_H * 0.07,
            right: -SCREEN_W * 0.08,
            fontSize: SCREEN_W * 0.72,
            fontWeight: "800",
            color: ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {label}
        </Text>
        )}
      </View>
    );
  }
);

// ── Gradient Button ────────────────────────────────────────────────────────────
// ── Live Ticker ─────────────────────────────────────────────────────────────────
// A small cross-fading line of real-sounding "spot opened" examples with a
// pulsing live-dot — proof the product is actually watching something,
// shown before the "How It Works" demo even explains the mechanic.
// Real, currently-supported courses (verified against the courses table) —
// not famous names picked for recognizability that we don't actually cover.
const TICKER_ITEMS = [
  "Bethpage Black · 6:50 AM opened",
  "Torrey Pines South · 1:30 PM opened",
  "TPC Scottsdale · 8:10 AM opened",
  "Chambers Bay · 3:40 PM opened",
];

const LiveTicker: React.FC<{ accent: string; isDark: boolean }> = ({ accent, isDark }) => {
  const [index, setIndex] = useState(0);
  const opacity = useRef(new RNAnimated.Value(0)).current;
  const pulse = useRef(new RNAnimated.Value(1)).current;

  useEffect(() => {
    const pulseLoop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulse, { toValue: 1.7, duration: 650, useNativeDriver: true }),
        RNAnimated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ])
    );
    pulseLoop.start();

    RNAnimated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    const timer = setInterval(() => {
      RNAnimated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        setIndex((i) => (i + 1) % TICKER_ITEMS.length);
        RNAnimated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }).start();
      });
    }, 2600);

    return () => {
      pulseLoop.stop();
      clearInterval(timer);
    };
  }, []);

  return (
    <View style={styles.tickerRow}>
      <RNAnimated.View style={[styles.tickerDot, { backgroundColor: accent, transform: [{ scale: pulse }] }]} />
      <RNAnimated.Text
        style={[styles.tickerText, { color: isDark ? "rgba(255,255,255,0.5)" : "#64748B", opacity }]}
      >
        {TICKER_ITEMS[index]}
      </RNAnimated.Text>
    </View>
  );
};

// ── Count-Up Stat ───────────────────────────────────────────────────────────────
// "50+" counts up on mount instead of appearing static — a cheap, concrete
// signal that the number is real and live, not decoration.
const CountUpStat: React.FC<{ accent: string; labelColor: string }> = ({ accent, labelColor }) => {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let raf: number;
    const start = Date.now();
    const duration = 900;
    const tick = () => {
      const t = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(eased * 50));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <View style={styles.counterCard}>
      <Text style={[styles.counterNumber, { color: accent, fontVariant: ["tabular-nums"] }]}>
        {display}+
      </Text>
      <Text style={[styles.counterLabel, { color: labelColor }]}>
        Tee times snagged by TeeSignal{"\n"}users this month
      </Text>
    </View>
  );
};

// ── Mini Scan Demo ─────────────────────────────────────────────────────────────
// Shows the actual mechanic instead of standing in for it with an icon: a row
// of tee-time slots, one flips from booked to open, then a notification
// slides in — the whole "How It Works" explanation in one looping animation.
const DEMO_TIMES = ["7:40", "8:10", "8:40", "9:10", "9:40"];
const DEMO_OPEN_INDEX = 2;

const MiniScanDemo: React.FC<{ accent: string; isDark: boolean }> = ({ accent, isDark }) => {
  const flip = useRef(new RNAnimated.Value(0)).current;
  const notifProgress = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.delay(700),
        RNAnimated.timing(flip, { toValue: 1, duration: 420, useNativeDriver: false }),
        RNAnimated.timing(notifProgress, { toValue: 1, duration: 320, useNativeDriver: false }),
        RNAnimated.delay(1500),
        RNAnimated.timing(notifProgress, { toValue: 0, duration: 260, useNativeDriver: false }),
        RNAnimated.timing(flip, { toValue: 0, duration: 320, useNativeDriver: false }),
        RNAnimated.delay(500),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const bookedBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const bookedText = isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.32)";

  const slotBg = flip.interpolate({ inputRange: [0, 1], outputRange: [bookedBg, accent] });
  const slotTextColor = flip.interpolate({ inputRange: [0, 1], outputRange: [bookedText, "#FFFFFF"] });
  const slotScale = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.08, 1] });
  const notifTranslate = notifProgress.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] });

  return (
    <View style={styles.demoWrap}>
      <View style={styles.demoSlotRow}>
        {DEMO_TIMES.map((t, i) =>
          i === DEMO_OPEN_INDEX ? (
            <RNAnimated.View
              key={i}
              style={[styles.demoSlot, { backgroundColor: slotBg, transform: [{ scale: slotScale }] }]}
            >
              <RNAnimated.Text style={[styles.demoSlotTime, { color: slotTextColor }]}>{t}</RNAnimated.Text>
            </RNAnimated.View>
          ) : (
            <View key={i} style={[styles.demoSlot, { backgroundColor: bookedBg }]}>
              <Text style={[styles.demoSlotTime, { color: bookedText }]}>{t}</Text>
            </View>
          )
        )}
      </View>
      <RNAnimated.View
        style={[
          styles.demoNotif,
          {
            borderColor: accent,
            opacity: notifProgress,
            transform: [{ translateY: notifTranslate }],
          },
        ]}
      >
        <MaterialCommunityIcons name="bell-ring-outline" size={14} color={accent} />
        <Text style={[styles.demoNotifText, { color: accent }]}>Spot opened · 8:40 AM</Text>
      </RNAnimated.View>
    </View>
  );
};

const GradientButton: React.FC<{
  onPress: () => void;
  label: string;
  disabled?: boolean;
  loading?: boolean;
  gradColors: [string, string];
  style?: object;
}> = ({ onPress, label, disabled, loading, gradColors, style }) => {
  const theme = useTheme();
  const isDark = theme.dark;
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity onPress={onPress} disabled={isDisabled} activeOpacity={0.8} style={style}>
      <LinearGradient
        colors={
          isDisabled
            ? isDark
              ? ["rgba(255,255,255,0.08)", "rgba(255,255,255,0.08)"]
              : ["#E2E8F0", "#E2E8F0"]
            : gradColors
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.gradientButton}
      >
        {loading ? (
          <ActivityIndicator
            animating
            size="small"
            color={isDark ? "rgba(255,255,255,0.25)" : "#94A3B8"}
          />
        ) : (
        <Text
          style={{
            color: isDisabled
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
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },

  holeMarkerRow: {
    paddingTop: 16,
    paddingBottom: 10,
    paddingHorizontal: 28,
  },
  holeMarkerText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.2,
    textAlign: "center",
    marginBottom: 8,
    fontVariant: ["tabular-nums"],
  },
  holeProgressTrack: {
    height: 2,
    borderRadius: 1,
    overflow: "hidden",
  },
  holeProgressFill: {
    height: 2,
    borderRadius: 1,
  },

  // Shared layouts
  centerContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingVertical: 40,
  },

  // Step 0 – hero
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
  tickerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 22,
  },
  tickerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 8,
  },
  tickerText: {
    fontSize: 12.5,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  counterCard: {
    width: "100%",
    marginTop: 26,
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

  // Steps 4 / 5
  stepTitle: {
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: -0.5,
  },

  // Step 1 – How It Works: flush numbered list (no card boxes, no icon badges)
  workRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 16,
    width: "100%",
  },
  workNumeral: {
    fontSize: 14,
    fontWeight: "800",
    width: 32,
    paddingTop: 1,
    fontVariant: ["tabular-nums"],
  },
  howItWorksLabel: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    marginBottom: 3,
  },
  howItWorksDesc: { fontSize: 13, lineHeight: 19 },

  // Step 1 – mini scan demo
  demoWrap: {
    width: "100%",
    alignItems: "center",
    marginBottom: 20,
  },
  demoSlotRow: {
    flexDirection: "row",
    gap: 7,
  },
  demoSlot: {
    width: 46,
    height: 54,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  demoSlotTime: {
    fontSize: 11,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  demoNotif: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  demoNotifText: { fontSize: 12.5, fontWeight: "700" },

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
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    marginRight: 13,
    justifyContent: "center",
    alignItems: "center",
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

  // Step 5 – referral
  referralInput: {
    marginTop: 20,
    width: "100%",
  },

  // Step 6 – confirmed
  stampBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 3,
    borderRadius: 16,
    paddingHorizontal: 26,
    paddingVertical: 14,
  },
  stampText: {
    fontWeight: "800",
    fontSize: 19,
    letterSpacing: 1.6,
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
