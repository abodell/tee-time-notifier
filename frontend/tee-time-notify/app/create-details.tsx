import React, { useState } from "react";
import { SafeAreaView, StyleSheet, View } from "react-native";
import {
  Text,
  SegmentedButtons,
  Button,
  IconButton,
  useTheme,
} from "react-native-paper";
import { useLocalSearchParams, useRouter } from "expo-router";
import DatePickerField from "../components/DatePickerField";
import TimePickerField from "../components/TimePickerField";

export default function CreateDetailsScreen() {
  const { name } = useLocalSearchParams();
  const router = useRouter();
  const theme = useTheme();

  const [holes, setHoles] = useState("18");
  const [date, setDate] = useState<Date | null>(null);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);

  const handleSubmit = () => {
    // simple demo only — you can still add final validation here if needed
    router.back();
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
    >
      <View style={styles.headerRow}>
        <IconButton
          icon="arrow-left"
          size={24}
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={styles.backBtn}
        />
        <Text
          variant="titleLarge"
          style={[styles.title, { color: theme.colors.onBackground }]}
        >
          {name}
        </Text>
      </View>

      <Text style={[styles.subtitle, { color: theme.colors.onSurface }]}>
        Choose your preferred window
      </Text>

      <SegmentedButtons
        value={holes}
        onValueChange={setHoles}
        buttons={[
          { value: "9", label: "9 Holes" },
          { value: "18", label: "18 Holes" },
        ]}
        style={{ marginBottom: 16 }}
      />

      <DatePickerField
        label="Preferred Date"
        value={date}
        onChange={setDate}
      />

      <TimePickerField
        label="Preferred Start Time"
        value={startTime}
        onChange={setStartTime}
        selectedDate={date}
      />

      <TimePickerField
        label="Preferred End Time"
        value={endTime}
        onChange={setEndTime}
        selectedDate={date}
        startTime={startTime}
      />

      <Button
        mode="contained"
        style={{ marginTop: 24 }}
        onPress={handleSubmit}
      >
        Create Alert
      </Button>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, paddingHorizontal: 20, paddingTop: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  backBtn: { marginLeft: -6, marginRight: 6 },
  title: { fontWeight: "600", fontSize: 22 },
  subtitle: { marginBottom: 16, fontSize: 15 },
});