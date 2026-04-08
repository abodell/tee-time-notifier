import asyncio
from httpx import AsyncClient, Limits
from typing import List, Dict
from datetime import datetime, timezone, timedelta
from dateutil import tz

from app.db import create_supabase
from app.models.tee_time import TeeTime
from app.services import config_cache

TEEITUP_API_BASE = "https://phx-api-be-east-1b.kenna.io"


async def get_active_teeitup_targets():
    """
    Return a list of unique (course, date_str) tuples that need scanning
    based on active alerts for TeeItUp courses.
    """
    supabase = await create_supabase()

    cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    alerts_res = await (
        supabase.table("alerts")
        .select("date_from, date_to, courses!alerts_course_id_fkey!inner(id, name, provider, time_zone)")
        .eq("active", True)
        .eq("courses.provider", "TeeItUp")
        .gte("date_to", cutoff)
        .execute()
    )

    targets = {}  # {(course_id, date_str): course_obj}

    for a in alerts_res.data or []:
        course = a.get("courses")
        if not course:
            continue
        try:
            start_dt = datetime.fromisoformat(a["date_from"].replace("Z", "+00:00"))
            date_str = start_dt.strftime("%Y-%m-%d")  # TeeItUp format: YYYY-MM-DD
            key = (course["id"], date_str)
            targets[key] = course
        except Exception as e:
            print(f"[TeeItUp] Error parsing alert date {a}: {e}")

    return targets


async def get_provider_configs(supabase, course_id: int) -> dict:
    """Fetch key/value pairs for provider configs."""
    cached = config_cache.get(course_id)
    if cached is not None:
        return cached

    res = await (
        supabase.table("provider_configs")
        .select("key", "value")
        .eq("course_id", course_id)
        .execute()
    )
    cfg = {r["key"]: r["value"] for r in res.data or []}
    config_cache.set(course_id, cfg)
    return cfg


async def fetch_teeitup_times(course, configs: dict, date_str: str) -> list:
    """
    Fetch tee times from the TeeItUp/Kenna API.

    Required configs:
      - facility_id: the course ID from the booking URL (?course=XXXX)
      - be_alias: the subdomain from the booking URL ({alias}.book.teeitup.com)
    """
    facility_id = configs.get("facility_id")
    be_alias = configs.get("be_alias")

    if not facility_id or not be_alias:
        print(f"[TeeItUp] Missing facility_id or be_alias for {course['name']}")
        return []

    url = f"{TEEITUP_API_BASE}/v2/tee-times"
    params = f"date={date_str}&facilityIds={facility_id}"
    full_url = f"{url}?{params}"

    headers = {
        "Accept": "application/json, text/plain, */*",
        "x-be-alias": be_alias,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    }

    print(f"[TeeItUp] Fetching {course['name']} | date={date_str}...")

    async with AsyncClient(headers=headers, timeout=30.0) as client:
        resp = await client.get(full_url)
        resp.raise_for_status()

    return resp.json()


