"""
eagleclub_service.py — Tee-time scanning service for EagleClubSystems courses.

Scanning model: one API call per course returns the next 7 days of tee times.
StrDate/StrTime are always set to NOW so the server returns its standard 7-day window.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple

import httpx
from dateutil import tz
from dotenv import load_dotenv

load_dotenv()

from app.db import create_supabase

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
EAGLECLUB_API_URL = "https://api.eagleclubsystems.online/api/online/OnlineAppointmentRetrieve"
EAGLECLUB_VERSION = "1.260306.1"

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Referer": "https://player.eagleclubsystems.online/",
    "Origin": "https://player.eagleclubsystems.online",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
}

# ---------------------------------------------------------------------------
# Target discovery — unique courses only (one call returns 7 days)
# ---------------------------------------------------------------------------
async def get_active_eagleclub_targets() -> Dict[int, Dict]:
    """
    Return a map of {course_db_id: course_obj} for every unique EagleClub
    course that has at least one active alert.  Date iteration is not needed
    because each API call returns the next 7 days automatically.
    """
    supabase = await create_supabase()

    alerts_res = await (
        supabase.table("alerts")
        .select("courses!alerts_course_id_fkey!inner(id, name, provider, time_zone)")
        .eq("active", True)
        .eq("courses.provider", "EagleClub")
        .execute()
    )

    targets: Dict[int, Dict] = {}
    for alert in (alerts_res.data or []):
        course = alert.get("courses")
        if course:
            targets[course["id"]] = course

    return targets


# ---------------------------------------------------------------------------
# Provider config lookup
# ---------------------------------------------------------------------------
async def get_provider_configs(supabase, course_id: int) -> Dict[str, str]:
    """Fetch key/value provider configs for a course."""
    res = await (
        supabase.table("provider_configs")
        .select("key", "value")
        .eq("course_id", course_id)
        .execute()
    )
    return {r["key"]: r["value"] for r in (res.data or [])}


# ---------------------------------------------------------------------------
# API fetch — always uses current date/time; returns next 7 days
# ---------------------------------------------------------------------------
async def fetch_eagleclub_times(
    client: httpx.AsyncClient,
    course: Dict,
    configs: Dict,
) -> List[Dict]:
    """
    POST to the EagleClub API.  StrDate and StrTime are set to the current
    UTC moment so the server returns its standard 7-day availability window.
    """
    dbname = configs.get("dbname")
    org_id = int(configs.get("org_id", 1))
    operator_id = int(configs.get("operator_id", 2))
    price_class_id = int(configs.get("price_class_id", 85))
    carriage_id = int(configs.get("carriage_id", 95))

    if not dbname:
        logger.error(f"[EagleClub] No dbname config for course {course.get('name')}")
        return []

    now = datetime.now(timezone.utc)
    str_date = now.strftime("%Y%m%d")
    str_time = now.strftime("%H%M")

    payload = {
        "BCC": {
            "StrServer": "GSERVER",
            "StrURL": "https://api.EagleClubSystems.online",
            "StrDatabase": dbname,
            "IntOrganizationID": org_id,
            "IntOperatorID": operator_id,
            "EmailErrors": False,
            "SignalRConnectionID": "",
            "Information": "",
            "PrinterName": "",
            "CampaignMonitorMasterListName": "",
            "CampaignMonitorApiKey": "",
            "CampaignMonitorClientID": "",
            "LsteInterfaceID": [],
            "ipAddress": "",
            "Version": EAGLECLUB_VERSION,
            "FromProgram": "BE",
        },
        "StrDate": str_date,
        "StrTime": str_time,
        "TeePriceClassID": price_class_id,
        "IncludeExisting": False,
        "Master_CarriageID": carriage_id,
        "Master_TeePriceClassIDs": f",{price_class_id},",
        "OnlineBookingFormat": 0,
        "OnlineBookingMaxDays": 7,
    }

    print(f"[Fetch EagleClub Times] Fetching {course['name']} | db={dbname} | from={str_date} {str_time}...")

    try:
        resp = await client.post(
            EAGLECLUB_API_URL,
            json=payload,
            headers=REQUEST_HEADERS,
            timeout=20.0,
        )
        resp.raise_for_status()
        body = resp.json()

        bg = body.get("BG", {})
        if not bg.get("BoolSuccess", False):
            err = bg.get("StrResult") or bg.get("StrExceptions") or "unknown error"
            logger.error(f"[EagleClub] API error for {course['name']}: {err}")
            return []

        tee_times = body.get("LstAppointment") or []
        print(f"[EagleClub] Got {len(tee_times)} appointments for {course['name']}")

        # Log fields on first successful fetch to aid discovery of spots field
        if tee_times:
            logger.debug(f"[EagleClub] First appointment fields: {list(tee_times[0].keys())}")

        return tee_times
    except Exception as e:
        logger.error(f"[EagleClub] Fetch error for {course['name']}: {e}")
        return []


# ---------------------------------------------------------------------------
# Normalize & store — handles the full 7-day window returned by one API call
# ---------------------------------------------------------------------------
async def normalize_and_store(
    course: Dict,
    raw_tee_times: List[Dict],
) -> None:
    """
    Convert raw EagleClub tee-time entries to UTC, diff against the DB for
    the full 7-day window, and upsert.
    """
    supabase = await create_supabase()

    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()
    utc_tz = tz.tzutc()

    # Window: today through +8 days (generous buffer around the 7-day return)
    now_utc = datetime.now(timezone.utc)
    window_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    window_end = (window_start + timedelta(days=8)).replace(
        hour=23, minute=59, second=59, microsecond=999999
    )

    # Fetch existing availability rows across the full window
    current_res = await (
        supabase.table("availability")
        .select("id, tee_time, holes")
        .eq("course_id", course["id"])
        .gte("tee_time", window_start.isoformat())
        .lte("tee_time", window_end.isoformat())
        .execute()
    )
    db_records = current_res.data or []
    db_map = {
        (datetime.fromisoformat(r["tee_time"]).astimezone(utc_tz).isoformat(), int(r["holes"])): r["id"]
        for r in db_records
    }

    upsert_rows = []
    scanned_keys = set()

    for entry in raw_tee_times:
        raw_date_str = entry.get("Date")
        raw_time_str = entry.get("Time")

        if entry.get("ReserveOnline") != 1:
            continue

        if not raw_time_str or not raw_date_str:
            continue

        try:
            combined_str = f"{raw_date_str}{raw_time_str}"
            dt_local = datetime.strptime(combined_str, "%Y%m%d%H%M")
            dt_local = dt_local.replace(tzinfo=local_tz)
        except (ValueError, IndexError):
            logger.warning(f"[EagleClub] Cannot parse time '{raw_time_str}' / '{raw_date_str}'")
            continue

        dt_utc = dt_local.astimezone(utc_tz)

        # Skip slots outside our window (shouldn't happen, but be safe)
        if dt_utc < window_start or dt_utc > window_end:
            continue

        # Pricing: sum base + carriage fee
        nine_total = float(entry.get("NineFee") or 0) + float(entry.get("CarriageNineFee") or 0)
        eighteen_total = float(entry.get("EighteenFee") or 0) + float(entry.get("CarriageEighteenFee") or 0)

        if nine_total <= 0 and eighteen_total <= 0:
            continue

        # Player count — try known field names; log unknowns on first encounter
        spots_available = _extract_spots(entry)

        available_options = []
        if nine_total > 0:
            available_options.append((9, nine_total))
        if eighteen_total > 0:
            available_options.append((18, eighteen_total))

        for holes, price in available_options:
            key = (dt_utc.isoformat(), holes)
            scanned_keys.add(key)
            upsert_rows.append({
                "course_id": course["id"],
                "tee_time": dt_utc.isoformat(),
                "price": price,
                "holes": holes,
                "available": True,
                "spots_available": spots_available,
            })

    # Deduplicate (same time/holes from multiple course sections)
    unique_upserts: Dict[Tuple, Dict] = {}
    for row in upsert_rows:
        key = (row["tee_time"], row["holes"])
        if key not in unique_upserts or row["price"] < unique_upserts[key]["price"]:
            unique_upserts[key] = row

    upsert_list = list(unique_upserts.values())

    # Diff: remove stale rows
    ids_to_remove = [
        db_id
        for (tk, hk), db_id in db_map.items()
        if (tk, hk) not in scanned_keys
    ]
    if ids_to_remove:
        print(f"[EagleClub] Removing {len(ids_to_remove)} stale tee times for {course['name']}")
        await (
            supabase.table("availability")
            .delete()
            .in_("id", ids_to_remove)
            .execute()
        )

    if upsert_list:
        await supabase.table("availability").upsert(
            upsert_list,
            on_conflict="course_id, tee_time, holes",
        ).execute()
        print(f"[EagleClub] Sync complete for {course['name']}. Stored {len(upsert_list)} slots.")
    else:
        print(f"[EagleClub] No bookable times found for {course['name']}.")


def _extract_spots(entry: Dict) -> Optional[int]:
    """
    Extract the available player/spot count from a raw EagleClub appointment.
    'Slots' is the confirmed field name (e.g. Slots=3 means 3 spots open).
    """
    val = entry.get("Slots")
    if val is not None:
        try:
            return int(val)
        except (TypeError, ValueError):
            pass
    return None


# ---------------------------------------------------------------------------
# Single-target worker
# ---------------------------------------------------------------------------
async def process_single_target(
    client: httpx.AsyncClient,
    course: Dict,
    sem: asyncio.Semaphore,
) -> bool:
    async with sem:
        try:
            supabase = await create_supabase()
            configs = await get_provider_configs(supabase, course["id"])
            raw = await fetch_eagleclub_times(client, course, configs)
            await normalize_and_store(course, raw)
            return True
        except Exception as e:
            logger.error(f"[EagleClub] Error scanning {course.get('name')}: {e}")
            return False


# ---------------------------------------------------------------------------
# Main scan entry point
# ---------------------------------------------------------------------------
async def run_eagleclub_scan() -> None:
    start_time = datetime.now()
    print(f"[EagleClub] Starting scan at {start_time.isoformat()}...")

    targets = await get_active_eagleclub_targets()

    if not targets:
        print("[EagleClub] No active alerts found.")
        return

    print(f"[EagleClub] Found {len(targets)} unique courses to scan.")

    sem = asyncio.Semaphore(5)
    async with httpx.AsyncClient() as client:
        tasks = [
            process_single_target(client, course, sem)
            for course in targets.values()
        ]
        results = await asyncio.gather(*tasks)

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    success_count = sum(1 for r in results if r)
    print(f"[EagleClub] Scan complete in {duration:.2f}s. Success: {success_count}/{len(targets)}")
