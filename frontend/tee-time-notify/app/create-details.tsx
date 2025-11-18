import React, { useState } from "react";
import { createAlert } from "@/lib/api";
import Toast from "react-native-toast-message";
import {
  StyleSheet,
  View,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import {
  Text,
  SegmentedButtons,
  Button,
  IconButton,
  useTheme,
  Divider,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import DatePickerField from "../components/DatePickerField";
import TimePickerField from "../components/TimePickerField";

function combinedDateAndTime(date: Date, time: Date) {
  const combined = new Date(date)
  combined.setHours(time.getHours())
  combined.setMinutes(time.getMinutes())
  combined.setSeconds(time.getSeconds())
  combined.setMilliseconds(0)
  return combined
}

export default function CreateDetailsScreen() {
  const { name } = useLocalSearchParams();
  const router = useRouter();
  const theme = useTheme();
  const { width } = useWindowDimensions();

  const [holes, setHoles] = useState<string>("18");
  const [date, setDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [startValid, setStartValid] = useState(false);
  const [endValid, setEndValid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.push("/(auth)/sign-in");
      return;
    }

    try {
      setSubmitting(true);
      // Combine the selected date with the chosen times
      const combinedStart = date && startTime ? combinedDateAndTime(date, startTime) : null
      const combinedEnd = date && endTime ? combinedDateAndTime(date, endTime) : null
      
      const alertPayload = {
        user_id: data.session.user.id,
        holes: parseInt(holes),
        course_id: 1,
        date_from: date?.toISOString(),
        date_to: date?.toISOString(),
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
            size={26}
            onPress={() => router.back()}
            style={styles.backBtn}
          />
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text
              variant="headlineSmall"
              style={[styles.title, { color: onBackground, textAlign: "center" }]}
            >
              {name}
            </Text>
          </View>
          <IconButton icon="arrow-left" size={26} disabled style={{ opacity: 0 }} />
        </View>

        <Text style={[styles.subtitle, { color: onSurfaceVariant }]}>
          Choose your preferred tee time window
        </Text>

        <Divider style={{ marginVertical: 8, opacity: 0.4 }} />

        {/* Hole Selection */}
        <Text style={[styles.sectionLabel, { color: onSurfaceVariant }]}>
          Number of Holes
        </Text>
        <SegmentedButtons
          value={holes}
          onValueChange={setHoles}
          buttons={[
            { value: "9", label: "9 Holes" },
            { value: "18", label: "18 Holes" },
          ]}
          style={{ marginBottom: 28 }}
        />

        {/* Date / Time Fields */}
        <Text style={[styles.sectionLabel, { color: onSurfaceVariant }]}>
          Preferred Window
        </Text>

        <View style={{ marginBottom: 12 }}>
          <DatePickerField
            label="Preferred Date"
            value={date}
            onChange={setDate}
          />
        </View>

        <View style={{ marginBottom: 8 }}>
          <TimePickerField
            label="Preferred Start Time"
            value={startTime}
            onChange={setStartTime}
            selectedDate={date}
            onValidityChange={setStartValid}
          />
        </View>

        <TimePickerField
          label="Preferred End Time"
          value={endTime}
          onChange={setEndTime}
          selectedDate={date}
          startTime={startTime}
          onValidityChange={setEndValid}
        />

        <View style={{ marginTop: 40, marginBottom: 20 }}>
          <Button
            mode="contained"
            disabled={buttonDisabled}
            contentStyle={styles.buttonContent}
            style={[styles.ctaButton, buttonDisabled && { opacity: 0.6 }]}
            labelStyle={{ fontSize: 16, fontWeight: "600" }}
            onPress={handleSubmit}
            loading={submitting}
          >
            Create Alert
          </Button>
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
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  backBtn: {
    marginLeft: -4,
  },
  title: {
    fontWeight: "600",
  },
  subtitle: {
    marginBottom: 20,
    textAlign: "center",
    fontSize: 15,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  buttonContent: {
    height: 48,
  },
  ctaButton: {
    borderRadius: 12,
  },
});