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

export default function ResetPasswordScreen() {
    const theme = useTheme();
    const router = useRouter();

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);

    const handleUpdatePassword = async () => {
        if (!password || password !== confirmPassword) {
            Toast.show({
                type: "error",
                text1: "Error",
                text2: "Passwords do not match or are empty.",
            });
            return;
        }

        setLoading(true);

        const { error } = await supabase.auth.updateUser({
            password: password,
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

        Toast.show({
            type: "success",
            text1: "Success",
            text2: "Password has been reset successfully!",
        });

        // After reset, redirect to tabs or profile
        setTimeout(() => {
            router.replace("/(tabs)/profile");
        }, 1500);
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <View style={styles.inner}>
                    <View style={styles.headerContainer}>
                        <Text
                            variant="displaySmall"
                            style={[styles.header, { color: theme.colors.onBackground }]}
                        >
                            Set New Password
                        </Text>
                        <Text style={[styles.subHeader, { color: theme.colors.secondary }]}>
                            Please enter your new password below.
                        </Text>
                    </View>

                    <View style={styles.form}>
                        <TextInput
                            label="New Password"
                            mode="outlined"
                            secureTextEntry
                            value={password}
                            onChangeText={setPassword}
                            style={styles.input}
                            outlineStyle={{ borderRadius: 12 }}
                        />

                        <TextInput
                            label="Confirm New Password"
                            mode="outlined"
                            secureTextEntry
                            value={confirmPassword}
                            onChangeText={setConfirmPassword}
                            style={styles.input}
                            outlineStyle={{ borderRadius: 12 }}
                        />

                        <TouchableOpacity
                            onPress={handleUpdatePassword}
                            disabled={!password || password !== confirmPassword || loading}
                            activeOpacity={0.8}
                            style={{ marginTop: 24 }}
                        >
                            <LinearGradient
                                colors={
                                    ((!password || password !== confirmPassword || loading)
                                        ? [theme.colors.surfaceDisabled, theme.colors.surfaceDisabled]
                                        : Colors.light.gradients.primary) as [string, string, ...string[]]
                                }
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={[
                                    styles.gradientButton,
                                    { opacity: (!password || password !== confirmPassword || loading) ? 0.6 : 1 },
                                ]}
                            >
                                <Text
                                    style={{
                                        color: (!password || password !== confirmPassword || loading)
                                            ? theme.colors.onSurfaceDisabled
                                            : "#FFF",
                                        fontWeight: "700",
                                        fontSize: 16,
                                    }}
                                >
                                    {loading ? "Updating..." : "Update Password"}
                                </Text>
                            </LinearGradient>
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
    headerContainer: {
        marginTop: 60,
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
});
