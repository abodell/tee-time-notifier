import asyncio
import httpx
from typing import List, Dict, Optional
from dateutil import tz
from datetime import datetime
from bs4 import BeautifulSoup
import re
import logging
from app.db import create_supabase

logger = logging.getLogger(__name__)

_QUICK18_RETRYABLE = (
    httpx.ConnectError,
    httpx.ReadError,
    httpx.RemoteProtocolError,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
)

async def fetch_quick18_times(client: httpx.AsyncClient, base_url: str, date_str: str) -> Optional[str]:
    # date_str expected as YYYYMMDD for Quick18 URL
    url = f"{base_url}/teetimes/searchmatrix?teedate={date_str}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    for attempt in range(1, 4):
        try:
            resp = await client.get(url, timeout=15.0, follow_redirects=True, headers=headers)
            if resp.status_code != 200:
                logger.error(f"Quick18 Fetch Error {url}: {resp.status_code}")
                return None
            return resp.text
        except _QUICK18_RETRYABLE as e:
            logger.warning(f"Quick18 {type(e).__name__} {url} (attempt {attempt}/3): {e}")
            if attempt < 3:
                await asyncio.sleep(3 * attempt)
        except Exception as e:
            logger.error(f"Quick18 {type(e).__name__} {url}: {e}")
            return None
    return None

def normalize_quick18(html: str, course_id: int, date_str: str, time_zone: str = "UTC") -> List[Dict]:
    soup = BeautifulSoup(html, 'html.parser')
    tee_times = []
    
    # Quick18 Matrix Table Logic
    
    # Better: Scan for specific container if known. 
    # In debug output we saw "matrixTable" (camelCase).
    matrix = soup.find(class_=re.compile(r'matrixTable', re.I)) # Case insensitive match
    if matrix:
        
        # Regex for time: 10:52 AM
        time_re = re.compile(r'(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))')
        # Regex for price: $55.00 or 55.00
        price_re = re.compile(r'\$?\s*(\d+\.?\d{2})')

        # Regex for max players from matrixPlayers cell: "1 to 3 players" → 3
        players_re = re.compile(r'(\d+)\s+players?', re.I)

        # Loop rows
        for row in matrix.find_all('tr'):
            text = row.get_text(" ", strip=True)
            # Check if row has time and price
            t_match = time_re.search(text)
            p_match = price_re.search(text)

            if t_match and p_match:
                time_str = t_match.group(1)
                price_str = p_match.group(1)

                # Parse max players from <td class="matrixPlayers"> cell
                # e.g. "1 to 3 players" → spots_available=3
                spots_available = None
                players_cell = row.find(class_=re.compile(r'matrixPlayers', re.I))
                if players_cell:
                    all_nums = players_re.findall(players_cell.get_text(" ", strip=True))
                    if all_nums:
                        spots_available = int(all_nums[-1])  # last number = max

                tee_times.append({
                    "course_id": course_id,
                    "tee_time": f"{date_str} {time_str}",
                    "price": float(price_str),
                    "holes": 18,
                    "available": True,
                    "spots_available": spots_available,
                    "data": {"cart": "Cart" in text}
                })
    
    # Normalize Date/Time to UTC ISO, applying course's local timezone
    local_tz = tz.gettz(time_zone) or tz.tzutc()
    utc_tz = tz.tzutc()
    final_times = []
    for t in tee_times:
        try:
            # Parse "20260221 10:52 AM" as naive local time, then convert to UTC
            dt_naive = datetime.strptime(t['tee_time'], "%Y%m%d %I:%M %p")
            dt_local = dt_naive.replace(tzinfo=local_tz)
            dt_utc = dt_local.astimezone(utc_tz)
            t['tee_time'] = dt_utc.isoformat()
            final_times.append(t)
        except Exception as e:
            logger.error(f"Time Parse Error: {t['tee_time']} - {e}")
            
    # Deduplicate by (tee_time, holes) to avoid ON CONFLICT batch errors
    # Keep the lowest price if duplicates exist
    unique_map = {}
    for t in final_times:
        key = (t['tee_time'], t['holes'])
        if key not in unique_map:
            unique_map[key] = t
        else:
            # If same time exists, keep cheaper one
            if t['price'] < unique_map[key]['price']:
                unique_map[key] = t
                
    return list(unique_map.values())

