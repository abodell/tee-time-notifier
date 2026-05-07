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
    useTheme,
    ActivityIndicator,
    TextInput as PaperInput,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";
import Toast from "react-native-toast-message";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Colors } from "@/constants/theme";
import Animated, { FadeIn } from "react-native-reanimated";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

const AVATAR_GRAD_START = "#052e16";
const AVATAR_GRAD_END = "#14532d";

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
    const isDark = theme.dark;

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

    const cardBg = isDark ? "rgba(255,255,255,0.06)" : "#fff";
    const cardBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
    const dividerColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
    const accent = theme.colors.primary;
    const gradColors = isDark
        ? (Colors.dark.gradients.primary as [string, string])
        : (Colors.light.gradients.primary as [string, string]);

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
        setName(course.name);
        setAddress(course.address);
        setCity(course.city);
        setState(course.state);
        setPlaceId(course.place_id);
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

    const buttonDisabled = !name || !placeId || loading;

    // ── Success state ──
    if (success) {
        return (
            <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
                <Animated.View
                    entering={FadeIn.duration(400)}
                    style={styles.successWrap}
                >
                    <LinearGradient
                        colors={gradColors}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.successIconWrap}
                    >
                        <MaterialCommunityIcons
                            name={wasRequested ? "thumb-up-outline" : "check-bold"}
                            size={34}
                            color="#fff"
                        />
                    </LinearGradient>

                    <Text style={[styles.successTitle, { color: theme.colors.onSurface }]}>
                        {wasRequested ? "Suggestion Noted!" : "Request Received!"}
                    </Text>
                    <Text style={[styles.successSubtitle, { color: theme.colors.onSurfaceVariant }]}>
                        {wasRequested
                            ? `${name} has already been requested. We've added your vote to help us prioritize it!`
                            : `Thanks for suggesting ${name}. We'll review it and add it to the platform soon.`}
                    </Text>

                    <TouchableOpacity
                        onPress={() => router.back()}
                        activeOpacity={0.88}
                        style={{ borderRadius: 26, overflow: "hidden", marginTop: 32 }}
                    >
                        <LinearGradient
                            colors={gradColors}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={styles.submitButton}
                        >
                            <MaterialCommunityIcons name="arrow-left" size={17} color="#fff" />
                            <Text style={styles.submitText}>Back to Search</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                </Animated.View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : "height"}
                style={{ flex: 1 }}
            >
                <View style={styles.container}>

                    {/* ── Nav row ── */}
                    <View style={styles.navRow}>
                        <TouchableOpacity
                            onPress={() => router.back()}
                            activeOpacity={0.75}
                            style={[
                                styles.backBtn,
                                {
                                    backgroundColor: isDark
                                        ? "rgba(255,255,255,0.06)"
                                        : "rgba(0,0,0,0.05)",
                                    borderColor: cardBorder,
                                },
                            ]}
                        >
                            <MaterialCommunityIcons
                                name="arrow-left"
                                size={18}
                                color={theme.colors.onSurface}
                            />
                        </TouchableOpacity>
                        <Text
                            style={[styles.navTitle, { color: theme.colors.onSurface }]}
                            numberOfLines={1}
                        >
                            Request a Course
                        </Text>
                        <View style={styles.navSpacer} />
                    </View>

                    {/* ── Description ── */}
                    <Text style={[styles.description, { color: theme.colors.onSurfaceVariant }]}>
                        Can't find your home course? Search for it below and we'll get it added.
                    </Text>

                    {/* ── Search ── */}
                    <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>
                        SEARCH FOR A GOLF COURSE
                    </Text>

                    <View style={{ zIndex: 10 }}>
                        <View style={styles.searchWrap}>
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
                                    setTimeout(() => setShowDropdown(false), 150);
                                }}
                                mode="outlined"
                                left={<PaperInput.Icon icon="magnify" color={theme.colors.onSurfaceVariant} />}
                                right={
                                    searching ? (
                                        <PaperInput.Icon icon={() => <ActivityIndicator size={20} color={accent} />} />
                                    ) : hasSelected ? (
                                        <PaperInput.Icon icon="close" onPress={handleClearSelection} color={theme.colors.onSurfaceVariant} />
                                    ) : undefined
                                }
                                style={[
                                    styles.searchBar,
                                    { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : theme.colors.surface },
                                ]}
                                outlineStyle={{
                                    borderRadius: 14,
                                    borderWidth: isDark ? 1 : 0,
                                    borderColor: isDark ? "rgba(255,255,255,0.08)" : "transparent",
                                }}
                                textColor={theme.colors.onSurface}
                                placeholderTextColor={theme.colors.onSurfaceVariant}
                            />
                        </View>

                        {/* ── Dropdown ── */}
                        {showDropdown && isFocused && searchResults.length > 0 && !hasSelected && (
                            <View
                                style={[
                                    styles.dropdown,
                                    {
                                        backgroundColor: isDark ? "#1E2A23" : "#fff",
                                        borderColor: cardBorder,
                                        shadowColor: isDark ? "transparent" : "#000",
                                    },
                                ]}
                            >
                                <FlatList
                                    data={searchResults}
                                    keyExtractor={(item) => item.place_id}
                                    keyboardShouldPersistTaps="handled"
                                    renderItem={({ item, index }) => (
                                        <TouchableOpacity
                                            style={[
                                                styles.dropdownItem,
                                                index < searchResults.length - 1 && {
                                                    borderBottomWidth: StyleSheet.hairlineWidth,
                                                    borderBottomColor: dividerColor,
                                                },
                                            ]}
                                            onPressIn={() => handleSelectCourse(item)}
                                            activeOpacity={0.72}
                                        >
                                            {/* Badge */}
                                            <View style={styles.courseBadge}>
                                                <LinearGradient
                                                    colors={[AVATAR_GRAD_START, AVATAR_GRAD_END]}
                                                    start={{ x: 0, y: 0 }}
                                                    end={{ x: 1, y: 1 }}
                                                    style={StyleSheet.absoluteFillObject}
                                                />
                                                <View style={styles.courseBadgeInner} />
                                                <MaterialCommunityIcons
                                                    name="flag-variant"
                                                    size={18}
                                                    color="rgba(255,255,255,0.88)"
                                                />
                                            </View>

                                            {/* Info */}
                                            <View style={{ flex: 1 }}>
                                                <Text
                                                    style={[styles.dropdownName, { color: isDark ? "#F1F5F9" : "#1E293B" }]}
                                                    numberOfLines={1}
                                                >
                                                    {item.name}
                                                </Text>
                                                <Text
                                                    style={[styles.dropdownMeta, { color: isDark ? "rgba(255,255,255,0.42)" : "#64748B" }]}
                                                    numberOfLines={1}
                                                >
                                                    {item.city}{item.city && item.state ? ", " : ""}{item.state}
                                                </Text>
                                            </View>

                                            {/* Arrow */}
                                            <View style={[styles.arrowChip, { backgroundColor: `${accent}18` }]}>
                                                <MaterialCommunityIcons name="arrow-right" size={12} color={accent} />
                                            </View>
                                        </TouchableOpacity>
                                    )}
                                />
                            </View>
                        )}
                    </View>

                    {/* ── Selected course card ── */}
                    <ScrollView
                        style={{ flex: 1, zIndex: 1, marginTop: 16 }}
                        contentContainerStyle={{ paddingBottom: 40 }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        {hasSelected && name ? (
                            <Animated.View entering={FadeIn.duration(300)}>
                                <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant, marginBottom: 8 }]}>
                                    SELECTED COURSE
                                </Text>
                                <View
                                    style={[
                                        styles.selectedCard,
                                        { backgroundColor: cardBg, borderColor: cardBorder },
                                    ]}
                                >
                                    {/* Course name row */}
                                    <View style={styles.selectedRow}>
                                        <View style={styles.rowLeft}>
                                            <MaterialCommunityIcons
                                                name="flag-variant-outline"
                                                size={16}
                                                color={accent}
                                                style={styles.rowIcon}
                                            />
                                            <Text style={[styles.rowLabel, { color: theme.colors.onSurfaceVariant }]}>
                                                Course
                                            </Text>
                                        </View>
                                        <Text
                                            style={[styles.rowValue, { color: theme.colors.onSurface }]}
                                            numberOfLines={1}
                                        >
                                            {name}
                                        </Text>
                                    </View>

                                    {(city || state) && (
                                        <>
                                            <View style={[styles.divider, { backgroundColor: dividerColor }]} />
                                            <View style={styles.selectedRow}>
                                                <View style={styles.rowLeft}>
                                                    <MaterialCommunityIcons
                                                        name="map-marker-outline"
                                                        size={16}
                                                        color={theme.colors.onSurfaceVariant}
                                                        style={[styles.rowIcon, { opacity: 0.7 }]}
                                                    />
                                                    <Text style={[styles.rowLabel, { color: theme.colors.onSurfaceVariant }]}>
                                                        Location
                                                    </Text>
                                                </View>
                                                <Text style={[styles.rowValue, { color: theme.colors.onSurface }]}>
                                                    {city}{city && state ? ", " : ""}{state}
                                                </Text>
                                            </View>
                                        </>
                                    )}
                                </View>
                            </Animated.View>
                        ) : (
                            <View style={styles.emptyHint}>
                                <MaterialCommunityIcons
                                    name="golf"
                                    size={24}
                                    color={isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)"}
                                />
                                <Text style={[styles.emptyHintText, { color: theme.colors.onSurfaceVariant }]}>
                                    Search for a course above to get started
                                </Text>
                            </View>
                        )}
                    </ScrollView>

                    {/* ── Submit ── */}
                    <View style={styles.submitWrap}>
                        <TouchableOpacity
                            onPress={handleSubmit}
                            disabled={buttonDisabled}
                            activeOpacity={0.82}
                        >
                            <LinearGradient
                                colors={
                                    buttonDisabled
                                        ? isDark
                                            ? ["rgba(255,255,255,0.08)", "rgba(255,255,255,0.08)"]
                                            : ["#E2E8F0", "#E2E8F0"]
                                        : gradColors
                                }
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={styles.submitButton}
                            >
                                {loading ? (
                                    <ActivityIndicator animating size="small" color="#fff" />
                                ) : (
                                    <View style={styles.submitInner}>
                                        <MaterialCommunityIcons
                                            name="send-outline"
                                            size={17}
                                            color={
                                                buttonDisabled
                                                    ? isDark
                                                        ? "rgba(255,255,255,0.25)"
                                                        : "#94A3B8"
                                                    : "#fff"
                                            }
                                        />
                                        <Text
                                            style={[
                                                styles.submitText,
                                                {
                                                    color: buttonDisabled
                                                        ? isDark
                                                            ? "rgba(255,255,255,0.25)"
                                                            : "#94A3B8"
                                                        : "#fff",
                                                },
                                            ]}
                                        >
                                            Submit Request
                                        </Text>
                                    </View>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    container: {
        flex: 1,
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
    },

    // Nav
    navRow: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 16,
    },
    backBtn: {
        width: 38,
        height: 38,
        borderRadius: 12,
        borderWidth: 1,
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
    },
    navTitle: {
        flex: 1,
        textAlign: "center",
        fontSize: 17,
        fontWeight: "700",
        letterSpacing: -0.3,
        marginHorizontal: 8,
    },
    navSpacer: {
        width: 38,
        flexShrink: 0,
    },

    description: {
        fontSize: 14,
        fontWeight: "400",
        lineHeight: 20,
        marginBottom: 20,
    },

    sectionLabel: {
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 1.1,
        marginBottom: 8,
        marginLeft: 4,
    },

    // Search
    searchWrap: { marginBottom: 0 },
    searchBar: {
        height: 46,
        fontSize: 16,
    },

    // Dropdown
    dropdown: {
        position: "absolute",
        top: 52,
        left: 0,
        right: 0,
        maxHeight: 280,
        borderRadius: 18,
        borderWidth: 1,
        elevation: 5,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        zIndex: 1000,
        overflow: "hidden",
    },
    dropdownItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 14,
        gap: 12,
    },
    courseBadge: {
        width: 38,
        height: 38,
        borderRadius: 11,
        overflow: "hidden",
        justifyContent: "center",
        alignItems: "center",
        position: "relative",
        flexShrink: 0,
    },
    courseBadgeInner: {
        position: "absolute",
        inset: 0,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "rgba(34,197,94,0.18)",
    },
    dropdownName: {
        fontSize: 14,
        fontWeight: "600",
        letterSpacing: -0.2,
    },
    dropdownMeta: {
        fontSize: 12,
        fontWeight: "400",
        marginTop: 2,
    },
    arrowChip: {
        width: 24,
        height: 24,
        borderRadius: 8,
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 0,
    },

    // Selected card
    selectedCard: {
        borderRadius: 18,
        borderWidth: 1,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
        overflow: "hidden",
        marginBottom: 16,
    },
    selectedRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 14,
        justifyContent: "space-between",
        minHeight: 52,
    },
    rowLeft: {
        flexDirection: "row",
        alignItems: "center",
        flex: 1,
    },
    rowIcon: {
        marginRight: 10,
        opacity: 0.7,
    },
    rowLabel: {
        fontSize: 15,
        fontWeight: "400",
    },
    rowValue: {
        fontSize: 15,
        fontWeight: "500",
        maxWidth: 180,
        textAlign: "right",
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 16,
    },

    // Empty hint
    emptyHint: {
        alignItems: "center",
        paddingTop: 40,
        gap: 12,
    },
    emptyHintText: {
        fontSize: 14,
        fontWeight: "400",
        textAlign: "center",
    },

    // Submit
    submitWrap: {
        marginTop: "auto" as any,
    },
    submitButton: {
        height: 52,
        borderRadius: 26,
        alignItems: "center",
        justifyContent: "center",
    },
    submitInner: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    submitText: {
        fontWeight: "700",
        fontSize: 16,
        letterSpacing: -0.2,
    },

    // Success
    successWrap: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 32,
    },
    successIconWrap: {
        width: 80,
        height: 80,
        borderRadius: 26,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 24,
    },
    successTitle: {
        fontSize: 26,
        fontWeight: "800",
        letterSpacing: -0.6,
        textAlign: "center",
        lineHeight: 32,
        marginBottom: 12,
    },
    successSubtitle: {
        fontSize: 15,
        fontWeight: "400",
        textAlign: "center",
        lineHeight: 22,
        maxWidth: 300,
    },
});
