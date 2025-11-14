import React, { useState, useEffect } from "react";
import { Pressable, View, StyleSheet, Platform } from "react-native";
import { TextInput, useTheme, HelperText } from "react-native-paper";
import DateTimePicker from "@react-native-community/datetimepicker";
import dayjs from "dayjs";
import PickerModal from "./PickerModal";

interface Props {
  label: string;
  value: Date | null;
  onChange: (d: Date) => void;
  selectedDate?: Date | null;
  startTime?: Date | null;
  onValidityChange?: (isValid: boolean) => void;
}

export default function TimePickerField({
  label,
  value,
  onChange,
  selectedDate,
  startTime,
  onValidityChange,
}: Props) {
  const theme = useTheme();
  const isDark = theme.dark;
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempValue, setTempValue] = useState<Date>(value || new Date());

  const now = new Date();
  const isToday =
    !!selectedDate && dayjs(selectedDate).isSame(dayjs(now), "day");

  // validate value on each change
  useEffect(() => {
    let newError: string | null = null;
    if (!value) newError = null;
    else if (isToday && dayjs(value).isBefore(dayjs(now))) {
      newError = "That time has already passed today.";
    } else if (startTime && dayjs(value).isBefore(dayjs(startTime))) {
      newError = "End time must be after the start time.";
    }

    setError(newError);
    onValidityChange?.(!newError && !!value);
  }, [isToday, now, value, startTime]);

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
            error={!!error}
          />
        </View>
      </Pressable>

      {error && (
        <HelperText type="error" visible={!!error}>
          {error}
        </HelperText>
      )}

      <PickerModal
        visible={visible}
        onClose={() => setVisible(false)}
        onConfirm={() => {
          onChange(tempValue);
          setVisible(false);
        }}
        title={label}
      >
        <View
          style={{
            backgroundColor: isDark ? theme.colors.surface : "#fff",
            borderRadius: 12,
            paddingVertical: 4,
          }}
        >
          <DateTimePicker
            value={tempValue}
            mode="time"
            display="spinner"
            is24Hour={false}
            themeVariant={isDark ? "dark" : "light"}
            onChange={(_, selected) => {
              if (selected) setTempValue(selected);
            }}
          />
        </View>
      </PickerModal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: 4,
  },
});