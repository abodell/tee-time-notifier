import json
import asyncio
from httpx import AsyncClient, Limits
from typing import List, Union, Dict, Optional
from datetime import datetime
from dateutil import tz
from urllib.parse import urlencode

from app.db import create_supabase
from app.models.tee_time import TeeTime

async def get_active_chronogolf_targets():
    """ 
    Return a list of unique (course, date_str) tuples that need scanning 
    based on active alerts.
    """
    supabase = await create_supabase()
    
    # 1. Get all active alerts for ChronoGolf courses
    alerts_res = await (
        supabase.table("alerts")
        .select("date_from, date_to, courses!alerts_course_id_fkey!inner(id, name, provider, time_zone)")
        .eq("active", True)
        .eq("courses.provider", "ChronoGolf")
        .execute()
    )
    
    targets = {} # {(course_id, date_str): course_obj}
    
    alerts = alerts_res.data or []
    for a in alerts:
        course = a.get("courses")
        if not course:
            continue
        try:
            # Parse date
            start_dt = datetime.fromisoformat(a["date_from"].replace("Z", "+00:00"))
            date_str = start_dt.strftime("%Y-%m-%d") # ChronoGolf format YYYY-MM-DD
            
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
    return {r['key']: r['value'] for r in res.data or []}

async def fetch_chronogolf_times(configs: dict, date_str: str):
    """ Construct the ChronoGolf request and return the data """
    club_id = configs.get("club_id")
    course_id = configs.get("course_id")
    affiliation_id = configs.get("affiliation_id")
    nb_holes = configs.get("nb_holes", "18")

    if not club_id or not course_id:
        return []

    # Use the marketplace API structure from chrono.txt
    base_url = f"https://www.chronogolf.com/marketplace/clubs/{club_id}/teetimes"
    params = {
        "date": date_str,
        "course_id": course_id,
        "nb_holes": nb_holes,
    }
    
    # Correctly format affiliation_type_ids[] as an array parameter
    # Example: &affiliation_type_ids[]=52866
    query_string = urlencode(params)
    if affiliation_id:
        query_string += f"&affiliation_type_ids%5B%5D={affiliation_id}"

    full_url = f"{base_url}?{query_string}"

    async with AsyncClient(headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }) as client:
        resp = await client.get(full_url, timeout=15.0)
        resp.raise_for_status()
        return resp.json()

async def normalize_and_store(course, raw_data, date_str: str):
    """ Convert ChronoGolf response to TeeTime objects and sync with Supabase availability """
    tee_times: List[TeeTime] = []
    supabase = await create_supabase()

    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()
    utc_tz = tz.tzutc()

    # 1. Calculate time range for the scanned day in UTC
    test_date = datetime.strptime(date_str, "%Y-%m-%d")
    start_utc = test_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz).astimezone(utc_tz)
    end_utc = test_date.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=local_tz).astimezone(utc_tz)

    # 2. Fetch current availability to perform diffing
    current_res = await (
        supabase.table("availability")
        .select("id, tee_time, holes")
        .eq("course_id", course["id"])
        .gte("tee_time", start_utc.isoformat())
        .lte("tee_time", end_utc.isoformat())
        .execute()
    )
    db_map = {
        (datetime.fromisoformat(r['tee_time']).astimezone(utc_tz).isoformat(), int(r['holes'])): r['id']
        for r in current_res.data or []
    }

    scanned_keys = set()
    for item in raw_data:
        # ChronoGolf out_of_capacity means booked
        if item.get("out_of_capacity", False):
            continue

        # ChronoGolf local time is split into date and start_time
        try:
            # item["date"] is "YYYY-MM-DD", item["start_time"] is "HH:MM"
            dt_str = f"{item['date']}T{item['start_time']}:00"
            dt = datetime.fromisoformat(dt_str).replace(tzinfo=local_tz)
            dt_utc = dt.astimezone(utc_tz)
        except Exception:
            continue
        
        # Pricing - ChronoGolf hides price if out_of_capacity sometimes, or it's in green_fees
        price = 0.0
        green_fees = item.get("green_fees", [])
        if green_fees:
            # Just take the first one for now
            price = float(green_fees[0].get("price", 0))

        holes = int(item.get("nb_holes", 18))
        scanned_keys.add((dt_utc.isoformat(), holes))
        
        tee_times.append(
            TeeTime(
                course_id=course['id'],
                tee_time=dt_utc,
                price=price,
                holes=holes,
                available=True,
                source="ChronoGolf",
                raw=item
            )
        )

    # 3. Diff and remove stale
    ids_to_remove = [db_id for key, db_id in db_map.items() if key not in scanned_keys]
    if ids_to_remove:
        await supabase.table("availability").delete().in_("id", ids_to_remove).execute()

    # 4. Upsert fresh data
    if tee_times:
        payload = [t.to_dict() for t in tee_times]
        await supabase.table("availability").upsert(payload, on_conflict="course_id, tee_time, holes").execute()
    
    num_available = len([t for t in tee_times if t.available])
    print(f"[ChronoGolf] Sync complete for {course['name']} on {date_str}. Found {num_available} openings out of {len(tee_times)} total slots.")

async def process_single_target(supabase, course, date_str, sem):
    async with sem:
        try:
            cfgs = await get_provider_configs(supabase, course["id"])
            data = await fetch_chronogolf_times(cfgs, date_str)
            await normalize_and_store(course, data, date_str)
            return True
        except Exception as e:
            print(f"[ChronoGolf] Error scanning {course.get('name')} for {date_str}: {e}")
            return False

async def run_chronogolf_scan():
    """
    Main entry point for ChronoGolf scans.
    """
    start_time = datetime.now()
    targets = await get_active_chronogolf_targets()
    
    if not targets:
        print("[ChronoGolf] No active alerts found.")
        return

    supabase = await create_supabase()
    sem = asyncio.Semaphore(5) # Lower concurrency for ChronoGolf to be safe
    
    tasks = [process_single_target(supabase, course, date_str, sem) for (cid, date_str), course in targets.items()]
    results = await asyncio.gather(*tasks)
    
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    success_count = sum(1 for r in results if r)
    print(f"[ChronoGolf] Scan completed in {duration:.2f}s. Success: {success_count}/{len(targets)}")
