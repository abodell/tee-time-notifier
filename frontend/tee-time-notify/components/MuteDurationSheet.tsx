import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import RNModal from "react-native-modal";
import { Text, useTheme } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import PressableScale from "@/components/PressableScale";
import dayjs from "dayjs";

export type MuteDuration = "1_day" | "3_days" | "1_week" | "indefinite";

const OPTIONS: { key: MuteDuration; label: string; icon: string }[] = [
  { key: "1_day", label: "1 Day", icon: "weather-night" },
  { key: "3_days", label: "3 Days", icon: "calendar-range" },
  { key: "1_week", label: "1 Week", icon: "calendar-week" },
  { key: "indefinite", label: "Until I turn it back on", icon: "bell-off-outline" },
];

/** Resolves a duration choice to the muted_until ISO timestamp the API expects. */
export function resolveMuteDuration(duration: MuteDuration): string {
  const now = dayjs();
  switch (duration) {
    case "1_day":
      return now.add(1, "day").toISOString();
    case "3_days":
      return now.add(3, "day").toISOString();
    case "1_week":
      return now.add(1, "week").toISOString();
    case "indefinite":
      // No separate "forever" state on the backend — a far-future timestamp
      // reads the same as indefinite without needing a third null/non-null
      // mode to reason about everywhere muted_until is checked.
      return now.add(100, "year").toISOString();
  }
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (duration: MuteDuration) => void;
}

/** Bottom sheet for picking how long to mute an alert. */
export default function MuteDurationSheet({ visible, onClose, onSelect }: Props) {
  const theme = useTheme();
  const isDark = theme.dark;

  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onClose}
      onBackButtonPress={onClose}
      style={styles.modal}
      backdropTransitionOutTiming={0}
      backdropColor="rgba(0,0,0,0.4)"
      animationIn="slideInUp"
      animationOut="slideOutDown"
      useNativeDriver
    >
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.outline,
          },
        ]}
      >
        <Text style={[styles.title, { color: theme.colors.onSurface }]}>
          Mute This Alert
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>
          Pause notifications for this course. You can unmute anytime.
        </Text>

        {OPTIONS.map((opt, i) => (
          <PressableScale
            key={opt.key}
            onPress={() => onSelect(opt.key)}
            haptic="select"
            scaleTo={0.98}
            style={[
              styles.row,
              i < OPTIONS.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
              },
            ]}
          >
            <MaterialCommunityIcons
              name={opt.icon as any}
              size={18}
              color={theme.colors.onSurfaceVariant}
              style={{ marginRight: 12, opacity: 0.8 }}
            />
            <Text style={[styles.rowLabel, { color: theme.colors.onSurface }]}>
              {opt.label}
            </Text>
          </PressableScale>
        ))}

        <PressableScale onPress={onClose} haptic="none" scaleTo={0.98} style={styles.cancelBtn}>
          <Text style={[styles.cancelText, { color: theme.colors.onSurfaceVariant }]}>
            Cancel
          </Text>
        </PressableScale>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  modal: {
    justifyContent: "flex-end",
    margin: 0,
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: Platform.OS === "ios" ? StyleSheet.hairlineWidth : 0,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "500",
  },
  cancelBtn: {
    marginTop: 12,
    alignItems: "center",
    paddingVertical: 10,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
