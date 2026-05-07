import asyncio
from httpx import AsyncClient
from typing import List, Dict
from datetime import datetime, timezone, timedelta
from dateutil import tz

from app.db import create_supabase
from app.models.tee_time import TeeTime
from app.services import config_cache

WHOOSH_API_URL = "https://api.app.whoosh.io/private/api"

# Minimal GraphQL query to fetch tee times for a single date.
# Uses playerRates(type: CUSTOMER) to get public/guest pricing.
# availableCapacity requires bookingType: STANDARD.
WHOOSH_QUERY = """
query WhooshTimes($facilityId: ID!, $date: Date!, $courseIds: [ID]) {
  node(id: $facilityId) {
    id
    ... on Facility {
      agendas(dateLte: $date, dateGte: $date) {
        edges {
          node {
            date
            timeSlots(courseIds: $courseIds) {
              edges {
                node {
                  id
                  time
                  availability
                  usedCapacity
                  availableCapacity(bookingType: STANDARD)
                  permittedCourseLayouts {
                    edges { node { holeCount } }
                  }
                  rates: playerRates(highestPrecedentOnly: true, nonPlayingHost: false, type: CUSTOMER) {
                    eighteenHolePrice: totalGolfPrice(holeCount: EIGHTEEN)
                    nineHolePrice: totalGolfPrice(holeCount: NINE)
                    rate { id name type }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
""".strip()

# Map Whoosh holeCount enum values to integers
HOLE_COUNT_MAP = {
    "EIGHTEEN": 18,
    "NINE": 9,
}


