import React, { useState } from "react";
import { SafeAreaView, StyleSheet, View, ScrollView } from "react-native";
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
  const [time, setTime] = useState<Date | null>(null);

  const handleSubmit = () => {
    router.back();
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Top Section */}
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
          Select your preferences
        </Text>

        <SegmentedButtons
          value={holes}
          onValueChange={setHoles}
          buttons={[
            { value: "9", label: "9 Holes" },
            { value: "18", label: "18 Holes" },
          ]}
          style={{ marginBottom: 20 }}
        />

        {/* Pickers */}
        <DatePickerField
          label="Preferred Date"
          value={date}
          onChange={setDate}
        />
        <TimePickerField
          label="Preferred Time"
          value={time}
          onChange={setTime}
        />

        <Button
          mode="contained"
          style={styles.submit}
          onPress={handleSubmit}
        >
          Create Alert
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    marginTop: 6,
  },
  backBtn: {
    marginLeft: -6,
    marginRight: 6,
  },
  title: {
    fontWeight: "600",
    fontSize: 22,
  },
  subtitle: {
    marginBottom: 20,
    fontSize: 15,
  },
  submit: {
    marginTop: 24,
    marginBottom: 10,
  },
});