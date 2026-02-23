import asyncio
from datetime import datetime, timezone
from app.services.foreup_service import run_foreup_scan
from app.services.chronogolf_service import run_chronogolf_scan
from app.services.quick18_service import run_quick18_scan
from app.services.golfnow_service import run_golfnow_scan
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


async def scan_chronogolf_job():
    """
    Global ChronoGolf availability scan
    """
    now = datetime.now(timezone.utc).isoformat()
    print(f"[Scheduler] Running ChronoGolf scan at {now}")

    try:
        await run_chronogolf_scan()
        print("[Scheduler] ChronoGolf scan completed!")
    except Exception as e:
        print(f"[Scheduler] Error during ChronoGolf scan: {e}")


async def scan_quick18_job():
    """
    Global Quick18 availability scan
    """
    now = datetime.now(timezone.utc).isoformat()
    print(f"[Scheduler] Running Quick18 scan at {now}")

    try:
        await run_quick18_scan()
        print("[Scheduler] Quick18 scan completed!")
    except Exception as e:
        print(f"[Scheduler] Error during Quick18 scan: {e}")


async def scan_golfnow_job():
    """
    Global GolfNow availability scan
    """
    now = datetime.now(timezone.utc).isoformat()
    print(f"[Scheduler] Running GolfNow scan at {now}")

    try:
        await run_golfnow_scan()
        print("[Scheduler] GolfNow scan completed!")
    except Exception as e:
        print(f"[Scheduler] Error during GolfNow scan: {e}")


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