async def normalize_and_store(course, raw_data: list, date_str: str):
    """
    Convert TeeItUp response to TeeTime objects and sync with Supabase availability.

    Response format: list of day objects, each with:
      - teetimes: list of tee time slots
        - teetime: UTC ISO timestamp
        - rates: list of rate options (holes, greenFeeCart/greenFeeWalking, allowedPlayers)
        - bookedPlayers: int
        - maxPlayers: int
    """
    supabase = await create_supabase()
    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()
    utc_tz = tz.tzutc()

    # Build UTC day range for diffing
    test_date = datetime.strptime(date_str, "%Y-%m-%d")
    start_of_day = test_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
    end_of_day = test_date.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=local_tz)
    start_utc = start_of_day.astimezone(utc_tz)
    end_utc = end_of_day.astimezone(utc_tz)

    # Fetch existing DB records to diff against
    current_res = await (
        supabase.table("availability")
        .select("id, tee_time, holes")
        .eq("course_id", course["id"])
        .gte("tee_time", start_utc.isoformat())
        .lte("tee_time", end_utc.isoformat())
        .execute()
    )
    db_map = {
        (datetime.fromisoformat(r["tee_time"]).astimezone(utc_tz).isoformat(), int(r["holes"])): r["id"]
        for r in current_res.data or []
    }

    scanned_keys = set()
    tee_times: List[TeeTime] = []

    for day_obj in raw_data:
        for slot in day_obj.get("teetimes", []):
            # Parse teetime — already UTC from the API
            raw_time = slot.get("teetime", "")
            try:
                dt = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
            except Exception:
                print(f"[TeeItUp] Skipping invalid time: {raw_time}")
                continue

            dt_utc = dt.astimezone(utc_tz)
            spots_available = slot.get("maxPlayers", 4) - slot.get("bookedPlayers", 0)

            # Group rates by holes count, pick lowest price per holes type
            # greenFeeCart and greenFeeWalking are in cents
            holes_prices: Dict[int, float] = {}
            for rate in slot.get("rates", []):
                holes = rate.get("holes")
                if not holes:
                    continue
                # Prefer the lower of riding/walking prices
                cart_cents = rate.get("greenFeeCart") or rate.get("dueOnlineRiding") or 0
                walk_cents = rate.get("greenFeeWalking") or rate.get("dueOnlineWalking") or 0
                # Use whichever non-zero price is available (cart if present, else walk)
                price_cents = cart_cents if cart_cents else walk_cents
                price = price_cents / 100.0

                existing = holes_prices.get(holes)
                if existing is None or price < existing:
                    holes_prices[holes] = price

            if not holes_prices:
                # No valid rates — skip slot
                continue

            for num_holes, price in holes_prices.items():
                key = (dt_utc.isoformat(), num_holes)
                scanned_keys.add(key)
                tee_times.append(
                    TeeTime(
                        course_id=course["id"],
                        tee_time=dt_utc,
                        price=price,
                        holes=num_holes,
                        available=True,
                        source="TeeItUp",
                        raw=slot,
                        spots_available=spots_available,
                    )
                )

    # Remove stale DB records
    ids_to_remove = [
        db_id for (key, db_id) in db_map.items() if key not in scanned_keys
    ]
    if ids_to_remove:
        print(f"[TeeItUp] Removing {len(ids_to_remove)} stale records for {course['name']} on {date_str}")
        await supabase.table("availability").delete().in_("id", ids_to_remove).execute()

    # Upsert fresh data
    if tee_times:
        payload = [t.to_dict() for t in tee_times]
        await supabase.table("availability").upsert(payload, on_conflict="course_id, tee_time, holes").execute()
        print(f"[TeeItUp] Upserted {len(tee_times)} tee times for {course['name']} on {date_str}")
    else:
        print(f"[TeeItUp] No tee times found for {course['name']} on {date_str}")


async def process_single_target(supabase, course, date_str, sem):
    """Worker for concurrent scanning."""
    async with sem:
        try:
            configs = await get_provider_configs(supabase, course["id"])
            data = await fetch_teeitup_times(course, configs, date_str)
            await normalize_and_store(course, data, date_str)
            return True
        except Exception as e:
            print(f"[TeeItUp] Error scanning {course.get('name')} for {date_str}: {e}")
            return False


async def run_teeitup_scan():
    """
    Scans TeeItUp courses for all dates in active alerts.
    """
    start_time = datetime.now()
    print(f"[TeeItUp] Starting scan at {start_time.isoformat()}...")

    targets = await get_active_teeitup_targets()

    if not targets:
        print("[TeeItUp] No active alerts found.")
        return

    print(f"[TeeItUp] Found {len(targets)} unique (course, date) pairs to scan.")

    supabase = await create_supabase()
    sem = asyncio.Semaphore(10)

    tasks = [
        process_single_target(supabase, course, date_str, sem)
        for (_, date_str), course in targets.items()
    ]
    results = await asyncio.gather(*tasks)

    duration = (datetime.now() - start_time).total_seconds()
    success_count = sum(1 for r in results if r)
    print(f"[TeeItUp] Scan completed in {duration:.2f}s. Success: {success_count}/{len(targets)}")
