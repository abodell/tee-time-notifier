from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import List
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import httpx
import asyncio
from app.db import create_supabase
from app.services.push_service import send_push_notification
from app.services.alert_service import get_user_push_token

router = APIRouter(prefix="/alerts", tags=["alerts"])

@router.post("/create")
async def create_alert(alert: dict):
    """ Create a new alert (enforcing membership tier restrictions) """
    try:
        supabase = await create_supabase()
        user_id = alert.get("user_id")
        if not user_id:
            raise HTTPException(status_code = 400, detail = "Missing user_id")
        
        # Fetch the profile
        profile = await (
            supabase.table("user_profiles")
            .select("id, membership_tier_id")
            .eq("id", user_id)
            .single()
            .execute()
        )

        if not profile.data:
            raise HTTPException(status_code=404, detail="User profile not found.")
        
        tier_id = profile.data.get("membership_tier_id")
        if not tier_id:
            raise HTTPException(status_code=400, detail="Membership tier not found.")
        
        # Fetch tier info
        tier = await (
            supabase.table("membership_tiers")
            .select("id, name, max_alerts")
            .eq("id", tier_id)
            .single()
            .execute()
        )

        if not tier.data:
            raise HTTPException(status_code=404, detail="Tier not found.")
        
        max_alerts = tier.data.get("max_alerts")
        tier_name = tier.data.get("name")

        # get the current existing alerts for this user
        current_alerts = await (
            supabase.table("alerts")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        )
        alert_count = current_alerts.count if hasattr(current_alerts, "count") else len(current_alerts.data or [])

        if max_alerts is not None and alert_count >= max_alerts:
            raise HTTPException(
                status_code=403,
                detail=f"Your {tier_name} plan allows up to {max_alerts} active alert(s). Please upgrade your plan to add more"
            )
            
        is_recurring = alert.get("is_recurring", False) if tier_name == "Pro" else False
        players = alert.get("players") if tier_name in ("Plus", "Pro") else None

        # Build strict payload
        insert_payload = {
            "user_id": user_id,
            "course_id": alert.get("course_id"),
            "holes": alert.get("holes"),
            "players": players,
            "date_from": alert.get("date_from"),
            "date_to": alert.get("date_to"),
            "start_time": alert.get("start_time"),
            "end_time": alert.get("end_time"),
            "is_recurring": is_recurring
        }
            
        result = await supabase.table("alerts").insert(insert_payload).execute()
        return {"status": "success", "alert": result.data[0]}
    
    except HTTPException:
        raise
    except Exception as e:
        print("Alert creation error: ", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{alert_id}/scan-now")
async def scan_alert_now(alert_id: int, background_tasks: BackgroundTasks):
    """
    Immediately scan for tee times matching this alert and send a push notification.
    Returns instantly; scan runs in the background.

    Push outcomes:
      - Exact match found      → "⚡️ Tee Time Found!" with alertId deep link
      - Nearby match (±3 days) → "Nothing on your date, but we found [nearby date]"
      - No availability        → "🎯 Armed! We'll notify you when something opens"
    """
    background_tasks.add_task(_immediate_scan, alert_id)
    return {"status": "scanning"}


async def _scan_provider_for_alert(supabase, course: dict, date_from: str, alert_id: int = None):
    """
    Run a live scan of the course's provider for the alert's target date,
    populating the availability table with fresh data before we query it.
    GolfNow is skipped (runs via GitHub Actions externally).
    """
    provider = (course.get("provider") or "").lower()
    try:
        dt = datetime.fromisoformat(date_from.replace("Z", "+00:00"))

        if provider == "foreup":
            from app.services.foreup_service import get_provider_configs, fetch_foreup_times, normalize_and_store
            date_str = dt.strftime("%m-%d-%Y")
            cfgs = await get_provider_configs(supabase, course["id"])
            data = await fetch_foreup_times(course, cfgs, date_str, "all")
            await normalize_and_store(course, data, date_str, "all")

        elif provider == "chronogolf":
            from app.services.chronogolf_service import get_provider_configs, fetch_chronogolf_times, normalize_and_store
            date_str = dt.strftime("%Y-%m-%d")
            cfgs = await get_provider_configs(supabase, course["id"])
            data, is_v2 = await fetch_chronogolf_times(supabase, course["id"], cfgs, date_str)
            await normalize_and_store(course, data, date_str, is_v2=is_v2)

        elif provider == "quick18":
            from app.services.quick18_service import scan_quick18_course
            date_str = dt.strftime("%Y%m%d")
            await scan_quick18_course(course, date_str)

        elif provider == "eagleclub":
            from app.services.eagleclub_service import get_provider_configs, fetch_eagleclub_times, normalize_and_store
            cfgs = await get_provider_configs(supabase, course["id"])
            async with httpx.AsyncClient() as client:
                data = await fetch_eagleclub_times(client, course, cfgs)
            await normalize_and_store(course, data)

        elif provider == "teeitup":
            from app.services.teeitup_service import get_provider_configs, fetch_teeitup_times, normalize_and_store
            date_str = dt.strftime("%Y-%m-%d")
            cfgs = await get_provider_configs(supabase, course["id"])
            data = await fetch_teeitup_times(course, cfgs, date_str)
            await normalize_and_store(course, data, date_str)

        elif provider == "webtrac":
            from app.services.webtrac_service import get_provider_configs, fetch_webtrac_times, normalize_and_store
            date_str = dt.strftime("%m/%d/%Y")
            cfgs = await get_provider_configs(supabase, course["id"])
            base_url = cfgs.get("base_url")
            num_players = int(cfgs.get("num_players", 4))
            num_holes = int(cfgs.get("num_holes", 18))
            data = await fetch_webtrac_times(base_url, date_str, num_players, num_holes)
            await normalize_and_store(course, data, date_str)

        elif provider == "cps":
            from app.services.cps_service import get_provider_configs, fetch_cps_times, normalize_and_store
            date_str = dt.strftime("%Y-%m-%d")
            cfgs = await get_provider_configs(supabase, course["id"])
            site_name = cfgs.get("site_name")
            api_key = cfgs.get("api_key")
            course_id = int(cfgs.get("course_id", 1))
            member_store_id = int(cfgs.get("member_store_id", 1))
            data = await fetch_cps_times(site_name, api_key, course_id, date_str, member_store_id, course.get("time_zone", "America/New_York"))
            await normalize_and_store(course, data, date_str)

        elif provider == "whoosh":
            from app.services.whoosh_service import get_provider_configs, fetch_whoosh_times, normalize_and_store
            date_str = dt.strftime("%Y-%m-%d")
            cfgs = await get_provider_configs(supabase, course["id"])
            data = await fetch_whoosh_times(course, cfgs, date_str)
            await normalize_and_store(course, data, date_str)

        elif provider == "golfnow":
            from app.config import settings
            if not settings.GITHUB_PAT:
                print("[ScanNow] GolfNow scan skipped — GITHUB_PAT not set")
                return "async"
            url = f"https://api.github.com/repos/{settings.GITHUB_OWNER}/{settings.GITHUB_REPO}/actions/workflows/golfnow-scan.yml/dispatches"
            headers = {
                "Authorization": f"token {settings.GITHUB_PAT}",
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "TeeTimeNotifier-Backend",
            }
            payload = {"ref": "main"}
            if alert_id:
                payload["inputs"] = {"alert_id": str(alert_id)}
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, headers=headers, json=payload, timeout=10.0)
            if resp.status_code == 204:
                print(f"[ScanNow] GolfNow workflow dispatched for {course.get('name')} with alert_id={alert_id}")
            else:
                print(f"[ScanNow] GolfNow workflow dispatch failed: {resp.status_code} {resp.text}")
            return "async"

        else:
            print(f"[ScanNow] Unknown provider '{provider}' for {course.get('name')} — skipping live scan")
            return

        print(f"[ScanNow] Live scan complete for {course.get('name')} ({provider})")

    except Exception as e:
        import traceback
        print(f"[ScanNow] Live scan failed for {course.get('name')} ({provider}): {e}")
        print(f"[ScanNow] Traceback:\n{traceback.format_exc()}")
        # Non-fatal — fall through to availability query with whatever is cached


