import json
import asyncio
from httpx import AsyncClient, Limits
from typing import List, Union, Dict, Optional
from datetime import datetime, timezone, timedelta
from dateutil import tz
from urllib.parse import urlencode

from app.config import settings
from app.db import create_supabase
from app.models.tee_time import TeeTime
from app.services import config_cache

# In-memory JWT cache keyed by ForeUp facility course_id (e.g. "19765").
# Only used for courses that have use_auth=true in their provider_configs.
# Stores (jwt, fetched_at) tuples so we can proactively refresh before expiry.
_JWT_TTL_SECONDS = 12 * 3600  # Refresh every 12 hours
_jwt_cache: Dict[str, tuple] = {}  # course_id -> (jwt, fetched_at datetime)


async def _login_foreup(foreup_course_id: str, login_booking_class_id: str = "50293") -> Optional[str]:
    """POST credentials to ForeUp and return a fresh JWT. Returns None on failure."""
    username = settings.FOREUP_USERNAME
    password = settings.FOREUP_PASSWORD
    if not username or not password:
        print("[ForeUp] Auth requested but FOREUP_USERNAME/FOREUP_PASSWORD not set in environment.")
        return None

    async with AsyncClient(
        headers={
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
            "x-requested-with": "XMLHttpRequest",
            "referer": f"https://foreupsoftware.com/index.php/booking/{foreup_course_id}/",
        },
        timeout=15.0,
    ) as client:
        resp = await client.post(
            "https://foreupsoftware.com/index.php/api/booking/users/login",
            data={
                "username": username,
                "password": password,
                "booking_class_id": login_booking_class_id,
                "api_key": "no_limits",
                "course_id": foreup_course_id,
            },
        )
        if not resp.is_success:
            print(f"[ForeUp] Login failed ({resp.status_code})")
            return None
        jwt = resp.json().get("jwt")
        if jwt:
            print(f"[ForeUp] Authenticated, JWT cached for course_id={foreup_course_id}")
            _jwt_cache[foreup_course_id] = (jwt, datetime.now(timezone.utc))
        return jwt


async def _get_auth_token(configs: dict) -> Optional[str]:
    """Return a cached JWT for this facility, re-logging in if the cache is empty.
    Returns None for courses that don't have use_auth=true."""
    if not configs.get("use_auth"):
        return None
    foreup_course_id = str(configs.get("course_id", ""))
    login_booking_class_id = str(configs.get("login_booking_class_id", "50293"))
    cached = _jwt_cache.get(foreup_course_id)
    if cached:
        jwt, fetched_at = cached
        age = (datetime.now(timezone.utc) - fetched_at).total_seconds()
        if age < _JWT_TTL_SECONDS:
            return jwt
        print(f"[ForeUp] JWT for course_id={foreup_course_id} is {age/3600:.1f}h old, refreshing...")
        _jwt_cache.pop(foreup_course_id, None)
    return await _login_foreup(foreup_course_id, login_booking_class_id)

async def get_active_foreup_targets():
    """ 
    Return a list of unique (course, date_str) tuples that need scanning 
    based on active alerts.
    """
    supabase = await create_supabase()
    
    # 1. Get all active, non-expired alerts
    cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    alerts_res = await (
        supabase.table("alerts")
        .select("date_from, date_to, courses!alerts_course_id_fkey!inner(id, name, provider, time_zone)")
        .eq("active", True)
        .eq("courses.provider", "ForeUp")
        .gte("date_to", cutoff)
        .execute()
    )
    
    targets = {} # {(course_id, date_str): course_obj}
    
    alerts = alerts_res.data or []
    for a in alerts:
        course = a.get("courses")
        if not course:
            continue
            
        # Parse date range
        try:
            # Simple handling: assume date_from is enough for now
            start_dt = datetime.fromisoformat(a["date_from"].replace("Z", "+00:00"))
            date_str = start_dt.strftime("%m-%d-%Y") # ForeUp format mm-dd-yyyy
            
            # Use tuple key to ensure uniqueness
            key = (course["id"], date_str)
            targets[key] = course
        except Exception as e:
            print(f"[ForeUp] Error parsing alert date {a}: {e}")
            continue

    return targets

