import asyncio
from datetime import datetime, timezone
from app.services.foreup_service import run_foreup_scan
from app.services.alert_service import run_alert_engine
from app.db import create_supabase

async def scan_foreup_job():
    """
    Global ForeUp availability scan (runs on clock-aligned intervals)
    """
    now = datetime.now(timezone.utc).isoformat()
    print(f"[Scheduler] Running ForeUp scan at {now}")

    try:
        await run_foreup_scan()
        print("[Scheduler] ForeUp scan completed!")
    except Exception as e:
        print(f"[Scheduler] Error during ForeUp scan: {e}")


async def get_all_tiers():
    """
    Fetch all membership tiers from the DB
    """
    supabase = await create_supabase()
    res = await supabase.table("membership_tiers").select("*").execute()
    return res.data or []

async def run_alert_engine_for_tier(tier_id: int):
    """
    Run the alert engine ONLY for users belonging to this tier.
    """
    try:
        await run_alert_engine(tier_id)
    except Exception as e:
        print(f"[Scheduler] Error in alert engine for tier {tier_id}: {e}")