async def _immediate_scan(alert_id: int):
    try:
        supabase = await create_supabase()

        alert_res = await (
            supabase.table("alerts")
            .select("*, courses!alerts_course_id_fkey(id, name, provider, time_zone)")
            .eq("id", alert_id)
            .single()
            .execute()
        )
        alert = alert_res.data
        if not alert:
            print(f"[ScanNow] Alert {alert_id} not found.")
            return

        course = alert["courses"]
        course_name = course["name"]
        user_id = alert["user_id"]
        course_id = alert["course_id"]
        holes = alert.get("holes")

        # Run a live provider scan so the availability table has fresh data.
        # GolfNow returns "async" — the GitHub Actions workflow will call back via
        # POST /alerts/{alert_id}/check once the scan completes.
        scan_result = await _scan_provider_for_alert(supabase, course, alert["date_from"], alert_id=alert_id)
        if scan_result == "async":
            print(f"[ScanNow] GolfNow workflow dispatched — check will fire via callback when scan completes")
            return

        await _check_and_notify(alert_id, supabase=supabase, alert=alert)

    except Exception as e:
        print(f"[ScanNow] Error for alert {alert_id}: {e}")


async def _check_and_notify(alert_id: int, supabase=None, alert: dict = None):
    """
    Query availability for a specific alert and send the appropriate push notification.
    Used by both scan-now (inline providers) and the GolfNow callback endpoint.
    """
    try:
        if supabase is None:
            supabase = await create_supabase()

        if alert is None:
            alert_res = await (
                supabase.table("alerts")
                .select("*, courses!alerts_course_id_fkey(id, name, provider, time_zone)")
                .eq("id", alert_id)
                .single()
                .execute()
            )
            alert = alert_res.data
            if not alert:
                print(f"[CheckNotify] Alert {alert_id} not found.")
                return

        course = alert["courses"]
        course_name = course["name"]
        user_id = alert["user_id"]
        course_id = alert["course_id"]
        holes = alert.get("holes")
        players = alert.get("players")  # None = Any

        token = await get_user_push_token(user_id)
        if not token:
            print(f"[CheckNotify] No push token for user {user_id}, skipping.")
            return

        start_dt = datetime.fromisoformat(alert["start_time"]).astimezone(timezone.utc)
        end_dt = datetime.fromisoformat(alert["end_time"]).astimezone(timezone.utc)
        now = datetime.now(timezone.utc)

        tz_name = course.get("time_zone", "UTC")
        try:
            course_tz = ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            course_tz = timezone.utc

        def fmt(dt: datetime) -> str:
            local_dt = dt.astimezone(course_tz)
            time_str = local_dt.strftime("%I:%M %p").lstrip("0")
            return f"{local_dt.strftime('%a %b')} {local_dt.day} at {time_str}"

        def apply_players_filter(q):
            if players is not None:
                # Pass through slots where spots_available is unknown (NULL) so
                # providers without player count data don't silently block notifications.
                return q.or_(f"spots_available.is.null,spots_available.gte.{players}")
            return q

        # 1. Exact match
        exact_q = (
            supabase.table("availability")
            .select("id, tee_time")
            .eq("course_id", course_id)
            .eq("holes", holes)
            .eq("available", True)
            .gte("tee_time", start_dt.isoformat())
            .lte("tee_time", end_dt.isoformat())
            .order("tee_time")
            .limit(1)
        )
        exact_res = await apply_players_filter(exact_q).execute()
        if exact_res.data:
            availability_id = exact_res.data[0]["id"]
            tee_dt = datetime.fromisoformat(exact_res.data[0]["tee_time"]).astimezone(timezone.utc)
            await supabase.table("alert_notifications").insert({
                "alert_id": alert_id,
                "availability_id": availability_id,
                "sent_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
            await send_push_notification(
                token,
                f"{course_name} Tee Time",
                f"{fmt(tee_dt)}. Tap to book now.",
                data={"alertId": str(alert_id)},
            )
            return

        # 2. Nearby match (±3 days, never before today)
        nearby_start = max(
            now.replace(hour=0, minute=0, second=0, microsecond=0),
            (start_dt - timedelta(days=3)).replace(hour=0, minute=0, second=0, microsecond=0),
        )
        nearby_end = (end_dt + timedelta(days=3)).replace(hour=23, minute=59, second=59, microsecond=0)

        nearby_q = (
            supabase.table("availability")
            .select("id, tee_time")
            .eq("course_id", course_id)
            .eq("holes", holes)
            .eq("available", True)
            .gte("tee_time", nearby_start.isoformat())
            .lte("tee_time", nearby_end.isoformat())
            .order("tee_time")
            .limit(1)
        )
        nearby_res = await apply_players_filter(nearby_q).execute()
        if nearby_res.data:
            tee_dt = datetime.fromisoformat(nearby_res.data[0]["tee_time"]).astimezone(timezone.utc)
            await send_push_notification(
                token,
                f"{course_name}",
                f"Nothing for your alert, but {fmt(tee_dt)} is open.",
                data={"alertId": str(alert_id)},
            )
            return

        # 3. Nothing found
        await send_push_notification(
            token,
            f"{course_name}",
            "No openings right now. We're watching 24/7 and will alert you the instant something appears.",
            data={"alertId": str(alert_id)},
        )

    except Exception as e:
        print(f"[CheckNotify] Error for alert {alert_id}: {e}")


@router.post("/{alert_id}/check")
async def check_alert_now(alert_id: int, background_tasks: BackgroundTasks):
    """
    Called by the GolfNow GitHub Actions workflow after the scan completes.
    Runs the availability check and sends the appropriate push notification.
    """
    background_tasks.add_task(_check_and_notify, alert_id)
    return {"status": "checking"}


@router.get("/user/{user_id}")
async def get_user_alerts(user_id: str):
    """ Return all active alerts for a user. """
    supabase = await create_supabase()
    alerts = await(
        supabase.table("alerts")
        .select(
            "*, "
            "courses!alerts_course_id_fkey(name, city, state, provider_url, time_zone), "
            "alert_notifications(id, sent_at, availability(tee_time, price, spots_available))"
        )
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return alerts.data or []

@router.delete("/{alert_id}")
async def delete_alert(alert_id: int):
    """ Delete an alert. """
    supabase = await create_supabase()
    await supabase.table("alerts").delete().eq("id", alert_id).execute()
    return {"status": "deleted", "alert_id": alert_id}