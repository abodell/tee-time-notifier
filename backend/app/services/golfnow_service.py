"""
golfnow_service.py — Tee-time scanning service for GolfNow courses.

Mirrors the structure of foreup_service.py:
  - get_active_golfnow_targets()  → discover (course_id, date_str) pairs from active alerts
  - fetch_golfnow_times()         → POST to GolfNow API
  - normalize_and_store()         → convert to UTC, diff, upsert to `availability`
  - run_golfnow_scan()            → entry point called by the scheduler job
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
GOLFNOW_API_URL = "https://www.golfnow.com/api/tee-times/tee-time-results"

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Referer": "https://www.golfnow.com/",
    "Origin": "https://www.golfnow.com",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_PLAYER_WORD_MAP = {"One": 1, "Two": 2, "Three": 3, "Four": 4}

def _player_rule_to_max(rule: str) -> Optional[int]:
    """Convert GolfNow playerRule string to max allowed players.

    Examples: "Two"→2, "OneTwo"→2, "OneTwoThreeFour"→4, "Any"→4
    Returns None if the rule string is empty or unrecognised.
    """
    if not rule:
        return None
    if rule == "Any":
        return 4
    max_p = 0
    for word, n in _PLAYER_WORD_MAP.items():
        if word in rule:
            max_p = max(max_p, n)
    return max_p if max_p > 0 else None


# ---------------------------------------------------------------------------
# Target discovery
# ---------------------------------------------------------------------------
async def get_active_golfnow_targets() -> Dict[Tuple[int, str], Dict]:
    """
    Return a map of {(course_id, date_str): course_obj} for every unique
    (GolfNow course, date) pair referenced by an active alert.

    date_str format: "Mon DD YYYY" e.g. "Feb 21 2026" — required by GolfNow API.
    """
    supabase = await create_supabase()

    alerts_res = await (
        supabase.table("alerts")
        .select("date_from, date_to, courses!alerts_course_id_fkey!inner(id, name, provider, time_zone)")
        .eq("active", True)
        .eq("courses.provider", "GolfNow")
        .execute()
    )

    targets: Dict[Tuple[int, str], Dict] = {}
    for alert in (alerts_res.data or []):
        course = alert.get("courses")
        if not course:
            continue
        try:
            start_dt = datetime.fromisoformat(alert["date_from"].replace("Z", "+00:00"))
            # GolfNow API expects e.g. "Feb 21 2026"
            date_str = start_dt.strftime("%b %d %Y")
            key = (course["id"], date_str)
            targets[key] = course
        except Exception as e:
            logger.error(f"[GolfNow] Error parsing alert date {alert}: {e}")
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
async def fetch_golfnow_times(
    client: httpx.AsyncClient,
    course: Dict,
    configs: Dict,
    date_str: str,
) -> List[Dict]:
    """
    POST to GolfNow tee-time API for the given facility on date_str.
    Returns the raw list of tee-time dicts (may be empty).
    """
    facility_id_raw = configs.get("facility_id")
    if not facility_id_raw:
        logger.error(f"[GolfNow] No facility_id config for course {course.get('name')}")
        return []

    try:
        facility_id = int(facility_id_raw)
    except ValueError:
        logger.error(f"[GolfNow] Invalid facility_id '{facility_id_raw}' for {course.get('name')}")
        return []

    payload = {
        "PageSize": 1000,
        "PageNumber": 0,
        "SearchType": 1,           # Search by FacilityId
        "SortBy": "Date",
        "SortDirection": 0,
        "Date": date_str,
        "Players": "0",
        "TimePeriod": "3",
        "FacilityType": "0",
        "RateType": "all",
        "TimeMin": "0",
        "TimeMax": "48",
        "FacilityId": facility_id,
        "SortByRollup": "Date.MinDate",
        "View": "Grouping",
        "TeeTimeCount": 1000,
    }

    print(f"[Fetch GolfNow Times] Fetching {course['name']} | facility={facility_id} | date={date_str}...")

    try:
        resp = await client.post(
            GOLFNOW_API_URL,
            json=payload,
            headers=REQUEST_HEADERS,
            timeout=15.0,
        )
        resp.raise_for_status()
        body = resp.json()
        tee_times = (body.get("ttResults") or {}).get("teeTimes") or []
        return tee_times
    except Exception as e:
        print(f"[GolfNow] Fetch error for {course['name']} on {date_str}: {e}")
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
    Convert raw GolfNow tee-time entries to UTC, diff against DB, upsert.

    GolfNow `time` field is a local ISO datetime string, e.g. "2026-02-21T09:50:00".
    We treat it as naive local time and convert using the course's IANA time_zone.
    """
    supabase = await create_supabase()

    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()
    utc_tz = tz.tzutc()

    # Parse the scan date for window calculation
    # date_str is like "Feb 21 2026"
    try:
        scan_date = datetime.strptime(date_str, "%b %d %Y")
    except ValueError:
        logger.error(f"[GolfNow] Cannot parse date_str '{date_str}'")
        return

    start_of_day = scan_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
    end_of_day = scan_date.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=local_tz)
    start_utc = start_of_day.astimezone(utc_tz)
    end_utc = end_of_day.astimezone(utc_tz)

    # Fetch existing availability rows for this course/date window
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

    # Build fresh tee-time records
    upsert_rows = []
    scanned_keys = set()

    for entry in raw_tee_times:
        raw_time = entry.get("time")
        if not raw_time:
            continue

        try:
            dt_naive = datetime.fromisoformat(raw_time)
        except ValueError:
            logger.warning(f"[GolfNow] Cannot parse time '{raw_time}'")
            continue

        if dt_naive.tzinfo is None:
            dt_local = dt_naive.replace(tzinfo=local_tz)
        else:
            dt_local = dt_naive

        dt_utc = dt_local.astimezone(utc_tz)

        # Use the lowest rate from teeTimeRates (minTeeTimeRate field on entry)
        price_raw = entry.get("minTeeTimeRate", 0) or 0
        try:
            price = float(price_raw)
        except (ValueError, TypeError):
            price = 0.0

        # GolfNow doesn't separate 9/18 at the tee-time level in a simple flag;
        # we check teeTimeRates for holeCount
        hole_counts_seen = set()
        for rate in (entry.get("teeTimeRates") or []):
            hc = rate.get("holeCount")
            if hc:
                hole_counts_seen.add(int(hc))

        if not hole_counts_seen:
            hole_counts_seen = {18}  # default to 18

        # Parse playerRule CamelCase string into max allowed players.
        # e.g. "Two"→2, "OneTwo"→2, "OneTwoThreeFour"→4, "Any"→4
        player_rule = entry.get("playerRule") or ""
        spots_available = _player_rule_to_max(player_rule)

        for holes in hole_counts_seen:
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

    # Diff: remove stale rows no longer returned by the API
    ids_to_remove = [
        db_id
        for (tk, hk), db_id in db_map.items()
        if (tk, hk) not in scanned_keys
    ]
    if ids_to_remove:
        print(
            f"[GolfNow] Diff result: Removing {len(ids_to_remove)} stale tee times "
            f"for {course['name']} on {date_str}"
        )
        await (
            supabase.table("availability")
            .delete()
            .in_("id", ids_to_remove)
            .execute()
        )

    # Upsert fresh data
    if upsert_rows:
        await supabase.table("availability").upsert(
            upsert_rows,
            on_conflict="course_id, tee_time, holes",
        ).execute()
        print(f"Sync complete for {course['name']} on {date_str}. Found {len(upsert_rows)} available times.")
    else:
        print(f"[GolfNow] No times found for {course['name']} on {date_str}.")


