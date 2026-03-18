import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Linking,
} from "react-native";
import { Text, Surface, useTheme, Divider, TextInput as PaperTextInput } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { createAlert, triggerImmediateScan } from "@/lib/api";
import { registerForPushNotificationsAsync } from "@/lib/notifications";
import { Colors } from "@/constants/theme";
import DatePickerField from "@/components/DatePickerField";
import TimePickerField from "@/components/TimePickerField";
import OAuthSection from "@/components/auth/OAuthSection";
import * as Notifications from "expo-notifications";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

export const ONBOARDING_KEY = "onboarding_completed";


// Steps: 0=Welcome, 1=Notifications, 2=Find Course, 3=Set Alert, 4=Create Account, 5=Armed
const STEPS = 5;

type Course = { id: number; name: string; city: string; state: string; time_zone: string };

export default function OnboardingScreen() {
  const router = useRouter();
  const theme = useTheme();

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
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Auth wall (step 4)
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Notifications (step 1)
  const [notifGranted, setNotifGranted] = useState(false);

  // Counting number animation for step 0
  const [countNum, setCountNum] = useState(0);
  const countTarget = useRef(
    Math.floor(Math.random() * (500 - 75 + 1)) + 75
  ).current;

  useEffect(() => {
    const DURATION = 2200;
    const INTERVAL = 40;
    const steps = DURATION / INTERVAL;
    let frame = 0;
    const timer = setInterval(() => {
      frame++;
      const progress = 1 - Math.pow(1 - frame / steps, 3);
      setCountNum(Math.round(progress * countTarget));
      if (frame >= steps) {
        setCountNum(countTarget);
        clearInterval(timer);
      }
    }, INTERVAL);
    return () => clearInterval(timer);
  }, []);

  // Pulse animation for step 5 (Armed)
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (step !== 5) return;
    const anim = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.45, duration: 1100, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 1100, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 0.15, duration: 1100, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.55, duration: 1100, useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [step]);

  // Check existing notification permission on mount
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

  const handleEnableNotifications = async () => {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      setNotifGranted(status === "granted");
    } catch {
      // ignore
    } finally {
      setTimeout(() => setStep(2), 800);
    }
  };

  // Called when "Start Watching →" is tapped on step 3.
  // If already authenticated, create the alert directly.
  // Otherwise, advance to step 4 (auth wall) — onSuccess will call handleCreateAlert.
  const handleStartWatching = async () => {
    if (!selectedCourse || !date || !startTime || !endTime) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setStep(4);
      return;
    }
    handleCreateAlert();
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

      const payload = {
        user_id: data.session.user.id,
        holes: 18,
        course_id: selectedCourse.id,
        date_from: combinedStart.startOf("day").toISOString(),
        date_to: combinedEnd.startOf("day").toISOString(),
        start_time: combinedStart.toISOString(),
        end_time: combinedEnd.toISOString(),
        is_recurring: false,
      };

      // Register push token now so the scan-now can reach the user immediately
      console.log("[Onboarding] Registering push token...");
      await registerForPushNotificationsAsync().catch((e) => console.warn("[Onboarding] Push token error:", e));

      const result = await createAlert(payload);
      const createdId = result.alert?.id;

      // Fire the immediate scan — don't await, let it run in the background
      if (createdId) {
        triggerImmediateScan(createdId).catch(() => {});
      }

      setStep(5);
    } catch (err: any) {
      // If alert creation fails after auth, show error on step 3 and go back
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Progress dots — shown for steps 1–4 */}
      {step > 0 && step < 5 && (
        <View style={styles.progressRow}>
          {Array.from({ length: STEPS }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    i < step ? theme.colors.primary : theme.colors.surfaceVariant,
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
          <Text
            variant="displaySmall"
            style={[styles.heroTitle, { color: theme.colors.onBackground }]}
          >
            Book the courses everyone else can't.
          </Text>
          <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant }]}>
            TeeSignal watches the tee sheet 24/7 and notifies you the instant a spot opens — even at
            courses that are always booked solid.
          </Text>

          <View style={styles.counterCard}>
            <Text style={[styles.counterNumber, { color: theme.colors.onBackground, fontVariant: ["tabular-nums"] }]}>
              {countNum.toLocaleString()}
            </Text>
            <Text style={[styles.counterLabel, { color: theme.colors.onSurfaceVariant }]}>
              Tee Times snagged by TeeSignal{"\n"}users this month
            </Text>
          </View>

          <GradientButton
            onPress={() => setStep(1)}
            label="Get Started →"
            style={{ marginTop: 32, width: "100%" }}
          />
        </ScrollView>
      )}

      {/* ── STEP 1: Enable Notifications ── */}
      {step === 1 && (
        <View style={styles.centerContent}>
          <Text style={styles.stepEmoji}>🔔</Text>
          <Text
            variant="headlineMedium"
            style={[styles.stepTitle, { color: theme.colors.onBackground }]}
          >
            Turn on notifications
          </Text>
          <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant }]}>
            TeeSignal alerts are sent as push notifications. Without them, we can't reach you when a
            spot opens.
          </Text>

          {notifGranted ? (
            <Surface
              style={[styles.successPill, { backgroundColor: theme.colors.primaryContainer }]}
              elevation={0}
            >
              <Text style={{ color: theme.colors.onPrimaryContainer, fontWeight: "700", fontSize: 15 }}>
                ✓ Notifications enabled
              </Text>
            </Surface>
          ) : (
            <GradientButton
              onPress={handleEnableNotifications}
              label="Enable Notifications"
              style={{ width: "100%", marginTop: 8 }}
            />
          )}

          <TouchableOpacity onPress={() => setStep(2)} style={{ marginTop: 20 }}>
            <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: "center", fontSize: 14 }}>
              Maybe later
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── STEP 2: Find a course ── */}
      {step === 2 && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={[styles.stepTop, { paddingHorizontal: 24 }]}>
            <Text
              variant="headlineMedium"
              style={[styles.stepTitle, { color: theme.colors.onBackground }]}
            >
              Find your course
            </Text>
            <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant }]}>
              Which course are you trying to get on?
            </Text>

            <PaperTextInput
              placeholder="Search courses..."
              value={courseQuery}
              onChangeText={handleCourseSearch}
              mode="outlined"
              left={<PaperTextInput.Icon icon="magnify" color={theme.colors.onSurfaceVariant} />}
              style={[styles.searchBar, { backgroundColor: theme.colors.surface }]}
              outlineStyle={{ borderRadius: 12, borderWidth: 0 }}
              textColor={theme.colors.onSurface}
              placeholderTextColor={theme.colors.onSurfaceVariant}
              autoFocus
            />
          </View>

          {coursesLoading ? (
            <Text style={{ textAlign: "center", color: theme.colors.onSurfaceVariant, marginTop: 32 }}>
              Searching...
            </Text>
          ) : courses.length === 0 && courseQuery.length > 0 ? (
            <Text style={{ textAlign: "center", color: theme.colors.onSurfaceVariant, marginTop: 32 }}>
              No courses found for "{courseQuery}"
            </Text>
          ) : (
            <FlatList
              data={courses}
              keyExtractor={(item) => String(item.id)}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  onPress={() => {
                    Keyboard.dismiss();
                    setSelectedCourse(item);
                    setStep(3);
                  }}
                  activeOpacity={0.7}
                  style={[
                    styles.courseItem,
                    {
                      backgroundColor: theme.colors.surface,
                      borderTopLeftRadius: index === 0 ? 16 : 0,
                      borderTopRightRadius: index === 0 ? 16 : 0,
                      borderBottomLeftRadius: index === courses.length - 1 ? 16 : 0,
                      borderBottomRightRadius: index === courses.length - 1 ? 16 : 0,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      variant="titleSmall"
                      style={{ color: theme.colors.onSurface, fontWeight: "700" }}
                    >
                      {item.name}
                    </Text>
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: 2 }}>
                      {item.city}, {item.state}
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 20 }}>›</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => (
                <View style={{ height: 1, backgroundColor: theme.colors.outline + "30" }} />
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
            contentContainerStyle={[styles.stepTop, { paddingHorizontal: 24, paddingBottom: 40 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text
              variant="headlineMedium"
              style={[styles.stepTitle, { color: theme.colors.onBackground }]}
            >
              When do you want to play?
            </Text>
            <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant }]}>
              {selectedCourse?.name}
            </Text>

            <Surface
              style={[styles.formCard, { backgroundColor: theme.colors.surface }]}
              elevation={0}
            >
              <View style={{ marginBottom: 16 }}>
                <DatePickerField label="Date" value={date} onChange={setDate} />
              </View>
              <Divider style={{ marginBottom: 16, opacity: 0.4 }} />
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

            {formError && (
              <View style={[styles.errorBox, { backgroundColor: theme.colors.errorContainer }]}>
                <Text style={{ color: theme.colors.onErrorContainer, fontSize: 13 }}>{formError}</Text>
              </View>
            )}

            <GradientButton
              onPress={handleStartWatching}
              label="Start Watching →"
              disabled={formDisabled}
              style={{ marginTop: 28 }}
            />

            <TouchableOpacity onPress={() => setStep(2)} style={{ marginTop: 16, alignSelf: "center" }}>
              <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 14 }}>
                ← Pick a different course
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ── STEP 4: Create account (auth wall) ── */}
      {step === 4 && (
        <ScrollView contentContainerStyle={styles.centerContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.stepEmoji}>👋</Text>
          <Text
            variant="headlineMedium"
            style={[styles.stepTitle, { color: theme.colors.onBackground }]}
          >
            Almost there
          </Text>
          <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant }]}>
            Create a free account to activate your alert. We'll start watching the moment you're in.
          </Text>

          {oauthError && (
            <View style={[styles.errorBox, { backgroundColor: theme.colors.errorContainer, marginBottom: 8, width: "100%" }]}>
              <Text style={{ color: theme.colors.onErrorContainer, fontSize: 13 }}>{oauthError}</Text>
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
            <Text style={{ color: theme.colors.primary, fontSize: 14, fontWeight: "600", textAlign: "center" }}>
              Already have an account? Sign in →
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setStep(3)} style={{ marginTop: 12 }}>
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 14, textAlign: "center" }}>
              ← Back
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── STEP 5: Sniper Armed + upsell ── */}
      {step === 5 && (
        <ScrollView contentContainerStyle={styles.centerContent} showsVerticalScrollIndicator={false}>
          {/* Pulsing radar circle */}
          <View style={styles.pulseContainer}>
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  borderColor: theme.colors.primary,
                  transform: [{ scale: pulseScale }],
                  opacity: pulseOpacity,
                },
              ]}
            />
            <View style={[styles.pulseCore, { backgroundColor: theme.colors.primary + "18" }]}>
              <Text style={{ fontSize: 48 }}>🎯</Text>
            </View>
          </View>

          <Text
            variant="headlineMedium"
            style={[styles.stepTitle, { color: theme.colors.onBackground, marginTop: 32 }]}
          >
            Sniper Armed
          </Text>
          <Text
            style={[styles.bodyText, { color: theme.colors.onSurface, fontWeight: "600", marginBottom: 4 }]}
          >
            {selectedCourse?.name} is being watched.
          </Text>
          <Text style={[styles.bodyText, { color: theme.colors.onSurfaceVariant, marginBottom: 32 }]}>
            We just ran a scan for you. Check your notifications.
          </Text>

          {/* Trial upsell */}
          <Surface
            style={[styles.upsellCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outline + "30" }]}
            elevation={0}
          >
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
            />
          </Surface>

          <TouchableOpacity onPress={complete} style={{ marginTop: 20, paddingVertical: 8 }}>
            <Text style={{ color: theme.colors.onSurfaceVariant, textAlign: "center", fontSize: 14 }}>
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
    </SafeAreaView>
  );
}