async def get_provider_configs(supabase, course_id: int) -> dict:
    """ Fetch key/value pairs for provider configs """
    cached = config_cache.get(course_id)
    if cached is not None:
        return cached

    res = await (
        supabase.table("provider_configs")
        .select("key", "value")
        .eq("course_id", course_id)
        .execute()
    )

    cfg = {r['key']: r['value'] for r in res.data or []}

    for k, v in list(cfg.items()):
        if isinstance(v, str) and (v.startswith("[") or v.startswith("{")):
            try:
                cfg[k] = json.loads(v)
            except json.JSONDecodeError:
                pass

    config_cache.set(course_id, cfg)
    return cfg

async def fetch_foreup_times(course, configs: dict, date_str: str, holes: Union[str, int] = "all"):
    """ Construct the ForeUp request and return the data """
    base_url = (
        "https://foreupsoftware.com/index.php/api/booking/times"
    )
    params = {
        "time": "all",
        "date": date_str,
        "holes": str(holes) if holes != "all" else "all",
        "players": 0,
        "booking_class": configs.get("booking_class"),
        "schedule_id": configs.get("schedule_id"),
        "schedule_ids[]": configs.get("schedule_ids", []),
        "specials_only": 0,
        "api_key": configs.get("api_key", "no_limits")
    }

    full_url = f"{base_url}?{urlencode(params, doseq=True)}"
    print(f"[Fetch ForeUp Times] Fetching {course['name']} | holes={holes} | date={date_str}...")

    base_headers = {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        "accept": "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
        "x-fu-golfer-location": "foreup",
        "referer": f"https://foreupsoftware.com/index.php/booking/{configs.get('course_id', '')}/",
    }

    token = await _get_auth_token(configs)
    if token:
        base_headers["x-authorization"] = f"Bearer {token}"

    async with AsyncClient(headers=base_headers, timeout=30.0) as client:
        resp = await client.get(full_url)

        # If JWT expired, evict cache, re-login once, and retry
        if resp.status_code == 401 and configs.get("use_auth"):
            foreup_course_id = str(configs.get("course_id", ""))
            _jwt_cache.pop(foreup_course_id, None)
            fresh_token = await _login_foreup(foreup_course_id, str(configs.get("login_booking_class_id", "50293")))
            if fresh_token:
                resp = await client.get(full_url, headers={**base_headers, "x-authorization": f"Bearer {fresh_token}"})

        resp.raise_for_status()

    return resp.json()

