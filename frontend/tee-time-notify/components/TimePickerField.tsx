import React, { useState } from "react";
import { Pressable, View, StyleSheet } from "react-native";
import { TextInput, useTheme } from "react-native-paper";
import DateTimePicker from "@react-native-community/datetimepicker";
import dayjs from "dayjs";
import PickerModal from "./PickerModal";

export default function TimePickerField({
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
            value={value ? dayjs(value).format("h:mm A") : ""}
            right={<TextInput.Icon icon="clock-outline" />}
            placeholder="Select Time"
            style={styles.field}
          />
        </View>
      </Pressable>

      <PickerModal
        visible={visible}
        onClose={() => setVisible(false)}
        title="Select Time"
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
            mode="time"
            display="spinner"
            is24Hour={false}
            themeVariant={isDark ? "dark" : "light"}
            minimumDate={new Date()} // disables times earlier than now (iOS supported)
            style={{
              backgroundColor: isDark ? theme.colors.surface : "#fff",
            }}
            onChange={(_, d) => {
              if (d && d < new Date()) return; // ignore past
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