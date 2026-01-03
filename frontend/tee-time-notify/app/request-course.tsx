import React, { useState, useRef, useCallback } from "react";
import {
    View,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    Keyboard,
    FlatList,
} from "react-native";
import {
    Text,
    Button,
    useTheme,
    IconButton,
    ActivityIndicator,
    TextInput as PaperInput,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";
import Toast from "react-native-toast-message";
import { MaterialCommunityIcons } from "@expo/vector-icons";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

// Debounce helper
function useDebounce<T extends (...args: any[]) => void>(
    callback: T,
    delay: number
): T {
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    return useCallback(
        ((...args: Parameters<T>) => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                callback(...args);
            }, delay);
        }) as T,
        [callback, delay]
    );
}

interface CourseResult {
    place_id: string;
    name: string;
    address: string;
    street_address: string;
    city: string;
    state: string;
}

export default function RequestCourseScreen() {
    const theme = useTheme();
    const router = useRouter();

    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [searching, setSearching] = useState(false);
    const [wasRequested, setWasRequested] = useState(false);

    // Search state
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<CourseResult[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [hasSelected, setHasSelected] = useState(false);
    const [isFocused, setIsFocused] = useState(false);

    // Form State (populated on selection)
    const [name, setName] = useState("");
    const [address, setAddress] = useState("");
    const [city, setCity] = useState("");
    const [state, setState] = useState("");
    const [placeId, setPlaceId] = useState("");

    const searchCourses = async (query: string) => {
        if (query.length < 2) {
            setSearchResults([]);
            setShowDropdown(false);
            return;
        }

        setSearching(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                throw new Error("You must be signed in to search courses.");
            }

            const res = await fetch(
                `${API_URL}/courses/search?query=${encodeURIComponent(query)}`,
                {
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                    },
                }
            );

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Failed to search courses.");
            }

            const data = await res.json();
            setSearchResults(data.results || []);
            setShowDropdown(data.results?.length > 0);
        } catch (err: any) {
            console.error("Search error:", err);
            Toast.show({
                type: "error",
                text1: "Search Failed",
                text2: err.message,
                position: "top",
            });
        } finally {
            setSearching(false);
        }
    };

    const debouncedSearch = useDebounce(searchCourses, 300);

    const handleSearchChange = (text: string) => {
        setSearchQuery(text);
        setHasSelected(false);

        if (text.length >= 2) {
            debouncedSearch(text);
        } else {
            setSearchResults([]);
            setShowDropdown(false);
        }
    };

    const handleSelectCourse = (course: CourseResult) => {
        // Populate form
        setName(course.name);
        setAddress(course.address);
        setCity(course.city);
        setState(course.state);
        setPlaceId(course.place_id);

        // Update search input and hide dropdown
        setSearchQuery(course.name);
        setHasSelected(true);
        setShowDropdown(false);
        setSearchResults([]);
        Keyboard.dismiss();
    };

    const handleClearSelection = () => {
        setName("");
        setAddress("");
        setCity("");
        setState("");
        setPlaceId("");
        setSearchQuery("");
        setHasSelected(false);
        setSearchResults([]);
        setShowDropdown(false);
    };

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

            const data = await res.json();

            if (data.was_previously_requested) {
                setWasRequested(true);
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
                    <Text variant="headlineSmall" style={{ fontWeight: "700", marginTop: 24, color: theme.colors.onBackground, textAlign: "center" }}>
                        {wasRequested ? "Suggestion Noted!" : "Request Received!"}
                    </Text>
                    <Text variant="bodyLarge" style={{ textAlign: "center", color: theme.colors.onSurfaceVariant, marginTop: 12, paddingHorizontal: 32 }}>
                        {wasRequested ? (
                            <>
                                <Text style={{ fontWeight: "700" }}>{name}</Text> has already been requested. We've added your vote to help us prioritize it!
                            </>
                        ) : (
                            <>
                                Thanks for suggesting <Text style={{ fontWeight: "700" }}>{name}</Text>. We'll review it and add it to the platform soon.
                            </>
                        )}
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

                    <Text style={[styles.label, { color: theme.colors.onSurface }]}>SEARCH FOR A GOLF COURSE</Text>

                    {/* Custom Search Input with Dropdown */}
                    <View style={{ zIndex: 10 }}>
                        <View style={styles.searchInputContainer}>
                            <PaperInput
                                placeholder="Search golf courses..."
                                value={searchQuery}
                                onChangeText={handleSearchChange}
                                onFocus={() => {
                                    setIsFocused(true);
                                    if (searchResults.length > 0 && !hasSelected) {
                                        setShowDropdown(true);
                                    }
                                }}
                                onBlur={() => {
                                    setIsFocused(false);
                                    setShowDropdown(false);
                                }}
                                mode="outlined"
                                style={{ flex: 1, backgroundColor: theme.colors.surface }}
                                outlineStyle={{ borderRadius: 12 }}
                                right={
                                    searching ? (
                                        <PaperInput.Icon icon={() => <ActivityIndicator size={20} />} />
                                    ) : hasSelected ? (
                                        <PaperInput.Icon icon="close" onPress={handleClearSelection} />
                                    ) : (
                                        <PaperInput.Icon icon="magnify" />
                                    )
                                }
                            />
                        </View>

                        {/* Dropdown Results */}
                        {showDropdown && isFocused && searchResults.length > 0 && !hasSelected && (
                            <View
                                style={[
                                    styles.dropdown,
                                    {
                                        backgroundColor: theme.colors.surface,
                                        borderColor: theme.colors.outline,
                                    },
                                ]}
                            >
                                <FlatList
                                    data={searchResults}
                                    keyExtractor={(item) => item.place_id}
                                    keyboardShouldPersistTaps="handled"
                                    renderItem={({ item }) => (
                                        <TouchableOpacity
                                            style={[
                                                styles.dropdownItem,
                                                { borderBottomColor: theme.colors.outlineVariant },
                                            ]}
                                            onPressIn={() => handleSelectCourse(item)}
                                        >
                                            <MaterialCommunityIcons
                                                name="golf"
                                                size={20}
                                                color={theme.colors.primary}
                                                style={{ marginRight: 12 }}
                                            />
                                            <View style={{ flex: 1 }}>
                                                <Text
                                                    style={{ fontWeight: "600", color: theme.colors.onSurface }}
                                                    numberOfLines={2}
                                                >
                                                    {item.name}
                                                </Text>
                                                <Text
                                                    style={{ fontSize: 13, color: theme.colors.onSurfaceVariant, marginTop: 2 }}
                                                    numberOfLines={2}
                                                >
                                                    {item.city}{item.city && item.state ? ", " : ""}{item.state}
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                    )}
                                />
                            </View>
                        )}
                    </View>

                    {/* Form Fields (shown after selection) */}
                    <ScrollView
                        style={{ flex: 1, zIndex: 1, marginTop: 16 }}
                        contentContainerStyle={{ paddingBottom: 40 }}
                        keyboardShouldPersistTaps="handled"
                    >
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
    searchInputContainer: {
        flexDirection: "row",
        alignItems: "center",
    },
    dropdown: {
        position: "absolute",
        top: 60,
        left: 0,
        right: 0,
        maxHeight: 300,
        borderRadius: 12,
        borderWidth: 1,
        elevation: 5,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        zIndex: 1000,
    },
    dropdownItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
    },
});
