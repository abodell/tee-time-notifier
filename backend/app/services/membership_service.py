"""
Bonus-tier helpers: temporary tier grants (Weekend Pass, referral rewards)
layered on top of a user's real membership_tier_id.

Design: membership_tier_id always reflects the user's real subscription
state and is only ever written by the RevenueCat webhook (see
app/routes/revenuecat.py). bonus_tier_id / bonus_expires_at are a separate,
additive grant that expires on its own and never overwrites the base tier.
Anywhere a user's entitlements are checked for gating (max alerts, scan
frequency, recurring, etc.) should resolve the *effective* tier via
resolve_effective_tier_id rather than reading membership_tier_id directly.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

BONUS_GRANT_TIER_NAME = "Pro"


async def get_all_tiers_map(supabase) -> dict:
    """Fetch all membership_tiers rows once, keyed by id. The table is tiny
    (a handful of rows) so this is cheap to call per-request."""
    res = await supabase.table("membership_tiers").select("*").execute()
    return {t["id"]: t for t in (res.data or [])}


def _parse_dt(value) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def resolve_effective_tier_id(tiers_by_id: dict, base_tier_id, bonus_tier_id, bonus_expires_at) -> int:
    """
    Return the tier id that should govern the user's entitlements right now.

    The bonus tier only ever wins if it's currently active AND it grants more
    than the base tier (compared by max_alerts, treating None as unlimited).
    This means a bonus grant can never accidentally downgrade a real paying
    subscriber, and it's a no-op once it lapses.
    """
    if not bonus_tier_id:
        return base_tier_id

    expires = _parse_dt(bonus_expires_at)
    if not expires or expires <= datetime.now(timezone.utc):
        return base_tier_id

    base = tiers_by_id.get(base_tier_id, {})
    bonus = tiers_by_id.get(bonus_tier_id, {})
    base_max = base.get("max_alerts")
    bonus_max = bonus.get("max_alerts")

    if base_max is None:  # base tier is already unlimited
        return base_tier_id
    if bonus_max is None or bonus_max > base_max:
        return bonus_tier_id
    return base_tier_id


async def grant_temporary_tier(supabase, user_id: str, days: int, tier_name: str = BONUS_GRANT_TIER_NAME) -> datetime:
    """
    Grant (or extend) a temporary tier for `days` from now — or from the
    current bonus expiry if one is already active and in the future, so
    stacking a second grant (e.g. two referrals) extends rather than resets.
    """
    tier_res = await (
        supabase.table("membership_tiers")
        .select("id")
        .eq("name", tier_name)
        .single()
        .execute()
    )
    if not tier_res.data:
        raise ValueError(f"No membership tier named '{tier_name}'")
    tier_id = tier_res.data["id"]

    profile_res = await (
        supabase.table("user_profiles")
        .select("bonus_expires_at")
        .eq("id", user_id)
        .single()
        .execute()
    )
    now = datetime.now(timezone.utc)
    base = now
    current_expiry = _parse_dt((profile_res.data or {}).get("bonus_expires_at"))
    if current_expiry and current_expiry > now:
        base = current_expiry

    new_expiry = base + timedelta(days=days)

    await (
        supabase.table("user_profiles")
        .update({
            "bonus_tier_id": tier_id,
            "bonus_expires_at": new_expiry.isoformat(),
        })
        .eq("id", user_id)
        .execute()
    )
    return new_expiry


async def expire_bonus_access(supabase) -> int:
    """Clear bonus_tier_id/bonus_expires_at for any grant that has lapsed.
    Returns the number of profiles cleared."""
    now = datetime.now(timezone.utc).isoformat()
    res = await (
        supabase.table("user_profiles")
        .update({"bonus_tier_id": None, "bonus_expires_at": None})
        .lt("bonus_expires_at", now)
        .execute()
    )
    return len(res.data or [])
