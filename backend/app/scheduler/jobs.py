from datetime import datetime, timezone
from app.services.foreup_service import run_foreup_scan
from app.services.alert_service import run_alert_engine
from app.db import supabase

async def scan_foreup_job():
    """
    Global ForeUp availability scan (runs every 60 seconds)
    """
    now = datetime.now(timezone.utc).isoformat()
    print(f"[Scheduler] Running ForeUp scan at {now}")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        run_foreup_scan(today)
        print("[Scheduler] ForeUp scan completed!")
    except Exception as e:
        print(f"[Scheduler] Error during ForeUp scan: ", e)

def get_all_tiers():
    """
    Fetch all membership tiers from the DB
    """
    res = supabase.table("membership_tiers").select("*").execute()
    return res.data or []

async def run_alert_engine_for_tier(tier_id: int):
    """
    Run the alert engine ONLY for users belonging to this tier.
    """
    print(f"[Scheduler] Running alert engine for tier_id={tier_id}")

    alerts = (
        supabase.table("alerts")
        .select("*, user_profiles!alerts_user_id_fkey(membership_tier_id)")
        .execute()
    )

    filtered_alerts = [
        a
        for a in (alerts.data or [])
        if a.get("user_profiles", {}).get("membership_tier_id") == tier_id
    ]

    if not filtered_alerts:
        print(f"[Scheduler] No active alerts for tier {tier_id}")
        return
    
    try:
        run_alert_engine()
        print(f"[Scheduler] Alert engine completed for tier {tier_id}")
    except Exception as e:
        print(f"[Scheduler] Error in alert engine for tier {tier_id}: {e}")