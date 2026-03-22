import json
import asyncio
from httpx import AsyncClient, Limits
from typing import List, Union, Dict, Optional
from datetime import datetime
from dateutil import tz
from urllib.parse import urlencode

from app.db import create_supabase
from app.models.tee_time import TeeTime

_CHRONO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

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
            print(f"[ChronoGolf] Error parsing alert date {a}: {e}")
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

async def _get_or_discover_course_uuid(
    supabase, course_db_id: int, configs: dict, date_str: str
) -> Optional[str]:
    """
    Return the ChronoGolf course UUID needed for the v2 API.

    Strategy:
      1. Return cached value from provider_configs if present.
      2. Otherwise fetch one v1 tee time to get a tee-time UUID, then call
         /marketplace/v2/teetimes/{uuid} which embeds course.uuid in its
         response.  Cache the result in provider_configs for future runs.
    """
    if cached := configs.get("course_uuid"):
        return cached

    club_id = configs.get("club_id")
    course_id = configs.get("course_id")
    affiliation_id = configs.get("affiliation_id")
    nb_holes = configs.get("nb_holes", "18")

    if not club_id or not course_id:
        return None

    try:
        # Step 1: fetch v1 tee times to get a tee-time UUID
        params = {"date": date_str, "course_id": course_id, "nb_holes": nb_holes}
        qs = urlencode(params)
        if affiliation_id:
            qs += f"&affiliation_type_ids%5B%5D={affiliation_id}"
        v1_url = f"https://www.chronogolf.com/marketplace/clubs/{club_id}/teetimes?{qs}"

        async with AsyncClient(headers=_CHRONO_HEADERS, timeout=15.0) as client:
            r = await client.get(v1_url)
            r.raise_for_status()
            items = r.json()

        if not items:
            return None

        teetime_uuid = items[0].get("uuid")
        if not teetime_uuid:
            return None

        # Step 2: call v2 single-tee-time endpoint to extract course.uuid
        async with AsyncClient(headers=_CHRONO_HEADERS, timeout=15.0) as client:
            r2 = await client.get(
                f"https://www.chronogolf.com/marketplace/v2/teetimes/{teetime_uuid}"
            )
            r2.raise_for_status()
            course_uuid = r2.json().get("course", {}).get("uuid")

        if not course_uuid:
            return None

        # Step 3: cache for future runs (update existing row or insert new one)
        existing = await (
            supabase.table("provider_configs")
            .select("id")
            .eq("course_id", course_db_id)
            .eq("key", "course_uuid")
            .execute()
        )
        if existing.data:
            await (
                supabase.table("provider_configs")
                .update({"value": course_uuid})
                .eq("course_id", course_db_id)
                .eq("key", "course_uuid")
                .execute()
            )
        else:
            await (
                supabase.table("provider_configs")
                .insert({"course_id": course_db_id, "key": "course_uuid", "value": course_uuid, "provider": "ChronoGolf"})
                .execute()
            )
        print(f"[ChronoGolf] Discovered and cached course UUID {course_uuid} for course_db_id={course_db_id}")
        return course_uuid

    except Exception as e:
        print(f"[ChronoGolf] Could not discover course UUID for course_db_id={course_db_id}: {e}")
        return None