async def normalize_and_store(course, raw_data, date_str: str, holes_requested: Union[str, int] = "all"):
    """ Convert ForeUp response to TeeTime objects and sync with Supabase availability """
    tee_times: List[TeeTime] = []
    supabase = await create_supabase()

    # Updated to use time_zone instead of timezone
    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()
    utc_tz = tz.tzutc()

    # 1. Calculate time range for the scanned day in UTC
    test_date = datetime.strptime(date_str, "%m-%d-%Y")
    start_of_day = test_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
    end_of_day = test_date.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=local_tz)
    
    start_utc = start_of_day.astimezone(utc_tz)
    end_utc = end_of_day.astimezone(utc_tz)

    # 2. Fetch current availability for this course/date to perform diffing
    # This identifies what we ALREADY HAVE so we don't clear everything
    current_res = await (
        supabase.table("availability")
        .select("id, tee_time, holes")
        .eq("course_id", course["id"])
        .gte("tee_time", start_utc.isoformat())
        .lte("tee_time", end_utc.isoformat())
        .execute()
    )
    db_records = current_res.data or []
    
    # Map existing records by (iso_time, holes) -> id
    # We use isoformat for stable string comparison
    db_map = {
        (datetime.fromisoformat(r['tee_time']).astimezone(utc_tz).isoformat(), int(r['holes'])): r['id']
        for r in db_records
    }

    scanned_keys = set()
    for item in raw_data:
        dt = None
        try:
            dt = datetime.fromisoformat(item["time"])
        except Exception:
            try:
                dt = datetime.strptime(item["time"], "%Y-%m-%dT%H:%M:%S")
            except Exception:
                print(f"Skipping invalid time: {item.get('time')}")
                continue
        
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo = local_tz)
        dt_utc = dt.astimezone(utc_tz)
        
        price = float(item.get("green_fee", 0) or 0)
        available = not item.get("booked") and not item.get("locked")
        raw_holes = str(item.get("holes", "")).strip()

        # Handle '9/18' by creating two separate tee time entries
        actual_holes_to_store = []
        if raw_holes == "9/18":
            actual_holes_to_store = [9, 18]
        else:
            try:
                actual_holes_to_store = [int(raw_holes)]
            except ValueError:
                actual_holes_to_store = [18]

        for num_holes in actual_holes_to_store:
            # Pick the holes-specific spots count when available, fall back to overall
            if num_holes == 9:
                spots = item.get("available_spots_9") or item.get("available_spots")
            elif num_holes == 18:
                spots = item.get("available_spots_18") or item.get("available_spots")
            else:
                spots = item.get("available_spots")
            try:
                spots_available = int(spots) if spots is not None else None
            except (TypeError, ValueError):
                spots_available = None

            # Track scanned keys for diffing
            scanned_keys.add((dt_utc.isoformat(), num_holes))

            tee_times.append(
                TeeTime(
                    course_id = course['id'],
                    tee_time = dt_utc,
                    price = price,
                    holes = num_holes,
                    available = available,
                    source = "ForeUp",
                    raw = item,
                    spots_available = spots_available,
                )
            )

    # 3. IDENTIFY RECORDS TO DELETE (Present in DB but missing from fresh scan)
    ids_to_remove = []
    removed_details = []
    for (tee_time_key, holes_key), db_id in db_map.items():
        if (tee_time_key, holes_key) not in scanned_keys:
            ids_to_remove.append(db_id)
            removed_details.append(f"{tee_time_key} ({holes_key}-hole)")

    if ids_to_remove:
        print(f"[ForeUp] Diff result: Removing {len(ids_to_remove)} stale tee times for {course['name']} on {date_str}:")
        for detail in removed_details:
            print(f"  - Removed: {detail}")
            
        # Batch delete by specific IDs
        # We use .in_ to delete only the specific missing records
        await (
            supabase.table("availability")
            .delete()
            .in_("id", ids_to_remove)
            .execute()
        )


    # 4. UPSERT fresh data (updates existing, adds new)
    if tee_times:
        payload = [t.to_dict() for t in tee_times]
        await supabase.table("availability").upsert(payload, on_conflict="course_id, tee_time, holes").execute()
    else:
        print(f"[ForeUp] No times found for {course['name']} on {date_str}.")
    
    print(f"Sync complete for {course['name']} on {date_str}.")


async def process_single_target(supabase, client, course, date_str, sem):
    """ Worker for concurrent scanning """
    async with sem:
        try:
            course_id = course["id"]
            cfgs = await get_provider_configs(supabase, course_id)
            data = await fetch_foreup_times(course, cfgs, date_str, "all")
            await normalize_and_store(course, data, date_str, "all")
            return True
        except Exception as e:
            print(f"[ForeUp] Error scanning {course.get('name')} for {date_str}: {e}")
            return False


async def run_foreup_scan():
    """
    Scans ForeUp courses for all dates requested in active alerts.
    Utilizes concurrency with rate limiting.
    """
    start_time = datetime.now()
    print(f"[ForeUp] Starting smart scan at {start_time.isoformat()}...")
    
    targets = await get_active_foreup_targets()
    
    if not targets:
        print("[ForeUp] No active alerts found.")
        return

    print(f"[ForeUp] Found {len(targets)} unique (course, date) pairs to scan.")
    
    supabase = await create_supabase()
    sem = asyncio.Semaphore(10) # Limit concurrency
    
    async with AsyncClient(
        headers={"User-Agent": "Mozilla/5.0"},
        limits=Limits(max_connections=20, max_keepalive_connections=10)
    ) as client:
        tasks = []
        for (course_id, date_str), course in targets.items():
            tasks.append(process_single_target(supabase, client, course, date_str, sem))
        
        results = await asyncio.gather(*tasks)
    
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    success_count = sum(1 for r in results if r)
    
    print(f"[ForeUp] Scan completed in {duration:.2f}s. Success: {success_count}/{len(targets)}")
