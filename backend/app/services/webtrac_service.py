"""
webtrac_service.py — Tee-time scanning service for Vermont Systems WebTrac courses.

Scanning model: two HTTP requests per (course, date):
  1. GET the search page to obtain a fresh CSRF token.
  2. GET search results with the CSRF token, date, and player count params.
  Results are returned as server-rendered HTML and parsed with BeautifulSoup.
"""

import asyncio
import re
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional

_WEBTRAC_MAX_RETRIES = 3
_WEBTRAC_RETRY_DELAY = 5  # seconds between retries on 403

from bs4 import BeautifulSoup
from curl_cffi.requests import AsyncSession
from dateutil import tz

from app.db import create_supabase
from app.models.tee_time import TeeTime
from app.services import config_cache


# ---------------------------------------------------------------------------
# Target discovery
# ---------------------------------------------------------------------------

async def get_active_webtrac_targets() -> Dict:
    """Return unique (course_id, date_str) pairs for active WebTrac alerts."""
    supabase = await create_supabase()

    cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    alerts_res = await (
        supabase.table("alerts")
        .select("date_from, date_to, courses!alerts_course_id_fkey!inner(id, name, provider, time_zone)")
        .eq("active", True)
        .eq("courses.provider", "WebTrac")
        .gte("date_to", cutoff)
        .execute()
    )

    targets = {}
    for a in (alerts_res.data or []):
        course = a.get("courses")
        if not course:
            continue
        try:
            start_dt = datetime.fromisoformat(a["date_from"].replace("Z", "+00:00"))
            date_str = start_dt.strftime("%m/%d/%Y")
            key = (course["id"], date_str)
            targets[key] = course
        except Exception as e:
            print(f"[WebTrac] Error parsing alert date {a}: {e}")

    return targets


# ---------------------------------------------------------------------------
# Provider config lookup
# ---------------------------------------------------------------------------

async def get_provider_configs(supabase, course_id: int) -> Dict[str, str]:
    """Fetch key/value provider configs for a course."""
    cached = config_cache.get(course_id)
    if cached is not None:
        return cached

    res = await (
        supabase.table("provider_configs")
        .select("key", "value")
        .eq("course_id", course_id)
        .execute()
    )
    cfg = {r["key"]: r["value"] for r in (res.data or [])}
    config_cache.set(course_id, cfg)
    return cfg


# ---------------------------------------------------------------------------
# CSRF token extraction
# ---------------------------------------------------------------------------

def _extract_csrf_token(html: str) -> Optional[str]:
    """Extract _csrf_token from WebTrac search page HTML."""
    # It appears in the form action URL or as a hidden input
    match = re.search(r'_csrf_token=([A-Z0-9]+)', html)
    if match:
        return match.group(1)
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find("input", {"name": "_csrf_token"})
    if tag:
        return tag.get("value")
    return None


# ---------------------------------------------------------------------------
# Fetch & parse
# ---------------------------------------------------------------------------

async def fetch_webtrac_times(
    base_url: str,
    date_str: str,
    num_players: int = 4,
    num_holes: int = 18,
) -> List[Dict]:
    """
    Fetch available tee times from a WebTrac booking page for a given date.

    Uses curl_cffi to impersonate Chrome at the TLS level, bypassing Cloudflare's
    bot detection which blocks standard HTTP clients.

    Args:
        base_url:    Root URL of the WebTrac instance, e.g.
                     "https://sccharlestonweb.myvscloud.com/webtrac/web/search.html"
        date_str:    Date in MM/DD/YYYY format.
        num_players: Number of players (default 4).
        num_holes:   Number of holes (default 18).

    Returns:
        List of dicts with keys: time, date, holes, course_name, spots_available.
    """
    for attempt in range(1, _WEBTRAC_MAX_RETRIES + 1):
        try:
            # Use a single session so cookies (including Cloudflare clearance) persist
            # between the seed request and the search request.
            async with AsyncSession(impersonate="chrome131") as session:
                # Step 1 — fetch the bare search page to get a fresh CSRF token
                seed_url = f"{base_url}?module=GR"
                print(f"[WebTrac] Fetching CSRF token from {seed_url}")
                seed_resp = await session.get(seed_url, timeout=20)
                seed_resp.raise_for_status()

                csrf = _extract_csrf_token(seed_resp.text)
                if not csrf:
                    raise ValueError("[WebTrac] Could not extract CSRF token from seed page")

                # Step 2 — search for tee times
                params = {
                    "Action": "Start",
                    "SubAction": "",
                    "_csrf_token": csrf,
                    "numberofplayers": str(num_players),
                    "secondarycode": "",
                    "begindate": date_str,
                    "begintime": "07:00 am",
                    "numberofholes": str(num_holes),
                    "display": "Detail",
                    "module": "GR",
                    "multiselectlist_value": "",
                    "grwebsearch_buttonsearch": "yes",
                }

                print(f"[WebTrac] Searching {date_str} players={num_players} holes={num_holes}...")
                resp = await session.get(base_url, params=params, timeout=20)
                resp.raise_for_status()

            return _parse_results(resp.text)
        except Exception as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status == 403 and attempt < _WEBTRAC_MAX_RETRIES:
                print(f"[WebTrac] 403 on attempt {attempt}/{_WEBTRAC_MAX_RETRIES}, retrying in {_WEBTRAC_RETRY_DELAY}s...")
                await asyncio.sleep(_WEBTRAC_RETRY_DELAY)
                continue
            raise