// ── Shared gradient button ──────────────────────────────────────────────────
const GradientButton: React.FC<{
  onPress: () => void;
  label: string;
  disabled?: boolean;
  style?: object;
}> = ({ onPress, label, disabled, style }) => {
  const theme = useTheme();
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.8} style={style}>
      <LinearGradient
        colors={
          (disabled
            ? [theme.colors.surfaceDisabled, theme.colors.surfaceDisabled]
            : Colors.light.gradients.primary) as [string, string, ...string[]]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.gradientButton, { opacity: disabled ? 0.6 : 1 }]}
      >
        <Text
          style={{
            color: disabled ? theme.colors.onSurfaceDisabled : "#FFF",
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
  dot: {
    height: 8,
    borderRadius: 4,
  },

  // Step layouts
  centerContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  stepTop: {
    paddingTop: 32,
  },

  // Hero (step 0)
  heroEmoji: { fontSize: 72, marginBottom: 24 },
  heroTitle: {
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 16,
    letterSpacing: -0.5,
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
  counterRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 10,
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

  // Steps 1-4
  stepEmoji: { fontSize: 56, marginBottom: 20, textAlign: "center" },
  stepTitle: {
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
    letterSpacing: -0.3,
  },

  // Notifications
  successPill: {
    borderRadius: 30,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 20,
  },

  // Course search
  searchBar: {
    marginTop: 20,
    marginBottom: 4,
  },
  courseItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 18,
  },

  // Alert form
  formCard: {
    borderRadius: 16,
    padding: 20,
    marginTop: 24,
  },
  errorBox: {
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },

  // Step 5 pulse
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

  // Upsell card
  upsellCard: {
    borderRadius: 20,
    padding: 24,
    width: "100%",
    borderWidth: 1,
  },

  // Gradient button
  gradientButton: {
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2F80ED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
});
