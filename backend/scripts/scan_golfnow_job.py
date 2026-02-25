import asyncio
import logging
import os
import sys
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import httpx
from dateutil import tz
from dotenv import load_dotenv

# Add parent directory to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from app.db import create_supabase

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scan_golfnow_job")

# Constants
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

async def get_active_golfnow_targets(supabase) -> Dict[Tuple[int, str], Dict]:
    """
    Return a map of {(course_id, date_str): course_obj} for every unique
    (GolfNow course, date) pair referenced by an active alert.
    """
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
            date_str = start_dt.strftime("%b %d %Y")
            key = (course["id"], date_str)
            targets[key] = course
        except Exception as e:
            logger.error(f"[GolfNow] Error parsing alert date {alert}: {e}")
            continue

    return targets

async def get_provider_configs(supabase, course_id: int) -> Dict[str, str]:
    """Fetch key/value provider configs for a course."""
    res = await (
        supabase.table("provider_configs")
        .select("key", "value")
        .eq("course_id", course_id)
        .execute()
    )
    return {r["key"]: r["value"] for r in (res.data or [])}

async def fetch_golfnow_times(
    client: httpx.AsyncClient,
    course: Dict,
    configs: Dict,
    date_str: str,
) -> List[Dict]:
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
        "SearchType": 1,
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

    logger.info(f"[Fetch] {course['name']} | facility={facility_id} | date={date_str}...")

    try:
        resp = await client.post(
            GOLFNOW_API_URL,
            json=payload,
            headers=REQUEST_HEADERS,
            timeout=20.0,
        )
        resp.raise_for_status()
        body = resp.json()
        tee_times = (body.get("ttResults") or {}).get("teeTimes") or []
        return tee_times
    except Exception as e:
        logger.error(f"[GolfNow] Fetch error for {course['name']} on {date_str}: {e}")
        return []

async def normalize_and_store(
    supabase,
    course: Dict,
    raw_tee_times: List[Dict],
    date_str: str,
) -> None:
    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()
    utc_tz = tz.tzutc()

    try:
        scan_date = datetime.strptime(date_str, "%b %d %Y")
    except ValueError:
        logger.error(f"[GolfNow] Cannot parse date_str '{date_str}'")
        return

    start_of_day = scan_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
    end_of_day = scan_date.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=local_tz)
    start_utc = start_of_day.astimezone(utc_tz)
    end_utc = end_of_day.astimezone(utc_tz)

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
        raw_time = entry.get("time")
        if not raw_time:
            continue

        try:
            dt_naive = datetime.fromisoformat(raw_time)
            dt_local = dt_naive.replace(tzinfo=local_tz) if dt_naive.tzinfo is None else dt_naive
            dt_utc = dt_local.astimezone(utc_tz)
        except ValueError:
            continue

        price_raw = entry.get("minTeeTimeRate", 0) or 0
        price = float(price_raw)

        hole_counts_seen = set()
        for rate in (entry.get("teeTimeRates") or []):
            hc = rate.get("holeCount")
            if hc:
                hole_counts_seen.add(int(hc))

        if not hole_counts_seen:
            hole_counts_seen = {18}

        for holes in hole_counts_seen:
            key = (dt_utc.isoformat(), holes)
            scanned_keys.add(key)
            upsert_rows.append({
                "course_id": course["id"],
                "tee_time": dt_utc.isoformat(),
                "price": price,
                "holes": holes,
                "available": True
            })

    ids_to_remove = [
        db_id
        for (tk, hk), db_id in db_map.items()
        if (tk, hk) not in scanned_keys
    ]
    if ids_to_remove:
        await (
            supabase.table("availability")
            .delete()
            .in_("id", ids_to_remove)
            .execute()
        )

    if upsert_rows:
        await supabase.table("availability").upsert(
            upsert_rows,
            on_conflict="course_id, tee_time, holes",
        ).execute()
        logger.info(f"Sync complete for {course['name']} on {date_str}. Found {len(upsert_rows)} times.")
    else:
        logger.info(f"No times found for {course['name']} on {date_str}.")

async def process_single_target(
    supabase,
    client: httpx.AsyncClient,
    course: Dict,
    date_str: str,
    sem: asyncio.Semaphore,
) -> bool:
    async with sem:
        try:
            configs = await get_provider_configs(supabase, course["id"])
            raw = await fetch_golfnow_times(client, course, configs, date_str)
            await normalize_and_store(supabase, course, raw, date_str)
            return True
        except Exception as e:
            logger.error(f"Error scanning {course.get('name')} for {date_str}: {e}")
            return False

async def main():
    start_time = datetime.now()
    logger.info(f"Starting GolfNow GitHub Action scan at {start_time.isoformat()}...")

    supabase = await create_supabase()
    targets = await get_active_golfnow_targets(supabase)

    if not targets:
        logger.info("No active GolfNow alerts found.")
        return

    logger.info(f"Found {len(targets)} unique (course, date) pairs to scan.")

    sem = asyncio.Semaphore(5) # Lower concurrency for safety in GH Actions
    
    async with httpx.AsyncClient(verify=True) as client: # Verifying SSL in GH Actions
        tasks = [
            process_single_target(supabase, client, course, date_str, sem)
            for (_, date_str), course in targets.items()
        ]
        results = await asyncio.gather(*tasks)

    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    success_count = sum(1 for r in results if r)
    logger.info(f"Scan complete in {duration:.2f}s. Success: {success_count}/{len(targets)}")

if __name__ == "__main__":
    asyncio.run(main())
