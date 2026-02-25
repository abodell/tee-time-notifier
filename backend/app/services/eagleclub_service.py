"""
eagleclub_service.py — Tee-time scanning service for EagleClubSystems courses.
"""

import asyncio
import logging
import os
from datetime import datetime
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
# Target discovery
# ---------------------------------------------------------------------------
async def get_active_eagleclub_targets() -> Dict[Tuple[int, str], Dict]:
    """
    Return a map of {(course_id, date_str): course_obj} for every unique
    (EagleClub course, date) pair referenced by an active alert.

    date_str format: "YYYYMMDD" e.g. "20260226" — required by EagleClub API.
    """
    supabase = await create_supabase()

    alerts_res = await (
        supabase.table("alerts")
        .select("date_from, date_to, courses!alerts_course_id_fkey!inner(id, name, provider, time_zone)")
        .eq("active", True)
        .eq("courses.provider", "EagleClub")
        .execute()
    )

    targets: Dict[Tuple[int, str], Dict] = {}
    for alert in (alerts_res.data or []):
        course = alert.get("courses")
        if not course:
            continue
        try:
            start_dt = datetime.fromisoformat(alert["date_from"].replace("Z", "+00:00"))
            # EagleClub API expects e.g. "20260226"
            date_str = start_dt.strftime("%Y%m%d")
            key = (course["id"], date_str)
            targets[key] = course
        except Exception as e:
            logger.error(f"[EagleClub] Error parsing alert date {alert}: {e}")
            continue

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
# API fetch
# ---------------------------------------------------------------------------
async def fetch_eagleclub_times(
    client: httpx.AsyncClient,
    course: Dict,
    configs: Dict,
    date_str: str,
) -> List[Dict]:
    """
    POST to EagleClub systems API for the given course on date_str.
    """
    dbname = configs.get("dbname")
    org_id = int(configs.get("org_id", 1))
    operator_id = int(configs.get("operator_id", 2))
    price_class_id = int(configs.get("price_class_id", 85))
    carriage_id = int(configs.get("carriage_id", 95))

    if not dbname:
        logger.error(f"[EagleClub] No dbname config for course {course.get('name')}")
        return []

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
            "Version": "1.260220.0",
            "FromProgram": "BE"
        },
        "StrDate": date_str,
        "StrTime": "0000",
        "TeePriceClassID": price_class_id,
        "IncludeExisting": False,
        "Master_CarriageID": carriage_id,
        "Master_TeePriceClassIDs": f",{price_class_id},",
        "OnlineBookingFormat": 0,
        "OnlineBookingMaxDays": 7
    }

    print(f"[Fetch EagleClub Times] Fetching {course['name']} | db={dbname} | date={date_str}...")

    try:
        resp = await client.post(
            EAGLECLUB_API_URL,
            json=payload,
            headers=REQUEST_HEADERS,
            timeout=15.0,
        )
        resp.raise_for_status()
        body = resp.json()
        
        # Check for success
        bg = body.get("BG", {})
        if not bg.get("BoolSuccess", False) and bg.get("StrExceptions"):
            logger.error(f"[EagleClub] API Error for {course['name']}: {bg.get('StrExceptions')}")
            return []

        tee_times = body.get("LstAppointment") or []
        return tee_times
    except Exception as e:
        print(f"[EagleClub] Fetch error for {course['name']} on {date_str}: {e}")
        return []

