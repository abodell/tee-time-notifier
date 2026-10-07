from fastapi import APIRouter, HTTPException
from datetime import datetime, timezone, timedelta
import random
import string
from app.db import create_supabase
from app.services.membership_service import get_all_tiers_map, resolve_effective_tier_id

router = APIRouter(prefix="/referrals", tags=["referrals"])

REFERRAL_REWARD_DAYS = 7

# Characters that are easy to misread/mistype by hand are excluded (0/O, 1/I/L).
_CODE_ALPHABET = "".join(c for c in string.ascii_uppercase + string.digits if c not in "0O1IL")


def _generate_code(length: int = 6) -> str:
    return "".join(random.choice(_CODE_ALPHABET) for _ in range(length))


async def _grant_bonus_pro(supabase, user_id: str, days: int = REFERRAL_REWARD_DAYS):
    """
    Grant (or extend) temporary Pro access without touching the user's real
    membership_tier_id — the same bonus-tier columns feature/weekend-pass
    introduces (bonus_tier_id/bonus_expires_at), kept self-contained here
    rather than importing across branches. A real subscription is never
    affected: the base tier column is untouched either way.
    """
    tier_res = await (
        supabase.table("membership_tiers")
        .select("id")
        .eq("name", "Pro")
        .single()
        .execute()
    )
    if not tier_res.data:
        return
    pro_id = tier_res.data["id"]

    profile_res = await (
        supabase.table("user_profiles")
        .select("bonus_expires_at")
        .eq("id", user_id)
        .single()
        .execute()
    )
    now = datetime.now(timezone.utc)
    base = now
    current_expiry_raw = (profile_res.data or {}).get("bonus_expires_at")
    if current_expiry_raw:
        current_expiry = datetime.fromisoformat(str(current_expiry_raw).replace("Z", "+00:00"))
        if current_expiry.tzinfo is None:
            current_expiry = current_expiry.replace(tzinfo=timezone.utc)
        if current_expiry > now:
            base = current_expiry

    new_expiry = base + timedelta(days=days)
    await (
        supabase.table("user_profiles")
        .update({"bonus_tier_id": pro_id, "bonus_expires_at": new_expiry.isoformat()})
        .eq("id", user_id)
        .execute()
    )


@router.get("/me/{user_id}")
async def get_my_referral_info(user_id: str):
    """
    Return the user's own referral code — generating and persisting one on
    first request if they don't have one yet — plus how many people they've
    referred and whether they've already redeemed a code themselves.
    """
    supabase = await create_supabase()

    profile = await (
        supabase.table("user_profiles")
        .select("referral_code, referred_by")
        .eq("id", user_id)
        .single()
        .execute()
    )
    if not profile.data:
        raise HTTPException(status_code=404, detail="Profile not found.")

    code = profile.data.get("referral_code")
    if not code:
        # Small retry loop in case of a rare unique-constraint collision.
        for _ in range(5):
            candidate = _generate_code()
            try:
                await (
                    supabase.table("user_profiles")
                    .update({"referral_code": candidate})
                    .eq("id", user_id)
                    .execute()
                )
                code = candidate
                break
            except Exception:
                continue
        if not code:
            raise HTTPException(status_code=500, detail="Could not generate a referral code.")

    referred_count_res = await (
        supabase.table("user_profiles")
        .select("id", count="exact")
        .eq("referred_by", user_id)
        .execute()
    )
    referred_count = (
        referred_count_res.count
        if hasattr(referred_count_res, "count") and referred_count_res.count is not None
        else len(referred_count_res.data or [])
    )

    return {
        "referral_code": code,
        "referred_count": referred_count,
        "has_redeemed": bool(profile.data.get("referred_by")),
        "reward_days": REFERRAL_REWARD_DAYS,
    }


@router.post("/redeem")
async def redeem_referral_code(payload: dict):
    """
    Redeem a friend's referral code: grants both the new user and the
    referrer REFERRAL_REWARD_DAYS of temporary Pro access. One-time per
    account — a user with referred_by already set can't redeem again.
    """
    user_id = payload.get("user_id")
    code = (payload.get("code") or "").strip().upper()
    if not user_id or not code:
        raise HTTPException(status_code=400, detail="user_id and code are required.")

    supabase = await create_supabase()

    profile = await (
        supabase.table("user_profiles")
        .select("id, referred_by")
        .eq("id", user_id)
        .single()
        .execute()
    )
    if not profile.data:
        raise HTTPException(status_code=404, detail="Profile not found.")
    if profile.data.get("referred_by"):
        raise HTTPException(status_code=400, detail="A referral code has already been redeemed on this account.")

    referrer_res = await (
        supabase.table("user_profiles")
        .select("id, membership_tier_id, bonus_tier_id, bonus_expires_at")
        .eq("referral_code", code)
        .execute()
    )
    referrer_rows = referrer_res.data or []
    if not referrer_rows:
        raise HTTPException(status_code=404, detail="That referral code doesn't exist.")

    referrer = referrer_rows[0]
    referrer_id = referrer["id"]
    if referrer_id == user_id:
        raise HTTPException(status_code=400, detail="You can't redeem your own referral code.")

    # Check the referrer's tier *before* granting, since granting will
    # extend bonus_expires_at and make the bonus look "active" either way.
    tiers_by_id = await get_all_tiers_map(supabase)
    referrer_effective_tier_id = resolve_effective_tier_id(
        tiers_by_id,
        referrer.get("membership_tier_id"),
        referrer.get("bonus_tier_id"),
        referrer.get("bonus_expires_at"),
    )
    referrer_already_pro = (tiers_by_id.get(referrer_effective_tier_id) or {}).get("name") == "Pro"

    await (
        supabase.table("user_profiles")
        .update({"referred_by": referrer_id})
        .eq("id", user_id)
        .execute()
    )

    await _grant_bonus_pro(supabase, user_id)
    await _grant_bonus_pro(supabase, referrer_id)

    message = (
        f"You got {REFERRAL_REWARD_DAYS} days of Pro! Your friend is already on Pro, so their "
        f"days are banked — they'll kick in automatically if their plan ever lapses."
        if referrer_already_pro
        else f"You and your friend both got {REFERRAL_REWARD_DAYS} days of Pro!"
    )

    return {
        "status": "success",
        "reward_days": REFERRAL_REWARD_DAYS,
        "message": message,
    }
