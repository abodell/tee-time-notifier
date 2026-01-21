import json
import asyncio
from httpx import AsyncClient, Limits
from typing import List, Union, Dict, Optional
from datetime import datetime
from dateutil import tz
from urllib.parse import urlencode

from app.db import create_supabase
from app.models.tee_time import TeeTime

async def get_active_foreup_targets():
    """ 
    Return a list of unique (course, date_str) tuples that need scanning 
    based on active alerts.
    """
    supabase = await create_supabase()
    
    # 1. Get all active alerts
    alerts_res = await (
        supabase.table("alerts")
        .select("date_from, date_to, courses!alerts_course_id_fkey(id, name, provider, time_zone)")
        .eq("active", True)
        .eq("courses.provider", "ForeUp")
        .execute()
    )
    
    targets = {} # {(course_id, date_str): course_obj}
    
    alerts = alerts_res.data or []
    for a in alerts:
        course = a["courses"]
        # Parse date range
        try:
            # Simple handling: assume date_from is enough for now
            start_dt = datetime.fromisoformat(a["date_from"].replace("Z", "+00:00"))
            date_str = start_dt.strftime("%m-%d-%Y") # ForeUp format mm-dd-yyyy
            
            # Use tuple key to ensure uniqueness
            key = (course["id"], date_str)
            targets[key] = course
        except Exception as e:
            print(f"Error parsing alert date {a}: {e}")
            continue

    return targets

async def get_provider_configs(supabase, course_id: int) -> dict:
    """ Fetch key/value pairs for provider configs """
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
    async with AsyncClient(headers={"User-Agent": "Mozilla/5.0"}) as client:
        resp = await client.get(full_url)
        resp.raise_for_status()

    return resp.json()

async def normalize_and_store(course, raw_data, date_str: str, holes_requested: Union[str, int] = "all"):
    """ Convert ForeUp response to TeeTime objects and insert into Supabase """
    tee_times: List[TeeTime] = []
    supabase = await create_supabase()

    # Updated to use time_zone instead of timezone
    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()
    utc_tz = tz.tzutc()

    # 1. Calculate time range for deletion (start/end of the scanned day in local TZ)
    try:
        # date_str is MM-DD-YYYY
        local_date = datetime.strptime(date_str, "%m-%d-%Y")
        start_of_day = local_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
        end_of_day = local_date.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=local_tz)
        
        start_utc = start_of_day.astimezone(utc_tz).isoformat()
        end_utc = end_of_day.astimezone(utc_tz).isoformat()
        
        # 2. Delete existing records for this course and date range before upserting
        # This removes any times that disappeared from the provider (booked/removed)
        print(f"[ForeUp] Purging old availability for {course['name']} between {start_utc} and {end_utc}...")
        await (
            supabase.table("availability")
            .delete()
            .eq("course_id", course["id"])
            .gte("tee_time", start_utc)
            .lte("tee_time", end_utc)
            .execute()
        )
    except Exception as e:
        print(f"[ForeUp] Warning: Could not perform targeted deletion for {course['name']} on {date_str}: {e}")

    for item in raw_data:
        dt = None
        try:
            dt = datetime.fromisoformat(item["time"])
        except Exception:
            try:
                dt = datetime.strptime(item["time"], "%Y-%m-%dT%H:%M:%S")
            except Exception:
                print(f"Skipping invalid time: {item.get('time')}")
        
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
            tee_times.append(
                TeeTime(
                    course_id = course['id'],
                    tee_time = dt_utc,
                    price = price,
                    holes = num_holes,
                    available = available,
                    source = "ForeUp",
                    raw = item,
                )
            )

    if tee_times:
        payload = [t.to_dict() for t in tee_times]
        await supabase.table("availability").upsert(payload, on_conflict="course_id, tee_time, holes").execute()
    else:
        print(f"[ForeUp] No times to store for {course['name']} on {date_str}.")
    print("Updated availability table...")

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
