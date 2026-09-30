from fastapi import APIRouter, HTTPException
from app.db import create_supabase
from app.services.membership_service import get_all_tiers_map, resolve_effective_tier_id

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
                "bonus_tier_id, bonus_expires_at, "
                "membership_tiers!user_profiles_membership_tier_id_fkey(id, name, description, price_cents, max_alerts, scan_interval_seconds)"
            )
            .eq("id", user_id)
            .single()
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code = 404, detail = "Profile not found.")

        profile = result.data

        # If a temporary bonus grant (Weekend Pass, referral reward) is
        # active and better than the user's real tier, surface its perks
        # through the same `membership_tiers` field the app already reads —
        # this makes bonus access work correctly even for app versions that
        # shipped before this feature existed. `membership_tier_id` itself is
        # left untouched: it always reflects the real subscription tier, so
        # upgrade/downgrade UI logic isn't affected.
        tiers_by_id = await get_all_tiers_map(supabase)
        base_tier_id = profile.get("membership_tier_id")
        effective_tier_id = resolve_effective_tier_id(
            tiers_by_id, base_tier_id, profile.get("bonus_tier_id"), profile.get("bonus_expires_at")
        )
        is_bonus_active = effective_tier_id != base_tier_id

        if is_bonus_active:
            effective_tier = tiers_by_id.get(effective_tier_id, {})
            profile["membership_tiers"] = {
                "id": effective_tier.get("id"),
                "name": effective_tier.get("name"),
                "description": effective_tier.get("description"),
                "price_cents": effective_tier.get("price_cents"),
                "max_alerts": effective_tier.get("max_alerts"),
                "scan_interval_seconds": effective_tier.get("scan_interval_seconds"),
            }

        profile["is_bonus_active"] = is_bonus_active
        profile["bonus_expires_at"] = profile.get("bonus_expires_at") if is_bonus_active else None
        return profile
    except HTTPException:
        raise
    except Exception as e:
        print("Error fetching user membership: ", e)
        raise HTTPException(status_code = 500, detail = "Failed ot fetch user membership.")