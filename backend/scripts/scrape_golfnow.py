"""
scrape_golfnow.py — Discover GolfNow courses by iterating Facility IDs.

Usage:
    python backend/scripts/scrape_golfnow.py --start 1 --end 20000 --out backend/seeds/golfnow_courses.json

For each Facility ID, POSTs to the GolfNow tee-time API with SearchType=1
(by facility). If the facility exists and has public tee times, it's captured.
"""
import asyncio
import argparse
import json
import os
import time
import random
from datetime import datetime, timedelta
from typing import Optional, Dict, List

import httpx
from timezonefinder import TimezoneFinder
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
GOLFNOW_API_URL = "https://www.golfnow.com/api/tee-times/tee-time-results"

HEADERS = {
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

# Mapping from raw UTC offset (hours) to candidate IANA timezone.
# lat/lng resolution via timezonefinder is preferred when coordinates exist;
# this table is a fallback.
OFFSET_TO_TZ_FALLBACK: Dict[int, str] = {
    -10: "Pacific/Honolulu",
    -9:  "America/Anchorage",
    -8:  "America/Los_Angeles",
    -7:  "America/Denver",
    -6:  "America/Chicago",
    -5:  "America/New_York",
    -4:  "America/Halifax",
    0:   "UTC",
    1:   "Europe/London",
}

tf = TimezoneFinder()


# ---------------------------------------------------------------------------
# Timezone helpers
# ---------------------------------------------------------------------------
def resolve_timezone(lat: Optional[float], lng: Optional[float], offset: Optional[int]) -> str:
    """
    Attempt to resolve an IANA timezone string.
    1. Try timezonefinder with lat/lng (most accurate).
    2. Fall back to offset → IANA mapping table.
    3. Fall back to UTC.
    """
    if lat is not None and lng is not None:
        try:
            tz_str = tf.timezone_at(lat=lat, lng=lng)
            if tz_str:
                return tz_str
        except Exception:
            pass

    if offset is not None:
        return OFFSET_TO_TZ_FALLBACK.get(int(offset), f"Etc/GMT{-int(offset):+d}")

    return "UTC"


# ---------------------------------------------------------------------------
# API call
# ---------------------------------------------------------------------------
async def fetch_facility(
    client: httpx.AsyncClient,
    facility_id: int,
    date_str: str,
    sem: asyncio.Semaphore,
) -> Optional[Dict]:
    """
    POST to GolfNow API for a single facility_id.
    Returns a course dict ready for the JSON seed file, or None if not found/invalid.
    """
    payload = {
        "PageSize": 1,
        "PageNumber": 0,
        "SearchType": 1,           # Search by facility ID
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
        "TeeTimeCount": 1,
    }

    async with sem:
        # Jitter to avoid hammering
        await asyncio.sleep(random.uniform(0.5, 1.5))
        try:
            resp = await client.post(
                GOLFNOW_API_URL,
                json=payload,
                headers=HEADERS,
                timeout=15.0,
            )
        except Exception as e:
            print(f"  [ID {facility_id}] Request error: {e}")
            return None

    if resp.status_code != 200:
        # 404 / 400 means facility doesn't exist — expected and silent
        if resp.status_code not in (400, 404):
            print(f"  [ID {facility_id}] HTTP {resp.status_code}")
        return None

    try:
        body = resp.json()
    except Exception:
        return None

    tee_times = (body.get("ttResults") or {}).get("teeTimes") or []
    if not tee_times:
        return None   # Facility exists but has no public tee times — skip

    # Pull facility info from the first tee time entry
    facility = tee_times[0].get("facility", {})
    if not facility:
        return None

    # Skip private, simulator, military-only facilities
    if facility.get("isPrivate") or facility.get("isSimulator") or facility.get("isMilitaryBase"):
        return None

    name = facility.get("name", "").strip()
    if not name:
        return None

    address = facility.get("address") or {}
    city = address.get("city", "").strip()
    state = address.get("stateProvinceCode", "").strip()
    country_code = address.get("country", "US").strip()

    # Only keep US courses
    if country_code not in ("US", "USA", ""):
        return None

    lat = facility.get("latitude")
    lng = facility.get("longitude")
    tz_offset = facility.get("timeZoneOffset")

    timezone = resolve_timezone(lat, lng, tz_offset)

    provider_url = f"https://www.golfnow.com/tee-times/facility/{facility_id}"

    print(f"  [ID {facility_id}] ✓ {name} | {city}, {state} | tz={timezone}")

    return {
        "name": name,
        "city": city,
        "state": state,
        "country": "USA",
        "latitude": lat,
        "longitude": lng,
        "provider": "GolfNow",
        "provider_url": provider_url,
        "active": True,
        "configs": {
            "facility_id": str(facility_id),
            "timezone": timezone,
        },
    }


# ---------------------------------------------------------------------------
# Main scrape loop
# ---------------------------------------------------------------------------
async def scrape_range(start_id: int, end_id: int, output_file: str, concurrency: int = 5):
    # Tomorrow's date avoids "date in the past" errors from the API
    scan_date = (datetime.now() + timedelta(days=1)).strftime("%b %d %Y")  # e.g. "Feb 22 2026"
    
    print(f"Scraping GolfNow facilities {start_id}–{end_id} | date={scan_date} | concurrency={concurrency}")
    print(f"Output: {output_file}\n")

    sem = asyncio.Semaphore(concurrency)
    proxy_url = os.getenv("GOLFNOW_PROXY")
    results: List[Dict] = []

    async with httpx.AsyncClient(proxy=proxy_url if proxy_url else None, verify=False) as client:
        tasks = [
            fetch_facility(client, fid, scan_date, sem)
            for fid in range(start_id, end_id + 1)
        ]
        raw = await asyncio.gather(*tasks)

    results = [r for r in raw if r is not None]
    print(f"\nFound {len(results)} valid GolfNow facilities.")

    # Load existing file and merge on facility_id
    existing: List[Dict] = []
    try:
        with open(output_file, "r") as f:
            existing = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    merged_map: Dict[str, Dict] = {
        c["configs"]["facility_id"]: c for c in existing
    }

    new_count = 0
    updated_count = 0
    for r in results:
        fid_key = r["configs"]["facility_id"]
        if fid_key in merged_map:
            updated_count += 1
        else:
            new_count += 1
        merged_map[fid_key] = r

    final_list = list(merged_map.values())

    # Ensure output directory exists
    os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)

    with open(output_file, "w") as f:
        json.dump(final_list, f, indent=2)

    print(
        f"Saved {len(final_list)} total facilities "
        f"({new_count} new, {updated_count} updated) to {output_file}"
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape GolfNow course data by Facility ID")
    parser.add_argument("--start", type=int, required=True, help="Start Facility ID (inclusive)")
    parser.add_argument("--end",   type=int, required=True, help="End Facility ID (inclusive)")
    parser.add_argument(
        "--out",
        type=str,
        default="backend/seeds/golfnow_courses.json",
        help="Output JSON file path",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=5,
        help="Number of simultaneous requests (default: 5)",
    )
    args = parser.parse_args()
    asyncio.run(scrape_range(args.start, args.end, args.out, args.concurrency))