def _parse_results(html: str) -> List[Dict]:
    """Parse the WebTrac results table into a list of tee time dicts."""
    soup = BeautifulSoup(html, "html.parser")

    # Each result row has td[data-title="Time"], td[data-title="Date"], etc.
    rows = soup.select("tbody tr")
    results = []

    for row in rows:
        def cell(title):
            td = row.find("td", {"data-title": title})
            return td.get_text(strip=True) if td else None

        time_str = cell("Time")
        date_str = cell("Date")
        holes_str = cell("Holes")
        course_name = cell("Course")
        slots_str = cell("Open Slots")

        if not time_str or not date_str:
            continue

        # Parse holes — "18 (Front)" → 18
        holes = 18
        if holes_str:
            holes_match = re.match(r"(\d+)", holes_str)
            if holes_match:
                holes = int(holes_match.group(1))

        spots = None
        if slots_str:
            try:
                spots = int(slots_str)
            except ValueError:
                pass

        results.append({
            "time": time_str,
            "date": date_str,
            "holes": holes,
            "holes_raw": holes_str,
            "course_name": course_name,
            "spots_available": spots,
        })

    return results


# ---------------------------------------------------------------------------
# Normalize & store
# ---------------------------------------------------------------------------

async def normalize_and_store(course: Dict, raw_data: List[Dict], date_str: str) -> None:
    """Convert WebTrac results to TeeTime objects and sync with Supabase."""
    supabase = await create_supabase()

    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()
    utc_tz = tz.tzutc()

    # Build UTC window for the scanned day
    test_date = datetime.strptime(date_str, "%m/%d/%Y")
    start_of_day = test_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
    end_of_day = test_date.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=local_tz)
    start_utc = start_of_day.astimezone(utc_tz)
    end_utc = end_of_day.astimezone(utc_tz)

    # Fetch existing records for diffing
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
        for r in (current_res.data or [])
    }

    tee_times: List[TeeTime] = []
    scanned_keys = set()

    for item in raw_data:
        try:
            dt_local = datetime.strptime(f"{item['date']} {item['time']}", "%m/%d/%Y %I:%M %p")
        except ValueError:
            print(f"[WebTrac] Could not parse datetime: {item['date']} {item['time']}")
            continue

        dt_local = dt_local.replace(tzinfo=local_tz)
        dt_utc = dt_local.astimezone(utc_tz)

        key = (dt_utc.isoformat(), item["holes"])
        scanned_keys.add(key)

        tee_times.append(TeeTime(
            course_id=course["id"],
            tee_time=dt_utc,
            price=0.0,  # WebTrac doesn't surface price in search results
            holes=item["holes"],
            available=True,
            source="WebTrac",
            raw=item,
            spots_available=item.get("spots_available"),
        ))

    # Remove stale records
    ids_to_remove = [
        db_id
        for (tk, hk), db_id in db_map.items()
        if (tk, hk) not in scanned_keys
    ]
    if ids_to_remove:
        print(f"[WebTrac] Removing {len(ids_to_remove)} stale records for {course['name']} on {date_str}")
        await supabase.table("availability").delete().in_("id", ids_to_remove).execute()

    if tee_times:
        payload = [t.to_dict() for t in tee_times]
        await supabase.table("availability").upsert(payload, on_conflict="course_id, tee_time, holes", returning="minimal").execute()
        print(f"[WebTrac] Sync complete for {course['name']} on {date_str}. Stored {len(tee_times)} slots.")
    else:
        print(f"[WebTrac] No times found for {course['name']} on {date_str}.")


# ---------------------------------------------------------------------------
# Single-target worker
# ---------------------------------------------------------------------------

async def process_single_target(
    course: Dict,
    date_str: str,
    sem: asyncio.Semaphore,
) -> bool:
    async with sem:
        try:
            supabase = await create_supabase()
            configs = await get_provider_configs(supabase, course["id"])
            base_url = configs.get("base_url")
            if not base_url:
                print(f"[WebTrac] No base_url config for {course['name']}")
                return False

            num_players = int(configs.get("num_players", 4))
            num_holes = int(configs.get("num_holes", 18))

            raw = await fetch_webtrac_times(base_url, date_str, num_players, num_holes)
            await normalize_and_store(course, raw, date_str)
            return True
        except Exception as e:
            print(f"[WebTrac] Error scanning {course.get('name')} for {date_str}: {e}")
            return False


# ---------------------------------------------------------------------------
# Main scan entry point
# ---------------------------------------------------------------------------

async def run_webtrac_scan() -> None:
    start_time = datetime.now()
    print(f"[WebTrac] Starting scan at {start_time.isoformat()}...")

    targets = await get_active_webtrac_targets()

    if not targets:
        print("[WebTrac] No active alerts found.")
        return

    print(f"[WebTrac] Found {len(targets)} unique (course, date) pairs to scan.")

    supabase = await create_supabase()
    sem = asyncio.Semaphore(3)  # WebTrac is a single municipal server — be gentle

    tasks = [
        process_single_target(course, date_str, sem)
        for (_, date_str), course in targets.items()
    ]
    results = await asyncio.gather(*tasks)

    duration = (datetime.now() - start_time).total_seconds()
    success_count = sum(1 for r in results if r)
    print(f"[WebTrac] Scan complete in {duration:.2f}s. Success: {success_count}/{len(targets)}")
