import * as Notifications from "expo-notifications"
import * as Device from "expo-device"
import Constants from "expo-constants"
import { supabase } from "./supabase"

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000"

export async function registerForPushNotificationsAsync() {
    console.log("[Push] registerForPushNotificationsAsync called, isDevice:", Device.isDevice);
    if (!Device.isDevice) return;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }
    if (finalStatus !== "granted") {
        console.log("[Push] Notifications not granted, skipping token registration");
        return;
    }

    const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.easConfig?.projectId;

    if (!projectId) {
        console.warn("[Push] No projectId found — push token registration skipped");
        return;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    console.log("[Push] Token:", token);

    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) {
        console.warn("[Push] No session when registering token");
        return;
    }

    await fetch(`${API_URL}/push/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, token }),
    });
    console.log("[Push] Token registered for user", user.id);
}

export function setupNotificationHandlers() {
    Notifications.setNotificationHandler({
        handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: true
        })
    })
}