async def _fetch_v2(course_uuid: str, date_str: str) -> List[dict]:
    """Fetch tee times from the ChronoGolf v2 API (includes min/max_player_size)."""
    url = "https://www.chronogolf.com/marketplace/v2/teetimes"
    params = {
        "start_date": date_str,
        "course_ids": course_uuid,
        "holes": "9,18",
        "page": 1,
    }
    async with AsyncClient(headers=_CHRONO_HEADERS, timeout=15.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    return data.get("teetimes", [])


async def _fetch_v1(configs: dict, date_str: str) -> List[dict]:
    """Fetch tee times from the ChronoGolf v1 API (fallback; no player count)."""
    club_id = configs.get("club_id")
    course_id = configs.get("course_id")
    affiliation_id = configs.get("affiliation_id")
    nb_holes = configs.get("nb_holes", "18")

    if not club_id or not course_id:
        return []

    params = {"date": date_str, "course_id": course_id, "nb_holes": nb_holes}
    qs = urlencode(params)
    if affiliation_id:
        qs += f"&affiliation_type_ids%5B%5D={affiliation_id}"
    url = f"https://www.chronogolf.com/marketplace/clubs/{club_id}/teetimes?{qs}"

    async with AsyncClient(headers=_CHRONO_HEADERS, timeout=15.0) as client:
        resp = await client.get(url, timeout=15.0)
        resp.raise_for_status()
        return resp.json()


async def fetch_chronogolf_times(supabase, course_db_id: int, configs: dict, date_str: str):
    """
    Fetch ChronoGolf tee times, preferring the v2 API (which exposes
    min/max_player_size) when a course UUID is available.

    Returns a tuple (items, is_v2) so the caller knows which format to parse.
    """
    course_uuid = await _get_or_discover_course_uuid(supabase, course_db_id, configs, date_str)
    if course_uuid:
        items = await _fetch_v2(course_uuid, date_str)
        print(f"[ChronoGolf] v2 fetch returned {len(items)} items for course_db_id={course_db_id}")
        return items, True
    else:
        items = await _fetch_v1(configs, date_str)
        print(f"[ChronoGolf] v1 fetch returned {len(items)} items for course_db_id={course_db_id}")
        return items, False


async def normalize_and_store(course, raw_data, date_str: str, is_v2: bool = False):
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
        try:
            if is_v2:
                # v2 format: starts_at (UTC ISO) or date+start_time, max_player_size
                if "starts_at" in item:
                    dt_utc = datetime.fromisoformat(
                        item["starts_at"].replace("Z", "+00:00")
                    ).astimezone(utc_tz)
                else:
                    # single-endpoint style: date + start_time (local)
                    dt_str = f"{item['date']}T{item['start_time']}:00"
                    dt_utc = datetime.fromisoformat(dt_str).replace(tzinfo=local_tz).astimezone(utc_tz)

                max_players = int(item.get("max_player_size") or 0)
                available = max_players > 0
                spots_available = max_players if max_players > 0 else None

                # holes: v2 returns bookable_holes list per item or the holes param we sent
                course_info = item.get("course", {})
                bookable = course_info.get("bookable_holes", [18])
                holes_list = [int(h) for h in bookable] if bookable else [18]

                # Price: v2 nests under affiliation_types_availability
                price = 0.0
                for aff in item.get("affiliation_types_availability", []):
                    for bh in aff.get("bookable_holes", []):
                        fees = bh.get("green_fees", [])
                        if fees:
                            price = float(fees[0].get("price", 0) or 0)
                            break
                    if price:
                        break

                for holes in holes_list:
                    scanned_keys.add((dt_utc.isoformat(), holes))
                    tee_times.append(
                        TeeTime(
                            course_id=course['id'],
                            tee_time=dt_utc,
                            price=price,
                            holes=holes,
                            available=available,
                            source="ChronoGolf",
                            raw=item,
                            spots_available=spots_available,
                        )
                    )
            else:
                # v1 format: out_of_capacity, date + start_time (local), nb_holes
                if item.get("out_of_capacity", False):
                    continue

                dt_str = f"{item['date']}T{item['start_time']}:00"
                dt_utc = datetime.fromisoformat(dt_str).replace(tzinfo=local_tz).astimezone(utc_tz)

                price = 0.0
                green_fees = item.get("green_fees", [])
                if green_fees:
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
                        raw=item,
                        spots_available=None,
                    )
                )
        except Exception:
            continue

    # 3. Diff and remove stale
    ids_to_remove = [db_id for key, db_id in db_map.items() if key not in scanned_keys]
    if ids_to_remove:
        await supabase.table("availability").delete().in_("id", ids_to_remove).execute()

    # 4. Upsert fresh data (deduplicate by (tee_time, holes))
    if tee_times:
        unique_map = {}
        for t in tee_times:
            key = (t.tee_time.isoformat(), t.holes)
            if key not in unique_map or t.price < unique_map[key].price:
                unique_map[key] = t
        payload = [t.to_dict() for t in unique_map.values()]
        await supabase.table("availability").upsert(payload, on_conflict="course_id, tee_time, holes").execute()

    num_available = len([t for t in tee_times if t.available])
    api_ver = "v2" if is_v2 else "v1"
    print(f"[ChronoGolf] Sync complete ({api_ver}) for {course['name']} on {date_str}. Found {num_available} openings out of {len(tee_times)} total slots.")

async def process_single_target(supabase, course, date_str, sem):
    async with sem:
        try:
            cfgs = await get_provider_configs(supabase, course["id"])
            data, is_v2 = await fetch_chronogolf_times(supabase, course["id"], cfgs, date_str)
            await normalize_and_store(course, data, date_str, is_v2=is_v2)
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
