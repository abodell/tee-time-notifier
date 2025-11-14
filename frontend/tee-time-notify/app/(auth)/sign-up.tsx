import React, { useState } from "react";
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
} from "react-native-paper";
import { supabase } from "../../lib/supabase";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import FadeSlideTransition from "@/components/FadeSlideTransition";

export default function SignUpScreen() {
  const theme = useTheme();
  const router = useRouter();
  const isDark = theme.dark;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSignUp = async () => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else setSuccess(true);
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
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.container}
        >
          <IconButton
            icon="arrow-left"
            size={26}
            onPress={() => router.back()}
            style={styles.backBtn}
          />
          <FadeSlideTransition>
            <Surface style={[styles.card, { backgroundColor: theme.colors.surface }]}>
              <Text
                variant="headlineMedium"
                style={[styles.header, { color: theme.colors.onSurface }]}
              >
                Create Account
              </Text>

              {success ? (
                <>
                  <Text
                    style={{
                      textAlign: "center",
                      color: theme.colors.primary,
                      marginBottom: 20,
                    }}
                  >
                    Success! Check your email to confirm your account.
                  </Text>
                  <Button
                    mode="contained"
                    onPress={() => router.replace("/(auth)/sign-in")}
                    contentStyle={{ height: 48 }}
                  >
                    Back to Sign-In
                  </Button>
                </>
              ) : (
                <>
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

                  {error && (
                    <HelperText type="error" visible={!!error}>
                      {error}
                    </HelperText>
                  )}

                  <Button
                    mode="contained"
                    onPress={handleSignUp}
                    disabled={!email || !password || loading}
                    style={{ marginTop: 12 }}
                    contentStyle={{ height: 48 }}
                    labelStyle={{ fontWeight: "600" }}
                  >
                    {loading ? "Creating..." : "Create Account"}
                  </Button>

                  <View style={styles.footer}>
                    <Text style={{ color: theme.colors.onSurfaceVariant }}>
                      Already have an account?
                    </Text>
                    <TouchableOpacity onPress={() => router.replace("/(auth)/sign-in")}>
                      <Text
                        style={{
                          color: theme.colors.primary,
                          fontWeight: "600",
                          marginLeft: 6,
                        }}
                      >
                        Sign In
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Surface>
          </FadeSlideTransition>
        </ScrollView>
      </TouchableWithoutFeedback>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flexGrow: 1,
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