# ---------------------------------------------------------------------------
# Single-target worker
# ---------------------------------------------------------------------------
async def process_single_target(
    client: httpx.AsyncClient,
    course: Dict,
    date_str: str,
    sem: asyncio.Semaphore,
) -> bool:
    """Worker used by run_golfnow_scan for concurrent processing."""
    async with sem:
        try:
            supabase = await create_supabase()
            configs = await get_provider_configs(supabase, course["id"])
            raw = await fetch_golfnow_times(client, course, configs, date_str)
            await normalize_and_store(course, raw, date_str)
            return True
        except Exception as e:
            logger.error(
                f"[GolfNow] Error scanning {course.get('name')} for {date_str}: {e}"
            )
            return False


# ---------------------------------------------------------------------------
# Main scan entry point
# ---------------------------------------------------------------------------
async def run_golfnow_scan() -> None:
    """
    Scan all GolfNow courses referenced by active alerts.
    Called by the scheduler job every 45 seconds.
    """
    start_time = datetime.now()
    print(f"[GolfNow] Starting scan at {start_time.isoformat()}...")

    targets = await get_active_golfnow_targets()

    if not targets:
        print("[GolfNow] No active alerts found.")
        return

    print(f"[GolfNow] Found {len(targets)} unique (course, date) pairs to scan.")

    sem = asyncio.Semaphore(10)
    proxy_url = os.getenv("GOLFNOW_PROXY")

    async with httpx.AsyncClient(proxy=proxy_url, verify=False) as client:
        tasks = [
            process_single_target(client, course, date_str, sem)
            for (_, date_str), course in targets.items()
        ]
        results = await asyncio.gather(*tasks)

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    success_count = sum(1 for r in results if r)
    print(
        f"[GolfNow] Scan complete in {duration:.2f}s. "
        f"Success: {success_count}/{len(targets)}"
    )
