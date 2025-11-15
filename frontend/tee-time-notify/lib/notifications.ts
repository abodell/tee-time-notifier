import * as Notifications from "expo-notifications"
import * as Device from "expo-device"
import { supabase } from "./supabase"

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000"

export async function registerForPushNotificationsAsync() {
    if (!Device.isDevice) return;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync()
        finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    const token = (await Notifications.getExpoPushTokenAsync()).data
    console.log("Expo push token:", token)

    const { data } = await supabase.auth.getSession()
    const user = data.session?.user
    if (!user) return;

    await fetch(`${API_URL}/push/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: user.id, token })
    })
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