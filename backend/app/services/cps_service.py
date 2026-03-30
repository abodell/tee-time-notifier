"""
cps_service.py — Tee-time scanning service for Club Prophet Systems (CPS) courses.

Scanning model: three HTTP requests per (course, date):
  1. GET the site frontend to obtain a V4COOKIE session cookie.
  2. POST RegisterTransactionId to register a client-generated UUID server-side.
  3. GET TeeTimes with the UUID, date, and search params.
  Results are returned as JSON and normalized into TeeTime objects.
"""

import asyncio
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import httpx
from dateutil import tz

from app.db import create_supabase
from app.models.tee_time import TeeTime


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "x-productid": "1",
    "x-componentid": "1",
}


# ---------------------------------------------------------------------------
# Target discovery
# ---------------------------------------------------------------------------

async def get_active_cps_targets() -> Dict:
    """Return unique (course_id, date_str) pairs for active CPS alerts."""
    supabase = await create_supabase()

    alerts_res = await (
        supabase.table("alerts")
        .select("date_from, date_to, courses!alerts_course_id_fkey!inner(id, name, provider, time_zone)")
        .eq("active", True)
        .eq("courses.provider", "CPS")
        .execute()
    )

    targets = {}
    for a in (alerts_res.data or []):
        course = a.get("courses")
        if not course:
            continue
        try:
            start_dt = datetime.fromisoformat(a["date_from"].replace("Z", "+00:00"))
            date_str = _format_cps_date(start_dt)
            key = (course["id"], date_str)
            targets[key] = course
        except Exception as e:
            print(f"[CPS] Error parsing alert date {a}: {e}")

    return targets


# ---------------------------------------------------------------------------
# Provider config lookup
# ---------------------------------------------------------------------------

async def get_provider_configs(supabase, course_id: int) -> Dict[str, str]:
    """Fetch key/value provider configs for a course."""
    res = await (
        supabase.table("provider_configs")
        .select("key", "value")
        .eq("course_id", course_id)
        .execute()
    )
    return {r["key"]: r["value"] for r in (res.data or [])}


# ---------------------------------------------------------------------------
# Date formatting
# ---------------------------------------------------------------------------

def _format_cps_date(dt: datetime) -> str:
    """Format a datetime as CPS API's searchDate: 'Mon Mar 23 2026' (no leading zero on day)."""
    return f"{dt.strftime('%a %b')} {dt.day} {dt.year}"


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

async def fetch_cps_times(
    site_name: str,
    api_key: str,
    course_id: int,
    date_str: str,
    member_store_id: int = 1,
    time_zone: str = "America/New_York",
) -> List[Dict]:
    """
    Fetch available tee times from a CPS booking site for a given date.

    Args:
        site_name:       Subdomain prefix, e.g. "emeraldlake".
        api_key:         Site-specific x-apiKey header value.
        course_id:       Numeric CPS course ID.
        date_str:        Date in CPS format: "Mon Mar 23 2026".
        member_store_id: memberStoreId param (default 1).
        time_zone:       IANA timezone string for the course (default "America/New_York").

    Returns:
        List of raw tee time dicts from the API content array.
    """
    from datetime import timezone as dt_timezone
    base_url = f"https://{site_name}.cps.golf"
    api_base = f"{base_url}/onlineres/onlineapi/api/v1/onlinereservation"
    base_headers = {**_BASE_HEADERS, "x-apiKey": api_key}

    async with httpx.AsyncClient(follow_redirects=True) as client:
        # Step 1 — seed the root domain so V4COOKIE is set for path "/"
        print(f"[CPS] Fetching session cookie for {site_name}")
        await client.get(f"{base_url}/", timeout=20)
        seed_resp = await client.get(
            f"{base_url}/onlineresweb/search-teetime",
            timeout=20,
        )
        seed_resp.raise_for_status()

        # Step 2 — fetch GetAllOptions to obtain websiteId and terminalId
        # (required headers that the Angular SPA derives from this endpoint)
        opts_resp = await client.get(
            f"{api_base}/GetAllOptions/{site_name}",
            params={"version": "25.3.4.21239412485", "product": "3"},
            headers=base_headers,
            timeout=20,
        )
        opts_data = opts_resp.json() if opts_resp.is_success else {}
        opts = opts_data if isinstance(opts_data, dict) else {}
        website_id = opts.get("webSiteId", "")
        terminal_id = str(opts.get("reservationOptions", {}).get("terminalId", 3))

        # Compute timezone offset (JavaScript-style: minutes behind UTC, positive = behind)
        course_tz = tz.gettz(time_zone) or tz.tzutc()
        now_local = datetime.now(course_tz)
        tz_offset_min = int(-now_local.utcoffset().total_seconds() / 60)

        # Full Angular SPA headers — these are required to get partial bookings
        headers = {
            **base_headers,
            "client-id": "onlineresweb",
            "X-TerminalId": terminal_id,
            "x-requestid": str(uuid.uuid4()),
            "x-websiteid": website_id,
            "x-ismobile": "false",
            "x-siteid": "1",
            "x-timezone-offset": str(tz_offset_min),
            "x-timezoneid": time_zone,
            "x-moduleid": "7",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "Sat, 01 Jan 2000 00:00:00 GMT",
            "If-Modified-Since": "0",
        }

        # Step 3 — register a client-generated transaction ID
        txn_id = str(uuid.uuid4())
        reg_resp = await client.post(
            f"{api_base}/RegisterTransactionId",
            headers={**headers, "Content-Type": "application/json", "x-requestid": str(uuid.uuid4())},
            json={"transactionId": txn_id},
            timeout=15,
        )
        reg_resp.raise_for_status()

        # Step 4 — search tee times
        params = {
            "searchDate": date_str,
            "holes": "18",
            "numberOfPlayer": "0",
            "courseIds": str(course_id),
            "searchTimeType": "0",
            "transactionId": txn_id,
            "teeOffTimeMin": "0",
            "teeOffTimeMax": "23",
            "isChangeTeeOffTime": "true",
            "teeSheetSearchView": "5",
            "classCode": "R",
            "defaultOnlineRate": "N",
            "isUseCapacityPricing": "false",
            "memberStoreId": str(member_store_id),
            "searchType": "1",
        }
        print(f"[CPS] Searching {site_name} | course={course_id} | date={date_str}")
        resp = await client.get(
            f"{api_base}/TeeTimes",
            params=params,
            headers={**headers, "x-requestid": str(uuid.uuid4())},
            timeout=20,
        )
        resp.raise_for_status()

    body = resp.json()
    if not isinstance(body, dict) or not body.get("isSuccess"):
        print(f"[CPS] isSuccess=False for {site_name} on {date_str}")
        return []

    content = body.get("content")
    return content if isinstance(content, list) else []


