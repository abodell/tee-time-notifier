import React, { useState } from "react";
import { Pressable, View, Platform, StyleSheet } from "react-native";
import { TextInput, useTheme } from "react-native-paper";
import DateTimePicker from "@react-native-community/datetimepicker";
import dayjs from "dayjs";
import PickerModal from "./PickerModal";

export default function DatePickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date | null;
  onChange: (d: Date) => void;
}) {
  const [visible, setVisible] = useState(false);
  const theme = useTheme();
  const isDark = theme.dark;

  return (
    <>
      <Pressable onPress={() => setVisible(true)}>
        <View pointerEvents="none">
          <TextInput
            label={label}
            mode="outlined"
            value={value ? dayjs(value).format("MMM D, YYYY") : ""}
            right={<TextInput.Icon icon="calendar" />}
            placeholder="Select Date"
            style={styles.field}
          />
        </View>
      </Pressable>

      <PickerModal
        visible={visible}
        onClose={() => setVisible(false)}
        title="Select Date"
      >
        <View
          style={{
            backgroundColor: isDark ? theme.colors.surface : "#fff",
            borderRadius: 12,
            paddingVertical: 4,
          }}
        >
        <DateTimePicker
            value={value || new Date()}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            themeVariant={isDark ? "dark" : "light"}
            minimumDate={new Date()} // cannot pick anything before now
            style={{
              backgroundColor: isDark ? theme.colors.surface : "#fff",
            }}
            onChange={(_, d) => {
              if (d) onChange(d);
            }}
        />
        </View>
      </PickerModal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: 12,
  },
});