async def get_active_whoosh_targets():
    """
    Return a list of unique (course, date_str) tuples that need scanning
    based on active alerts for Whoosh courses.
    """
    supabase = await create_supabase()

    cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    alerts_res = await (
        supabase.table("alerts")
        .select("date_from, date_to, courses!alerts_course_id_fkey!inner(id, name, provider, time_zone)")
        .eq("active", True)
        .eq("courses.provider", "Whoosh")
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
            date_str = start_dt.strftime("%Y-%m-%d")
            key = (course["id"], date_str)
            targets[key] = course
        except Exception as e:
            print(f"[Whoosh] Error parsing alert date {a}: {e}")

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


async def fetch_whoosh_times(course, configs: dict, date_str: str) -> dict:
    """
    Fetch tee times from the Whoosh GraphQL API.

    Required configs:
      - facility_id: Full Facility ID (e.g. "Facility:ce2884e5-...")
      - course_id: Full Course ID (e.g. "Course:8be549ae-...")
      - club_slug: Club slug from URL (e.g. "yale-golf-course")
    """
    facility_id = configs.get("facility_id")
    course_id = configs.get("course_id")
    club_slug = configs.get("club_slug")

    if not facility_id or not club_slug:
        print(f"[Whoosh] Missing facility_id or club_slug for {course['name']}")
        return {}

    headers = {
        "Content-Type": "application/json",
        "Origin": "https://app.whoosh.io",
        "Referer": "https://app.whoosh.io/",
        "x-whoosh-member-club-slug": club_slug,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    }

    variables: Dict = {
        "facilityId": facility_id,
        "date": date_str,
    }
    if course_id:
        variables["courseIds"] = [course_id]

    payload = {"query": WHOOSH_QUERY, "variables": variables}

    print(f"[Whoosh] Fetching {course['name']} | date={date_str}...")

    async with AsyncClient(headers=headers, timeout=30.0) as client:
        resp = await client.post(WHOOSH_API_URL, json=payload)
        resp.raise_for_status()

    return resp.json()


async def normalize_and_store(course, raw_data: dict, date_str: str):
    """
    Convert Whoosh GraphQL response to TeeTime objects and sync with Supabase.

    Response structure:
      data.node.agendas.edges[].node:
        date: YYYY-MM-DD
        timeSlots.edges[].node:
          id: "TimeSlot:..."
          time: "HH:MM:SS" (local time)
          availability: "AVAILABLE" | "BLOCKED" | ...
          usedCapacity: int
          availableCapacity: int
          permittedCourseLayouts.edges[].node.holeCount: "EIGHTEEN" | "NINE"
          rates[]: { eighteenHolePrice: int (cents), nineHolePrice: int (cents), rate: {name, type} }
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

    agendas = raw_data.get("data", {}).get("node", {}).get("agendas", {}).get("edges", [])
    for agenda_edge in agendas:
        agenda = agenda_edge.get("node", {})
        slot_date = agenda.get("date", date_str)

        for slot_edge in agenda.get("timeSlots", {}).get("edges", []):
            slot = slot_edge.get("node", {})

            if slot.get("availability") != "AVAILABLE":
                continue

            raw_time = slot.get("time", "")  # e.g. "07:45:00"
            if not raw_time:
                continue

            # Parse local datetime and convert to UTC
            try:
                local_dt_str = f"{slot_date} {raw_time}"
                local_dt = datetime.strptime(local_dt_str, "%Y-%m-%d %H:%M:%S")
                local_dt = local_dt.replace(tzinfo=local_tz)
                dt_utc = local_dt.astimezone(utc_tz)
            except Exception as e:
                print(f"[Whoosh] Skipping invalid time {raw_time}: {e}")
                continue

            spots_available = slot.get("availableCapacity")

            # Determine supported hole counts for this slot
            permitted_holes = set()
            for layout_edge in slot.get("permittedCourseLayouts", {}).get("edges", []):
                hole_str = layout_edge.get("node", {}).get("holeCount", "")
                if hole_str in HOLE_COUNT_MAP:
                    permitted_holes.add(HOLE_COUNT_MAP[hole_str])

            # Extract prices from rates (in cents, divide by 100 for dollars)
            holes_prices: Dict[int, float] = {}
            for rate in slot.get("rates", []):
                price_18 = rate.get("eighteenHolePrice")
                price_9 = rate.get("nineHolePrice")
                if 18 in permitted_holes and price_18 is not None:
                    price = price_18 / 100.0
                    if 18 not in holes_prices or price < holes_prices[18]:
                        holes_prices[18] = price
                if 9 in permitted_holes and price_9 is not None:
                    price = price_9 / 100.0
                    if 9 not in holes_prices or price < holes_prices[9]:
                        holes_prices[9] = price

            # If no priced rates, fall back to permitted holes with null price
            if not holes_prices and permitted_holes:
                for h in permitted_holes:
                    holes_prices[h] = 0.0

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
                        source="Whoosh",
                        raw=slot,
                        spots_available=spots_available,
                    )
                )

    # Remove stale DB records
    ids_to_remove = [db_id for (key, db_id) in db_map.items() if key not in scanned_keys]
    if ids_to_remove:
        print(f"[Whoosh] Removing {len(ids_to_remove)} stale records for {course['name']} on {date_str}")
        await supabase.table("availability").delete().in_("id", ids_to_remove).execute()

    # Upsert fresh data
    if tee_times:
        payload = [t.to_dict() for t in tee_times]
        await supabase.table("availability").upsert(payload, on_conflict="course_id, tee_time, holes", returning="minimal").execute()
        print(f"[Whoosh] Upserted {len(tee_times)} tee times for {course['name']} on {date_str}")
    else:
        print(f"[Whoosh] No tee times found for {course['name']} on {date_str}")


async def process_single_target(supabase, course, date_str, sem):
    """Worker for concurrent scanning."""
    async with sem:
        try:
            configs = await get_provider_configs(supabase, course["id"])
            data = await fetch_whoosh_times(course, configs, date_str)
            await normalize_and_store(course, data, date_str)
            return True
        except Exception as e:
            print(f"[Whoosh] Error scanning {course.get('name')} for {date_str}: {e}")
            return False


async def run_whoosh_scan():
    """
    Scans Whoosh courses for all dates in active alerts.
    """
    start_time = datetime.now()
    print(f"[Whoosh] Starting scan at {start_time.isoformat()}...")

    targets = await get_active_whoosh_targets()

    if not targets:
        print("[Whoosh] No active alerts found.")
        return

    print(f"[Whoosh] Found {len(targets)} unique (course, date) pairs to scan.")

    supabase = await create_supabase()
    sem = asyncio.Semaphore(10)

    tasks = [
        process_single_target(supabase, course, date_str, sem)
        for (_, date_str), course in targets.items()
    ]
    results = await asyncio.gather(*tasks)

    duration = (datetime.now() - start_time).total_seconds()
    success_count = sum(1 for r in results if r)
    print(f"[Whoosh] Scan completed in {duration:.2f}s. Success: {success_count}/{len(targets)}")
