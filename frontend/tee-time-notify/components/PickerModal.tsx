import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import Modal from "react-native-modal";
import { Button, Text, useTheme } from "react-native-paper";

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function PickerModal({ visible, onClose, title, children }: Props) {
  const theme = useTheme();

  return (
    <Modal
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
        <Text
          style={[
            styles.title,
            {
              color: theme.colors.onSurface,
            },
          ]}
        >
          {title}
        </Text>

        <View style={styles.pickerContainer}>{children}</View>

        <Button
          mode="contained"
          buttonColor={theme.colors.primary}
          onPress={onClose}
          style={styles.doneBtn}
        >
          Done
        </Button>
      </View>
    </Modal>
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
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 12,
  },
  pickerContainer: {
    marginBottom: 16,
  },
  doneBtn: {
    marginTop: 10,
  },
});