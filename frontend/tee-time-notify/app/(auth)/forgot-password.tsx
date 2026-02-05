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
    Surface,
    IconButton,
} from "react-native-paper";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../../lib/supabase";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { Colors } from "@/constants/theme";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";

export default function ForgotPasswordScreen() {
    const theme = useTheme();
    const router = useRouter();

    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);

    const handleResetPassword = async () => {
        if (!email) return;

        setLoading(true);

        const redirectTo = Linking.createURL("reset-password");
        console.log("Redirect URL:", redirectTo);

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo,
        });

        setLoading(false);

        if (error) {
            Toast.show({
                type: "error",
                text1: "Error",
                text2: error.message,
            });
            return;
        }

        setSent(true);
        Toast.show({
            type: "success",
            text1: "Email sent!",
            text2: "Check your inbox for a reset link.",
        });
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <View style={styles.inner}>
                    <IconButton
                        icon="arrow-left"
                        size={24}
                        onPress={() => router.back()}
                        style={styles.backBtn}
                        iconColor={theme.colors.onBackground}
                    />

                    <View style={styles.headerContainer}>
                        <Text
                            variant="displaySmall"
                            style={[styles.header, { color: theme.colors.onBackground }]}
                        >
                            Reset Password
                        </Text>
                        <Text style={[styles.subHeader, { color: theme.colors.secondary }]}>
                            Enter your email and we'll send you a link to reset your password.
                        </Text>
                    </View>

                    {sent ? (
                        <Surface style={[styles.successContainer, { backgroundColor: theme.colors.primaryContainer }]} elevation={0}>
                            <Text style={{ color: theme.colors.onPrimaryContainer, textAlign: "center", fontWeight: "600" }}>
                                Reset link sent! Please check your email and follow the instructions.
                            </Text>
                            <Button
                                mode="text"
                                onPress={() => setSent(false)}
                                style={{ marginTop: 12 }}
                                textColor={theme.colors.primary}
                            >
                                Didn't get it? Try again
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
                                placeholder="golf@example.com"
                            />

                            <TouchableOpacity
                                onPress={handleResetPassword}
                                disabled={!email || loading}
                                activeOpacity={0.8}
                                style={{ marginTop: 24 }}
                            >
                                <LinearGradient
                                    colors={
                                        ((!email || loading)
                                            ? [theme.colors.surfaceDisabled, theme.colors.surfaceDisabled]
                                            : Colors.light.gradients.primary) as [string, string, ...string[]]
                                    }
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 0 }}
                                    style={[
                                        styles.gradientButton,
                                        { opacity: (!email || loading) ? 0.6 : 1 },
                                    ]}
                                >
                                    <Text
                                        style={{
                                            color: (!email || loading)
                                                ? theme.colors.onSurfaceDisabled
                                                : "#FFF",
                                            fontWeight: "700",
                                            fontSize: 16,
                                        }}
                                    >
                                        {loading ? "Sending..." : "Send Reset Link"}
                                    </Text>
                                </LinearGradient>
                            </TouchableOpacity>
                        </View>
                    )}

                    <View style={styles.footer}>
                        <Text style={{ color: theme.colors.onSurfaceVariant }}>
                            Remembered your password?
                        </Text>
                        <TouchableOpacity onPress={() => router.back()}>
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
    successContainer: {
        padding: 20,
        borderRadius: 16,
        marginBottom: 20,
        alignItems: "center",
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
