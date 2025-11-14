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
    return request(`alerts/${alertId}`, { method: "DELETE" })
}