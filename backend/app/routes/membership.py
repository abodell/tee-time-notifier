from fastapi import APIRouter, HTTPException
from app.db import create_supabase
from app.config import settings

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
                "lifetime_alerts_created, "
                "membership_tiers!user_profiles_membership_tier_id_fkey(name, description, price_cents, max_alerts, scan_interval_seconds)"
            )
            .eq("id", user_id)
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code = 404, detail = "Profile not found.")

        profile = result.data
        if (profile.get("membership_tiers") or {}).get("name") == "Free":
            profile["free_lifetime_alert_limit"] = settings.FREE_LIFETIME_ALERT_LIMIT

        return profile
    except HTTPException:
        raise
    except Exception as e:
        print("Error fetching user membership: ", e)
        raise HTTPException(status_code = 500, detail = "Failed ot fetch user membership.")