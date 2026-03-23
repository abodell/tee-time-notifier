import asyncio
import httpx
from datetime import datetime, timezone
from app.services.foreup_service import run_foreup_scan
from app.services.chronogolf_service import run_chronogolf_scan
from app.services.quick18_service import run_quick18_scan
from app.services.eagleclub_service import run_eagleclub_scan
from app.services.webtrac_service import run_webtrac_scan
from app.services.alert_service import run_alert_engine
from app.db import create_supabase
from app.config import settings

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
    Trigger the GolfNow scanner via GitHub Actions API.
    This bypasses OCI IP blocks by running the scan in GitHub's infra.
    """
    now = datetime.now(timezone.utc).isoformat()
    print(f"[Scheduler] Triggering GolfNow GitHub Action at {now}")

    if not settings.GITHUB_PAT:
        print("[Scheduler] Skip GolfNow trigger: GITHUB_PAT not set.")
        return

    url = f"https://api.github.com/repos/{settings.GITHUB_OWNER}/{settings.GITHUB_REPO}/actions/workflows/golfnow-scan.yml/dispatches"
    
    headers = {
        "Authorization": f"token {settings.GITHUB_PAT}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "TeeTimeNotifier-Backend"
    }
    
    payload = {
        "ref": "main"  # Or the default branch
    }

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, headers=headers, json=payload, timeout=10.0)
            
            if resp.status_code == 204:
                print("[Scheduler] Successfully dispatched GolfNow workflow.")
            else:
                print(f"[Scheduler] Failed to dispatch GolfNow workflow. Status: {resp.status_code}")
                print(f"[Scheduler] Response: {resp.text}")
                
    except Exception as e:
        print(f"[Scheduler] Error dispatching GolfNow workflow: {e}")


async def scan_eagleclub_job():
    """
    Global EagleClub availability scan (runs on OCI)
    """
    now = datetime.now(timezone.utc).isoformat()
    print(f"[Scheduler] Running EagleClub scan at {now}")

    try:
        await run_eagleclub_scan()
        print("[Scheduler] EagleClub scan completed!")
    except Exception as e:
        print(f"[Scheduler] Error during EagleClub scan: {e}")


async def scan_webtrac_job():
    """
    Global WebTrac availability scan
    """
    now = datetime.now(timezone.utc).isoformat()
    print(f"[Scheduler] Running WebTrac scan at {now}")

    try:
        await run_webtrac_scan()
        print("[Scheduler] WebTrac scan completed!")
    except Exception as e:
        print(f"[Scheduler] Error during WebTrac scan: {e}")


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