async def get_active_quick18_targets():
    """ 
    Return a map of {(course_id, date_str): course_obj} that need scanning 
    based on active alerts.
    """
    supabase = await create_supabase()
    
    # 1. Get all active alerts for Quick18
    alerts_res = await (
        supabase.table("alerts")
        .select("date_from, date_to, courses!alerts_course_id_fkey!inner(id, name, provider, time_zone)")
        .eq("active", True)
        .eq("courses.provider", "Quick18")
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
            # Simple handling: assume date_from is enough for now, matching ForeUp logic
            start_dt = datetime.fromisoformat(a["date_from"].replace("Z", "+00:00"))
            date_str = start_dt.strftime("%Y%m%d") # Quick18 format YYYYMMDD
            
            # Use tuple key to ensure uniqueness
            key = (course["id"], date_str)
            targets[key] = course
        except Exception as e:
            logger.error(f"[Quick18] Error parsing alert date {a}: {e}")
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

# Main Service Method called by Job
async def scan_quick18_course(course: Dict, date_str: str):
    course_id = course["id"]

    supabase = await create_supabase()
    config = await get_provider_configs(supabase, course_id)
    base_url = config.get("base_url")

    if not base_url:
        return

    # Use timezone from course dict (fetched via alert join)
    time_zone = course.get("time_zone") or "UTC"

    # date_str passed in is already YYYYMMDD

    async with httpx.AsyncClient() as client:
        html = await fetch_quick18_times(client, base_url, date_str)
        if html:
            times = normalize_quick18(html, course_id, date_str, time_zone)
            scanned_keys = {(t["tee_time"], t["holes"]) for t in times}

            # Diff: fetch existing DB records for this course + date window and remove stale ones
            local_tz = tz.gettz(time_zone) or tz.tzutc()
            utc_tz = tz.tzutc()
            day = datetime.strptime(date_str, "%Y%m%d")
            window_start = day.replace(hour=0, minute=0, second=0, tzinfo=local_tz).astimezone(utc_tz).isoformat()
            window_end = day.replace(hour=23, minute=59, second=59, tzinfo=local_tz).astimezone(utc_tz).isoformat()

            db_res = await (
                supabase.table("availability")
                .select("id, tee_time, holes")
                .eq("course_id", course_id)
                .gte("tee_time", window_start)
                .lte("tee_time", window_end)
                .execute()
            )
            db_map = {(r["tee_time"], r["holes"]): r["id"] for r in db_res.data or []}

            ids_to_remove = [db_id for key, db_id in db_map.items() if key not in scanned_keys]
            if ids_to_remove:
                await supabase.table("availability").delete().in_("id", ids_to_remove).execute()
                logger.info(f"Removed {len(ids_to_remove)} stale times for Quick18 course {course['name']} on {date_str}")

            if times:
                await supabase.table("availability").upsert(
                    times,
                    on_conflict="course_id, tee_time, holes"
                ).execute()
                logger.info(f"Stored {len(times)} times for Quick18 course {course['name']} on {date_str} (tz={time_zone})")
            else:
                logger.info(f"No times found for Quick18 course {course['name']} on {date_str}")

async def run_quick18_scan():
    """
    Fetches targets active alerts and runs the scan for each.
    """
    logger.info("Starting Quick18 global scan (Alert Driven)...")
    try:
        targets = await get_active_quick18_targets()
        
        if not targets:
            logger.info("No active Quick18 alerts found. Skipping scan.")
            return

        logger.info(f"Found {len(targets)} unique (course, date) pairs to scan.")
        
        for (course_id, date_str), course in targets.items():
            # 3. Trigger scan
            try:
                await scan_quick18_course(course, date_str)
            except Exception as e:
                logger.error(f"Error scanning Quick18 course {course['name']}: {e}")
                
        logger.info("Quick18 global scan finished.")
        
    except Exception as e:
        logger.error(f"Global Quick18 Scan Error: {e}")
