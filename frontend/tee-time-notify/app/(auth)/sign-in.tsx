import React, { useState } from "react";
import {
  View,
  StyleSheet,
  TouchableWithoutFeedback,
  Keyboard,
  TouchableOpacity,
} from "react-native";
import {
  TextInput,
  Button,
  Text,
  useTheme,
  HelperText,
  Surface,
  IconButton,
} from "react-native-paper";
import { supabase } from "../../lib/supabase";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Toast from "react-native-toast-message";

export default function SignInScreen() {
  const theme = useTheme();
  const router = useRouter();
  const isDark = theme.dark;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (data.session) {
      // ✅ Show global success toast
      Toast.show({
        type: "success",
        text1: "Signed in successfully!",
        position: "top",
        visibilityTime: 2500,
      });

      // Navigate back to previous page (retains form inputs)
      setTimeout(() => {
        if (router.canGoBack()) router.back();
        else router.replace("/create-details");
      }, 150);
    }
  };

  return (
    <LinearGradient
      colors={
        isDark
          ? ["#0e1012", "#121416", "#1a1c1f"]
          : ["#f8f9fa", "#ffffff", "#f2f4f6"]
      }
      style={styles.gradient}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.container}>
          <IconButton
            icon="arrow-left"
            size={26}
            onPress={() => router.back()}
            style={styles.backBtn}
          />

          <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <Text
              variant="headlineMedium"
              style={[styles.header, { color: theme.colors.onSurface }]}
            >
              Welcome Back
            </Text>

            {error && (
              <View
                style={{
                  backgroundColor: theme.colors.errorContainer,
                  padding: 8,
                  borderRadius: 8,
                  marginBottom: 10,
                }}
              >
                <Text
                  style={{
                    color: theme.colors.onErrorContainer,
                    textAlign: "center",
                    fontWeight: "500",
                  }}
                >
                  {error}
                </Text>
              </View>
            )}

            <TextInput
              label="Email"
              mode="outlined"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              style={styles.input}
            />

            <TextInput
              label="Password"
              mode="outlined"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={styles.input}
            />

            <Button
              mode="contained"
              onPress={handleSignIn}
              disabled={!email || !password || loading}
              style={{ marginTop: 12 }}
              contentStyle={{ height: 48 }}
              labelStyle={{ fontWeight: "600" }}
            >
              {loading ? "Signing in..." : "Sign In"}
            </Button>

            <View style={styles.footer}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                Don’t have an account?
              </Text>
              <TouchableOpacity onPress={() => router.replace("/(auth)/sign-up")}>
                <Text
                  style={{
                    color: theme.colors.primary,
                    fontWeight: "600",
                    marginLeft: 6,
                  }}
                >
                  Sign Up
                </Text>
              </TouchableOpacity>
            </View>
          </Surface>
        </View>
      </TouchableWithoutFeedback>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  backBtn: {
    position: "absolute",
    top: 40,
    left: 4,
    zIndex: 10,
  },
  card: {
    borderRadius: 16,
    padding: 24,
    elevation: 3,
  },
  header: {
    marginBottom: 30,
    textAlign: "center",
    fontWeight: "700",
  },
  input: { marginBottom: 16 },
  footer: {
    marginTop: 28,
    flexDirection: "row",
    justifyContent: "center",
  },
});