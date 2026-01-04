import json
import requests
from httpx import AsyncClient
from typing import List, Union
from datetime import datetime
from dateutil import tz
from urllib.parse import urlencode

from app.db import create_supabase
from app.models.tee_time import TeeTime

http_client = AsyncClient()

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

async def get_provider_configs(course_id: int) -> dict:
    """ Fetch key/value pairs for provider configs """
    supabase = await create_supabase()
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
    resp = await http_client.get(full_url, timeout = 10)
    resp.raise_for_status()

    return resp.json()

async def normalize_and_store(course, raw_data, holes_requested: Union[str, int] = "all"):
    """ Convert ForeUp response to TeeTime objects and insert into Supabase """
    tee_times: List[TeeTime] = []
    supabase = await create_supabase()

    # Updated to use time_zone instead of timezone
    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()
    utc_tz = tz.tzutc()

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

        if raw_holes == "9/18":
            if holes_requested == 9:
                normalized_holes = 9
            elif holes_requested == 18:
                normalized_holes = 18
            else:
                normalized_holes = 18
        else:
            try:
                normalized_holes = int(raw_holes)
            except ValueError:
                normalized_holes = 18

        tee_times.append(
            TeeTime(
                course_id = course['id'],
                tee_time = dt_utc,
                price = price,
                holes = normalized_holes,
                available = available,
                source = "ForeUp",
                raw = item,
            )
        )

    if tee_times:
        payload = [t.to_dict() for t in tee_times]
        await supabase.table("availability").upsert(payload, on_conflict="course_id, tee_time, holes").execute()
    print("Inserted to availability table...")

async def run_foreup_scan():
    """
    Scans ForeUp courses for all dates requested in active alerts.
    """
    print("[ForeUp] Starting smart scan...")
    targets = await get_active_foreup_targets()
    
    if not targets:
        print("[ForeUp] No active alerts found.")
        return

    print(f"[ForeUp] Found {len(targets)} unique (course, date) pairs to scan.")
    
    for (course_id, date_str), course in targets.items():
        try:
            cfgs = await get_provider_configs(course_id)
            # ForeUp API requires explicit date format
            data = await fetch_foreup_times(course, cfgs, date_str, "all")
            await normalize_and_store(course, data, "all")
        except Exception as e:
            print(f"Error scanning {course['name']} for {date_str}: {e}")
