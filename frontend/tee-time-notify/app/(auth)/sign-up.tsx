import React, { useState, useMemo } from "react";
import {
  View,
  ScrollView,
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
  Divider,
} from "react-native-paper";
import { KeyboardAvoidingView, Platform } from "react-native";
import { supabase } from "../../lib/supabase";
import { useRouter, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import FadeSlideTransition from "@/components/FadeSlideTransition";
import { Colors } from "@/constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import OAuthSection from "@/components/auth/OAuthSection";

export default function SignUpScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ redirectTo?: string }>();
  const redirectTo = params.redirectTo || null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const redirectToUrl = useMemo(() => Linking.createURL("profile"), []);

  const handleSignUp = async () => {
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectToUrl,
      },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
    }
  };

  const handleSafeBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/profile");
  };

  const goToSignIn = () => {
    router.replace({
      pathname: "/(auth)/sign-in",
      params: redirectTo ? { redirectTo } : {},
    });
  };

  const goBackToProfile = () => {
    if (redirectTo) router.replace(redirectTo as any);
    else router.replace("/(tabs)/profile");
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.inner}>
              <IconButton
                icon="arrow-left"
                size={24}
                onPress={handleSafeBack}
                style={styles.backBtn}
                iconColor={theme.colors.onBackground}
              />

              <FadeSlideTransition>
                <View style={styles.headerContainer}>
                  <Text
                    variant="displaySmall"
                    style={[styles.header, { color: theme.colors.onBackground }]}
                  >
                    Create Account
                  </Text>
                  <Text style={[styles.subHeader, { color: theme.colors.secondary }]}>
                    Join the club and start sniping.
                  </Text>
                </View>

                {success ? (
                  <Surface style={[styles.successCard, { backgroundColor: theme.colors.surface }]} elevation={0}>
                    <View style={styles.successIconContainer}>
                      <Text style={{ fontSize: 40 }}>✉️</Text>
                    </View>
                    <Text
                      variant="titleMedium"
                      style={{
                        textAlign: "center",
                        color: theme.colors.onSurface,
                        fontWeight: "700",
                        marginBottom: 8,
                      }}
                    >
                      Check your email
                    </Text>
                    <Text
                      style={{
                        textAlign: "center",
                        color: theme.colors.onSurfaceVariant,
                        marginBottom: 24,
                        lineHeight: 20,
                      }}
                    >
                      We've sent you a confirmation link. Please verify your account to continue.
                    </Text>
                    <Button
                      mode="contained"
                      onPress={goToSignIn}
                      contentStyle={{ height: 48 }}
                      style={{ borderRadius: 24 }}
                    >
                      Back to Sign‑In
                    </Button>
                    <Button
                      mode="text"
                      style={{ marginTop: 12 }}
                      onPress={goBackToProfile}
                    >
                      Return to App
                    </Button>
                  </Surface>
                ) : (
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

                    {error && (
                      <View style={[styles.errorContainer, { backgroundColor: theme.colors.errorContainer }]}>
                        <Text style={{ color: theme.colors.onErrorContainer, fontWeight: "600", textAlign: "center" }}>
                          {error}
                        </Text>
                      </View>
                    )}

                    <TouchableOpacity
                      onPress={handleSignUp}
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
                          {loading ? "Creating..." : "Create Account"}
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>

                    <View style={styles.separatorContainer}>
                      <Divider style={styles.divider} />
                      <Text style={[styles.separatorText, { color: theme.colors.onSurfaceVariant }]}>OR</Text>
                      <Divider style={styles.divider} />
                    </View>

                    <OAuthSection
                      loading={loading}
                      setLoading={setLoading}
                      setError={setError}
                      onSuccess={() => {
                        if (redirectTo) {
                          router.replace(redirectTo as any);
                        } else {
                          router.replace("/(tabs)/profile");
                        }
                      }}
                    />

                    <View style={{ marginTop: 24, paddingHorizontal: 4 }}>
                      <Text style={{ textAlign: "center", color: theme.colors.onSurfaceVariant, fontSize: 13, lineHeight: 18 }}>
                        By signing up, you agree to our{" "}
                        <Text
                          style={{ color: theme.colors.primary, fontWeight: "600" }}
                          onPress={() => Linking.openURL("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")}
                        >
                          Terms of Use
                        </Text>{" "}
                        and{" "}
                        <Text
                          style={{ color: theme.colors.primary, fontWeight: "600" }}
                          onPress={() => Linking.openURL("https://abodell.github.io/tee-time-notifier/privacy.html")}
                        >
                          Privacy Policy
                        </Text>.
                      </Text>
                    </View>

                    <View style={styles.footer}>
                      <Text style={{ color: theme.colors.onSurfaceVariant }}>
                        Already have an account?
                      </Text>
                      <TouchableOpacity onPress={goToSignIn}>
                        <Text
                          style={{
                            color: theme.colors.primary,
                            fontWeight: "700",
                            marginLeft: 6,
                          }}
                        >
                          Sign In
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </FadeSlideTransition>
            </View>
          </TouchableWithoutFeedback>
        </ScrollView>
      </KeyboardAvoidingView>
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
  trialBadge: {
    marginTop: 12,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  successCard: {
    padding: 32,
    borderRadius: 24,
    alignItems: "center",
  },
  successIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(47, 128, 237, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  form: {
    marginBottom: 20,
  },
  input: {
    marginBottom: 16,
    backgroundColor: "transparent",
  },
  errorContainer: {
    padding: 12,
    borderRadius: 12,
    marginTop: 4,
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
    marginTop: 40,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  separatorContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 24,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(150, 150, 150, 0.2)",
  },
  separatorText: {
    marginHorizontal: 16,
    fontSize: 14,
    fontWeight: "600",
  },
});