# ---------------------------------------------------------------------------
# Normalize & store
# ---------------------------------------------------------------------------
async def normalize_and_store(
    course: Dict,
    raw_tee_times: List[Dict],
    date_str: str,
) -> None:
    """
    Convert raw EagleClub tee-time entries to UTC, diff against DB, upsert.
    """
    supabase = await create_supabase()

    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()
    utc_tz = tz.tzutc()

    # Parse the scan date (YYYYMMDD)
    try:
        scan_date = datetime.strptime(date_str, "%Y%m%d")
    except ValueError:
        logger.error(f"[EagleClub] Cannot parse date_str '{date_str}'")
        return

    start_of_day = scan_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
    end_of_day = scan_date.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=local_tz)
    start_utc = start_of_day.astimezone(utc_tz)
    end_utc = end_of_day.astimezone(utc_tz)

    # Fetch existing availability rows
    current_res = await (
        supabase.table("availability")
        .select("id, tee_time, holes")
        .eq("course_id", course["id"])
        .gte("tee_time", start_utc.isoformat())
        .lte("tee_time", end_utc.isoformat())
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
        # EagleClub response has "Date" (YYYYMMDD) and "Time" (HHMM)
        raw_date_str = entry.get("Date")
        raw_time_str = entry.get("Time")
        
        # Filter out slots that are not available for online booking
        if entry.get("ReserveOnline") != 1:
            continue
        
        if not raw_time_str or not raw_date_str:
            continue

        try:
            # Date is "YYYYMMDD", Time is "HHMM"
            combined_str = f"{raw_date_str}{raw_time_str}"
            dt_local = datetime.strptime(combined_str, "%Y%m%d%H%M")
            dt_local = dt_local.replace(tzinfo=local_tz)
        except (ValueError, IndexError):
            logger.warning(f"[EagleClub] Cannot parse time '{raw_time_str}' / '{raw_date_str}'")
            continue

        dt_utc = dt_local.astimezone(utc_tz)

        # Handle 9/18 pricing and availability
        # Users often want 18, but Bedford/Valleywood might only offer 9.
        nine_fee = float(entry.get("NineFee") or 0)
        eighteen_fee = float(entry.get("EighteenFee") or 0)

        # If both fees are 0, it might be unavailable or just not populated
        if nine_fee <= 0 and eighteen_fee <= 0:
            continue

        # We store separate rows for 9 and 18 if both are available
        available_options = []
        if nine_fee > 0:
            available_options.append((9, nine_fee))
        if eighteen_fee > 0:
            available_options.append((18, eighteen_fee))

        for holes, price in available_options:
            key = (dt_utc.isoformat(), holes)
            scanned_keys.add(key)
            upsert_rows.append({
                "course_id": course["id"],
                "tee_time": dt_utc.isoformat(),
                "price": price,
                "holes": holes,
                "available": True
            })

    # Deduplicate upsert_rows to avoid Postgres "ON CONFLICT" errors
    # If multiple sections offer the same time, we keep the one seen first (or could keep lowest price)
    unique_upserts = {}
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
        print(f"[EagleClub] Removing {len(ids_to_remove)} stale tee times for {course['name']} on {date_str}")
        await (
            supabase.table("availability")
            .delete()
            .in_("id", ids_to_remove)
            .execute()
        )

    # Upsert fresh data
    if upsert_list:
        await supabase.table("availability").upsert(
            upsert_list,
            on_conflict="course_id, tee_time, holes",
        ).execute()
        print(f"Sync complete for {course['name']} on {date_str}. Found {len(upsert_list)} slots.")
    else:
        print(f"[EagleClub] No times found for {course['name']} on {date_str}.")

# ---------------------------------------------------------------------------
# Single-target worker
# ---------------------------------------------------------------------------
async def process_single_target(
    client: httpx.AsyncClient,
    course: Dict,
    date_str: str,
    sem: asyncio.Semaphore,
) -> bool:
    async with sem:
        try:
            supabase = await create_supabase()
            configs = await get_provider_configs(supabase, course["id"])
            raw = await fetch_eagleclub_times(client, course, configs, date_str)
            await normalize_and_store(course, raw, date_str)
            return True
        except Exception as e:
            logger.error(f"[EagleClub] Error scanning {course.get('name')} for {date_str}: {e}")
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

    print(f"[EagleClub] Found {len(targets)} unique (course, date) pairs to scan.")

    sem = asyncio.Semaphore(10)
    async with httpx.AsyncClient() as client:
        tasks = [
            process_single_target(client, course, date_str, sem)
            for (_, date_str), course in targets.items()
        ]
        results = await asyncio.gather(*tasks)

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    success_count = sum(1 for r in results if r)
    print(f"[EagleClub] Scan complete in {duration:.2f}s. Success: {success_count}/{len(targets)}")
