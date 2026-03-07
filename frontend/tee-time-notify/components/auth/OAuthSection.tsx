import React from 'react';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../lib/supabase';
import * as Linking from 'expo-linking';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';

WebBrowser.maybeCompleteAuthSession();

interface OAuthSectionProps {
    loading: boolean;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    onSuccess?: () => void;
    showSeparator?: boolean;
}

export default function OAuthSection({ loading, setLoading, setError, onSuccess, showSeparator = false }: OAuthSectionProps) {
    const theme = useTheme();
    const router = useRouter();


    const handleGoogleSignIn = async () => {
        try {
            setLoading(true);
            setError(null);

            const redirectUrl = Linking.createURL('profile');
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: redirectUrl,
                    skipBrowserRedirect: true,
                },
            });

            if (error) throw error;

            if (data?.url) {
                const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
                if (result.type === 'success' && result.url) {
                    // Supabase might send tokens in the query params OR the hash (fragment)
                    const parsed = Linking.parse(result.url);
                    let access_token: string | string[] | undefined | null = parsed.queryParams?.access_token;
                    let refresh_token: string | string[] | undefined | null = parsed.queryParams?.refresh_token;

                    if (!access_token || !refresh_token) {
                        const hash = result.url.split('#')[1];
                        if (hash) {
                            const params = new URLSearchParams(hash);
                            access_token = params.get("access_token") || undefined;
                            refresh_token = params.get("refresh_token") || undefined;
                        }
                    }

                    if (access_token && refresh_token) {
                        const { error: sessionError } = await supabase.auth.setSession({
                            access_token: Array.isArray(access_token) ? access_token[0] : access_token,
                            refresh_token: Array.isArray(refresh_token) ? refresh_token[0] : refresh_token,
                        });
                        if (sessionError) throw sessionError;

                        if (onSuccess) {
                            onSuccess();
                        } else {
                            handleNavigation();
                        }
                    }
                }
            }
        } catch (err: any) {
            setError(err.message || 'An error occurred during Google sign in');
        } finally {
            setLoading(false);
        }
    };

    const handleAppleSignIn = async () => {
        try {
            setLoading(true);
            setError(null);

            const credential = await AppleAuthentication.signInAsync({
                requestedScopes: [
                    AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                    AppleAuthentication.AppleAuthenticationScope.EMAIL,
                ],
            });

            if (credential.identityToken) {
                const { error } = await supabase.auth.signInWithIdToken({
                    provider: 'apple',
                    token: credential.identityToken,
                });
                if (error) throw error;

                if (onSuccess) {
                    onSuccess();
                } else {
                    handleNavigation();
                }
            } else {
                throw new Error('No identity token found from Apple');
            }
        } catch (err: any) {
            if (err.code !== 'ERR_REQUEST_CANCELED') {
                setError(err.message || 'An error occurred during Apple sign in');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleNavigation = () => {
        Toast.show({
            type: 'success',
            text1: 'Signed in successfully!',
            position: 'top',
            visibilityTime: 2500,
        });

        // Small delay to allow toast to show and auth state to settle
        setTimeout(() => {
            router.replace("/(tabs)/profile");
        }, 150);
    };

    return (
        <View style={styles.container}>
            <View style={styles.buttonContainer}>
                {Platform.OS === 'ios' && (
                    <TouchableOpacity
                        style={[
                            styles.oauthButton,
                            {
                                backgroundColor: '#FFF',
                                borderWidth: 1,
                                borderColor: theme.colors.outlineVariant
                            }
                        ]}
                        onPress={handleAppleSignIn}
                        disabled={loading}
                    >
                        <FontAwesome name="apple" size={20} color="#000" style={styles.icon} />
                        <Text style={[styles.buttonText, { color: '#000' }]}>Continue with Apple</Text>
                    </TouchableOpacity>
                )}

                <TouchableOpacity
                    style={[
                        styles.oauthButton,
                        {
                            backgroundColor: '#FFF',
                            borderWidth: 1,
                            borderColor: '#DADCE0'
                        }
                    ]}
                    onPress={handleGoogleSignIn}
                    disabled={loading}
                >
                    <FontAwesome name="google" size={18} color="#4285F4" style={styles.icon} />
                    <Text style={[styles.buttonText, { color: '#3C4043' }]}>Continue with Google</Text>
                </TouchableOpacity>
            </View>

            {showSeparator && (
                <View style={styles.separatorContainer}>
                    <View style={[styles.line, { backgroundColor: theme.colors.outlineVariant }]} />
                    <Text style={[styles.separatorText, { color: theme.colors.onSurfaceVariant }]}>or use email</Text>
                    <View style={[styles.line, { backgroundColor: theme.colors.outlineVariant }]} />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
    },
    separatorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 32,
    },
    line: {
        flex: 1,
        height: 1,
    },
    separatorText: {
        marginHorizontal: 16,
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    buttonContainer: {
        gap: 12,
    },
    oauthButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 52,
        borderRadius: 26,
        paddingHorizontal: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    icon: {
        marginRight: 10,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
    },
});
