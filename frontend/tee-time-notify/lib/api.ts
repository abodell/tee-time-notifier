import { Alert } from "@/types/alert";
import { supabase } from "./supabase";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL

async function request(path: string, options: RequestInit = {}) {
    const session = (await supabase.auth.getSession()).data.session;
    const token = session?.access_token;

    const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
    }

    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
    if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).detail || "Request failed";
        throw new Error(msg)
    }
    return res.json()
}

export async function createAlert(alert: Alert) {
    return request("/alerts/create", {
        method: "POST",
        body: JSON.stringify(alert),
    })
}

export async function getUserAlerts(userId: string) {
    return request(`/alerts/user/${userId}`)
}

export async function deleteAlert(alertId: number) {
    return request(`/alerts/${alertId}`, { method: "DELETE" })
}

export async function triggerImmediateScan(alertId: number) {
    return request(`/alerts/${alertId}/scan-now`, { method: "POST" })
}

export async function updateNotificationPreferences(
    userId: string,
    prefs: { quiet_hours_enabled?: boolean; quiet_hours_start?: string; quiet_hours_end?: string }
) {
    return request(`/membership/profile/${userId}/notifications`, {
        method: "PATCH",
        body: JSON.stringify(prefs),
    })
}