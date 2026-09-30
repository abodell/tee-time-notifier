from fastapi import APIRouter, HTTPException
from app.db import create_supabase

router = APIRouter(prefix="/membership", tags=["membership"])

@router.get("/tiers")
async def list_membership_tiers():
    """
    Public route - return all available membership tiers for display.
    No authentication required.
    """
    try:
        supabase = await create_supabase()
        result = await (
            supabase.table("membership_tiers")
            .select("id, name, description, price_cents, max_alerts, scan_interval_seconds, revenuecat_entitlement_id")
            .order("id")
            .execute()
        )

        return result.data or []
    except Exception as e:
        print("Error fetching membership tiers: ", e)
        raise HTTPException(status_code = 500, detail = "Failed to fetch membership tiers.")
    
@router.get("/profile/{user_id}")
async def get_user_membership(user_id: str):
    """
    Return the user's profile joined with membership_tier data
    """
    try:
        supabase = await create_supabase()
        result = await (
            supabase.table("user_profiles")
            .select(
                "id, full_name, phone, membership_tier_id, stripe_customer_id, pending_downgrade, cancel_at, "
                "quiet_hours_enabled, quiet_hours_start, quiet_hours_end, "
                "membership_tiers!user_profiles_membership_tier_id_fkey(name, description, price_cents, max_alerts, scan_interval_seconds)"
            )
            .eq("id", user_id)
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code = 404, detail = "Profile not found.")
        return result.data
    except HTTPException:
        raise
    except Exception as e:
        print("Error fetching user membership: ", e)
        raise HTTPException(status_code = 500, detail = "Failed ot fetch user membership.")


@router.patch("/profile/{user_id}/notifications")
async def update_notification_preferences(user_id: str, payload: dict):
    """
    Update quiet-hours preferences. quiet_hours_start / quiet_hours_end are
    "HH:MM" (24h) strings; quiet_hours_enabled toggles whether they're
    enforced by the alert engine at all.
    """
    update_payload = {}
    if "quiet_hours_enabled" in payload:
        update_payload["quiet_hours_enabled"] = bool(payload["quiet_hours_enabled"])
    if "quiet_hours_start" in payload:
        update_payload["quiet_hours_start"] = payload["quiet_hours_start"]
    if "quiet_hours_end" in payload:
        update_payload["quiet_hours_end"] = payload["quiet_hours_end"]

    if not update_payload:
        raise HTTPException(status_code=400, detail="No recognized fields to update.")

    try:
        supabase = await create_supabase()
        result = await (
            supabase.table("user_profiles")
            .update(update_payload)
            .eq("id", user_id)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Profile not found.")
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        print("Error updating notification preferences: ", e)
        raise HTTPException(status_code=500, detail="Failed to update notification preferences.")