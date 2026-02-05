import React, { useState } from "react";
import {
  View,
  StyleSheet,
  TouchableWithoutFeedback,
  Keyboard,
  TouchableOpacity,
  Image,
} from "react-native";
import {
  TextInput,
  Button,
  Text,
  useTheme,
  Surface,
  IconButton,
} from "react-native-paper";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../../lib/supabase";
import { useRouter, useLocalSearchParams } from "expo-router";
import Toast from "react-native-toast-message";
import { Colors } from "@/constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SignInScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ redirectTo?: string }>();
  const redirectTo = params.redirectTo || null;

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
      Toast.show({
        type: "success",
        text1: "Signed in successfully!",
        position: "top",
        visibilityTime: 2500,
      });

      setTimeout(() => {
        if (redirectTo) {
          router.replace(redirectTo as any);
        } else if (router.canGoBack()) {
          router.back();
        } else {
          router.replace("/(tabs)/profile");
        }
      }, 150);
    }
  };

  const handleSafeBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/profile");
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.inner}>
          <IconButton
            icon="arrow-left"
            size={24}
            onPress={handleSafeBack}
            style={styles.backBtn}
            iconColor={theme.colors.onBackground}
          />

          <View style={styles.headerContainer}>
            <Text
              variant="displaySmall"
              style={[styles.header, { color: theme.colors.onBackground }]}
            >
              Welcome Back
            </Text>
            <Text style={[styles.subHeader, { color: theme.colors.secondary }]}>
              Sign in to continue sniping tee times.
            </Text>
          </View>

          {error && (
            <Surface style={[styles.errorContainer, { backgroundColor: theme.colors.errorContainer }]} elevation={0}>
              <Text style={{ color: theme.colors.onErrorContainer, textAlign: "center", fontWeight: "600" }}>
                {error}
              </Text>
            </Surface>
          )}

          <View style={styles.form}>
            <TextInput
              label="Email"
              mode="outlined"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              style={styles.input}
              outlineStyle={{ borderRadius: 12 }}
            />

            <TextInput
              label="Password"
              mode="outlined"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={styles.input}
              outlineStyle={{ borderRadius: 12 }}
            />

            <TouchableOpacity
              onPress={() => router.push("/(auth)/forgot-password" as any)}
              style={{ alignSelf: "flex-end", marginTop: 4 }}
            >
              <Text style={{ color: theme.colors.primary, fontWeight: "600" }}>
                Forgot Password?
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSignIn}
              disabled={!email || !password || loading}
              activeOpacity={0.8}
              style={{ marginTop: 24 }}
            >
              <LinearGradient
                colors={
                  ((!email || !password || loading)
                    ? [theme.colors.surfaceDisabled, theme.colors.surfaceDisabled]
                    : Colors.light.gradients.primary) as [string, string, ...string[]]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  styles.gradientButton,
                  { opacity: (!email || !password || loading) ? 0.6 : 1 },
                ]}
              >
                <Text
                  style={{
                    color: (!email || !password || loading)
                      ? theme.colors.onSurfaceDisabled
                      : "#FFF",
                    fontWeight: "700",
                    fontSize: 16,
                  }}
                >
                  {loading ? "Signing in..." : "Sign In"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>
              Don't have an account?
            </Text>
            <TouchableOpacity onPress={() => router.replace("/(auth)/sign-up")}>
              <Text
                style={{
                  color: theme.colors.primary,
                  fontWeight: "700",
                  marginLeft: 6,
                }}
              >
                Sign Up
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
  },
  backBtn: {
    marginLeft: -12,
    marginTop: 8,
  },
  headerContainer: {
    marginTop: 20,
    marginBottom: 40,
  },
  header: {
    fontWeight: "800",
    marginBottom: 8,
  },
  subHeader: {
    fontSize: 16,
    opacity: 0.7,
  },
  errorContainer: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  form: {
    marginBottom: 20,
  },
  input: {
    marginBottom: 16,
    backgroundColor: "transparent",
  },
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
  footer: {
    marginTop: "auto",
    marginBottom: 20,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
});