# ---------------------------------------------------------------------------
# Normalize & store
# ---------------------------------------------------------------------------

async def normalize_and_store(course: Dict, raw_data: List[Dict], date_str: str) -> None:
    """Convert CPS results to TeeTime objects and sync with Supabase."""
    supabase = await create_supabase()

    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()
    utc_tz = tz.tzutc()

    # Parse date_str back to build the UTC window for diffing
    dt_naive = datetime.strptime(date_str, "%a %b %d %Y")
    start_of_day = dt_naive.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=local_tz)
    end_of_day = dt_naive.replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=local_tz)
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
    scanned_keys: set = set()

    for item in raw_data:
        raw_start = item.get("startTime")
        if not raw_start:
            continue

        try:
            dt_local = datetime.fromisoformat(raw_start).replace(tzinfo=local_tz)
        except ValueError:
            print(f"[CPS] Could not parse startTime: {raw_start}")
            continue

        dt_utc = dt_local.astimezone(utc_tz)
        spots_available = len(item.get("availableParticipantNo") or [])
        prices = {p["shItemCode"]: p for p in (item.get("shItemPrices") or [])}

        options: List[Tuple[int, float]] = []
        if item.get("isContain9HoleItems"):
            p9 = prices.get("GreenFee9")
            if p9:
                options.append((9, float(p9.get("currentPrice") or p9.get("price") or 0)))
        if item.get("isContain18HoleItems"):
            p18 = prices.get("GreenFee18")
            if p18:
                options.append((18, float(p18.get("currentPrice") or p18.get("price") or 0)))

        # Fallback: infer from item codes if hole flags are absent
        if not options:
            for price_item in (item.get("shItemPrices") or []):
                code = price_item.get("shItemCode", "")
                price = float(price_item.get("currentPrice") or price_item.get("price") or 0)
                if "9" in code:
                    options.append((9, price))
                elif "18" in code:
                    options.append((18, price))

        for holes, price in options:
            key = (dt_utc.isoformat(), holes)
            scanned_keys.add(key)
            tee_times.append(TeeTime(
                course_id=course["id"],
                tee_time=dt_utc,
                price=price,
                holes=holes,
                available=True,
                source="CPS",
                raw=item,
                spots_available=spots_available,
            ))

    # Remove stale records
    ids_to_remove = [
        db_id
        for (tk, hk), db_id in db_map.items()
        if (tk, hk) not in scanned_keys
    ]
    if ids_to_remove:
        print(f"[CPS] Removing {len(ids_to_remove)} stale records for {course['name']} on {date_str}")
        await supabase.table("availability").delete().in_("id", ids_to_remove).execute()

    if tee_times:
        payload = [t.to_dict() for t in tee_times]
        await supabase.table("availability").upsert(payload, on_conflict="course_id, tee_time, holes").execute()
        print(f"[CPS] Sync complete for {course['name']} on {date_str}. Stored {len(tee_times)} slots.")
    else:
        print(f"[CPS] No times found for {course['name']} on {date_str}.")


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
            site_name = configs.get("site_name")
            api_key = configs.get("api_key")
            course_id = int(configs.get("course_id", 1))
            member_store_id = int(configs.get("member_store_id", 1))

            if not site_name or not api_key:
                print(f"[CPS] Missing site_name or api_key for {course['name']}")
                return False

            raw = await fetch_cps_times(site_name, api_key, course_id, date_str, member_store_id, course.get("time_zone", "America/New_York"))
            await normalize_and_store(course, raw, date_str)
            return True
        except Exception as e:
            print(f"[CPS] Error scanning {course.get('name')} for {date_str}: {e}")
            return False


# ---------------------------------------------------------------------------
# Main scan entry point
# ---------------------------------------------------------------------------

async def run_cps_scan() -> None:
    start_time = datetime.now()
    print(f"[CPS] Starting scan at {start_time.isoformat()}...")

    targets = await get_active_cps_targets()

    if not targets:
        print("[CPS] No active alerts found.")
        return

    print(f"[CPS] Found {len(targets)} unique (course, date) pairs to scan.")

    sem = asyncio.Semaphore(3)
    tasks = [
        process_single_target(course, date_str, sem)
        for (_, date_str), course in targets.items()
    ]
    results = await asyncio.gather(*tasks)

    duration = (datetime.now() - start_time).total_seconds()
    success_count = sum(1 for r in results if r)
    print(f"[CPS] Scan complete in {duration:.2f}s. Success: {success_count}/{len(targets)}")
