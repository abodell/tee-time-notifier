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

export async function getAlert(alertId: number) {
    return request(`/alerts/${alertId}`)
}

export async function updateAlert(alertId: number, alert: Partial<Alert>) {
    return request(`/alerts/${alertId}`, {
        method: "PATCH",
        body: JSON.stringify(alert),
    })
}

export async function triggerImmediateScan(alertId: number) {
    return request(`/alerts/${alertId}/scan-now`, { method: "POST" })
}

export async function getMyReferralInfo(userId: string) {
    return request(`/referrals/me/${userId}`)
}

export async function redeemReferralCode(userId: string, code: string) {
    return request(`/referrals/redeem`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId, code }),
    })
}

/** Pass an ISO string to mute the whole alert until then, or null to unmute. */
export async function muteAlert(alertId: number, mutedUntil: string | null) {
    return request(`/alerts/${alertId}/mute`, {
        method: "PATCH",
        body: JSON.stringify({ muted_until: mutedUntil }),
    })
}

/** Pass an ISO string to pause every active alert until then, or null to lift the pause. */
export async function pauseAllAlerts(userId: string, mutedUntil: string | null) {
    return request(`/alerts/user/${userId}/pause-all`, {
        method: "PATCH",
        body: JSON.stringify({ muted_until: mutedUntil }),
    })
}