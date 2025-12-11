import React, { useState } from "react";
import {
    View,
    StyleSheet,
    TouchableWithoutFeedback,
    Keyboard,
    TouchableOpacity,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
} from "react-native";
import {
    Text,
    Button,
    useTheme,
    Surface,
    IconButton,
    ActivityIndicator,
    TextInput as PaperInput,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";
import { supabase } from "../lib/supabase";
import Toast from "react-native-toast-message";
import { MaterialCommunityIcons } from "@expo/vector-icons";

// Use the Expo Public env var for client-side access
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

export default function RequestCourseScreen() {
    const theme = useTheme();
    const router = useRouter();

    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    // Form State
    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [city, setCity] = useState("");
    const [state, setState] = useState("");
    const [placeId, setPlaceId] = useState("");

    const handleSubmit = async () => {
        if (!name || !placeId) {
            Toast.show({
                type: "error",
                text1: "Missing Information",
                text2: "Please search and select a course first.",
                position: "top",
            });
            return;
        }

        setLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error("You must be signed in to request a course.");
            }

            const res = await fetch(`${API_URL}/courses/request`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    name,
                    address,
                    city,
                    state,
                    place_id: placeId,
                }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Failed to submit request.");
            }

            setSuccess(true);
        } catch (err: any) {
            Toast.show({
                type: "error",
                text1: "Request Failed",
                text2: err.message,
                position: "top",
            });
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
                <View style={[styles.inner, { justifyContent: "center", alignItems: "center" }]}>
                    <View style={[styles.iconCircle, { backgroundColor: theme.colors.primary + "20" }]}>
                        <MaterialCommunityIcons name="check-circle" size={64} color={theme.colors.primary} />
                    </View>
                    <Text variant="headlineSmall" style={{ fontWeight: "700", marginTop: 24, color: theme.colors.onBackground }}>
                        Request Received!
                    </Text>
                    <Text variant="bodyLarge" style={{ textAlign: "center", color: theme.colors.onSurfaceVariant, marginTop: 12, paddingHorizontal: 32 }}>
                        Thanks for suggesting <Text style={{ fontWeight: "700" }}>{name}</Text>. We'll review it and add it to the platform soon.
                    </Text>
                    <Button
                        mode="contained"
                        onPress={() => router.back()}
                        style={{ marginTop: 32, borderRadius: 12 }}
                        contentStyle={{ height: 48 }}
                    >
                        Back to Search
                    </Button>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={{ flex: 1 }}
            >
                <View style={styles.header}>
                    <IconButton
                        icon="arrow-left"
                        size={24}
                        onPress={() => router.back()}
                        style={{ marginLeft: -8 }}
                    />
                    <Text variant="headlineSmall" style={{ fontWeight: "700", marginLeft: 8 }}>
                        Request a Course
                    </Text>
                </View>

                <View style={styles.contentContainer}>
                    <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 24 }}>
                        Can't find your home course? Search for it below and we'll get it added.
                    </Text>

                    <Text style={[styles.label, { color: theme.colors.onSurface }]}>SEARCH & SELECT COURSE</Text>

                    {/* Autocomplete sits above the form content */}
                    <View style={{ zIndex: 10 }}>
                        <GooglePlacesAutocomplete
                            placeholder="Search golf courses..."
                            fetchDetails={true}
                            onPress={(data, details = null) => {
                                if (details) {
                                    setPlaceId(data.place_id);
                                    setName(data.structured_formatting.main_text);
                                    setAddress(data.description);
                                    let foundCity = "";
                                    let foundState = "";
                                    details.address_components.forEach(comp => {
                                        if (comp.types.includes("locality")) foundCity = comp.long_name;
                                        if (comp.types.includes("administrative_area_level_1")) foundState = comp.short_name;
                                    });
                                    setCity(foundCity);
                                    setState(foundState);
                                }
                            }}
                            query={{
                                key: GOOGLE_MAPS_API_KEY,
                                language: "en",
                                types: "establishment",
                                components: "country:us",
                            }}
                            enablePoweredByContainer={false}
                            styles={{
                                container: {
                                    flex: 0,
                                    marginBottom: 16,
                                },
                                textInput: {
                                    height: 50,
                                    backgroundColor: theme.colors.surface,
                                    borderRadius: 12,
                                    paddingHorizontal: 16,
                                    fontSize: 16,
                                    color: theme.colors.onSurface,
                                    borderWidth: 1,
                                    borderColor: theme.colors.outline,
                                },
                                listView: {
                                    backgroundColor: theme.colors.surface,
                                    borderRadius: 12,
                                    marginTop: 4,
                                    borderWidth: 1,
                                    borderColor: theme.colors.outline,
                                    position: 'absolute',
                                    top: 55,
                                    left: 0,
                                    right: 0,
                                    elevation: 5,
                                    zIndex: 1000,
                                },
                                row: {
                                    backgroundColor: "transparent",
                                    paddingVertical: 12,
                                },
                                description: {
                                    color: theme.colors.onSurface,
                                },
                            }}
                            textInputProps={{
                                placeholderTextColor: theme.colors.onSurfaceVariant,
                            }}
                        />
                    </View>

                    {/* Scrollable form content sits below/behind */}
                    <ScrollView
                        style={{ flex: 1, zIndex: 1 }}
                        contentContainerStyle={{ paddingBottom: 40 }}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* Read Only Preview */}
                        <View style={{ opacity: name ? 1 : 0.5 }}>
                            <PaperInput
                                label="Course Name"
                                value={name}
                                editable={false}
                                mode="outlined"
                                style={{ marginBottom: 16, backgroundColor: theme.colors.surface }}
                            />

                            <View style={{ flexDirection: "row", gap: 12 }}>
                                <PaperInput
                                    label="City"
                                    value={city}
                                    editable={false}
                                    mode="outlined"
                                    style={{ flex: 1, marginBottom: 16, backgroundColor: theme.colors.surface }}
                                />
                                <PaperInput
                                    label="State"
                                    value={state}
                                    editable={false}
                                    mode="outlined"
                                    style={{ width: 80, marginBottom: 16, backgroundColor: theme.colors.surface }}
                                />
                            </View>
                        </View>

                        <Button
                            mode="contained"
                            onPress={handleSubmit}
                            loading={loading}
                            disabled={!name || !placeId || loading}
                            style={{ borderRadius: 12, marginTop: 8 }}
                            contentStyle={{ height: 50 }}
                            labelStyle={{ fontSize: 16, fontWeight: "600" }}
                        >
                            Submit Request
                        </Button>
                    </ScrollView>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    inner: {
        flex: 1,
        padding: 24,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    contentContainer: {
        flex: 1,
        padding: 24,
        paddingTop: 8,
    },
    label: {
        fontSize: 12,
        fontWeight: "700",
        marginBottom: 8,
        opacity: 0.7,
    },
    iconCircle: {
        width: 100,
        height: 100,
        borderRadius: 50,
        justifyContent: "center",
        alignItems: "center",
    },
});
