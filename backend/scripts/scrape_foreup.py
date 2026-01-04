import asyncio
import argparse
import re
import json
import httpx
import os
import random
from typing import Optional, Dict
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable
from timezonefinder import TimezoneFinder

# Regex patterns
COURSE_PATTERN = re.compile(r"COURSE\s*=\s*(\{.*?\});", re.DOTALL)
DEFAULT_FILTER_PATTERN = re.compile(r"DEFAULT_FILTER\s*=\s*(\{.*?\});")
API_KEY_PATTERN = re.compile(r"API_KEY\s*=\s*['\"](.*?)['\"];")
SCHEDULES_PATTERN = re.compile(r"SCHEDULES\s*=\s*(\[.*?\]);", re.DOTALL)

# Globals for Geocoding
geolocator = Nominatim(user_agent="tee-time-notifier-scraper")
tf = TimezoneFinder()
TIMEZONE_CACHE_FILE = "backend/seeds/timezone_cache.json"
timezone_cache = {}

def load_timezone_cache():
    global timezone_cache
    if os.path.exists(TIMEZONE_CACHE_FILE):
        try:
            with open(TIMEZONE_CACHE_FILE, "r") as f:
                timezone_cache = json.load(f)
            print(f"Loaded {len(timezone_cache)} entries from timezone cache.")
        except Exception as e:
            print(f"Error loading timezone cache: {e}")

def save_timezone_cache():
    try:
        with open(TIMEZONE_CACHE_FILE, "w") as f:
            json.dump(timezone_cache, f, indent=2)
        print("Saved timezone cache.")
    except Exception as e:
        print(f"Error saving timezone cache: {e}")

def get_real_timezone(city: str, state: str, default_tz: str) -> str:
    """
    Resolve timezone from City, State using Geocoding + TimezoneFinder.
    Uses generic cache to avoid rate limits.
    """
    if not city or not state:
        return default_tz
    
    key = f"{city.strip().lower()}|{state.strip().lower()}"
    if key in timezone_cache:
        return timezone_cache[key]

    # Rate limiting sleep (1s per request as per Nominatim policy)
    # We'll sleep internally here, but remember we are calling this from async loop? 
    # Actually geopy is synchronous, so this blocks the worker. 
    # Since we have concurrency, we should be careful. 
    # However, since we want to be nice to Nominatim, we probably SHOULD block 
    # or handle this better. 
    # For now, let's just try.
    
    query = f"{city}, {state}, USA"
    for attempt in range(3):
        try:
            # Increase timeout and add random jitter for retries
            if attempt > 0:
                import time
                time.sleep(random.uniform(1.0, 2.0))
            
            location = geolocator.geocode(query, timeout=10)
            if location:
                tz_str = tf.timezone_at(lng=location.longitude, lat=location.latitude)
                if tz_str:
                    timezone_cache[key] = tz_str
                    return tz_str
        except (GeocoderTimedOut, GeocoderUnavailable) as e:
            print(f"Geocoding error for {query} (attempt {attempt+1}): {e}")
        except Exception as e:
            print(f"Unexpected geocoding error: {e}")
            break

    # Fallback - DO NOT CACHE FAILURE
    # timezone_cache[key] = default_tz 
    return default_tz


async def fetch_booking_page(client: httpx.AsyncClient, course_id: int) -> Optional[str]:
    url = f"https://foreupsoftware.com/index.php/booking/{course_id}"
    try:
        # Random sleep to avoid hammering heavily if we scale up too much
        await asyncio.sleep(random.uniform(0.1, 0.3)) 
        response = await client.get(url, timeout=15.0, follow_redirects=True)
        if response.status_code == 200:
            return response.text
        return None
    except Exception as e:
        # print(f"Error fetching {url}: {e}")
        return None

def parse_html(html: str, course_id: int) -> Optional[Dict]:
    course_match = COURSE_PATTERN.search(html)
    if not course_match:
        return None
    
    try:
        course_data = json.loads(course_match.group(1))
    except json.JSONDecodeError:
        return None

    if not course_data.get("name"):
        return None

    # Defaults
    schedule_id = None
    booking_class = None
    api_key = "no_limits"

    filter_match = DEFAULT_FILTER_PATTERN.search(html)
    if filter_match:
        try:
            filter_data = json.loads(filter_match.group(1))
            schedule_id = filter_data.get("schedule_id")
        except: pass
            
    collected_schedule_ids = set()
    if schedule_id:
        collected_schedule_ids.add(int(schedule_id))

    schedules_match = SCHEDULES_PATTERN.search(html)
    if schedules_match:
        try:
            schedules_data = json.loads(schedules_match.group(1))
            if schedules_data and isinstance(schedules_data, list):
                # 1. Collect all schedule IDs
                for sched in schedules_data:
                    sid = sched.get("teesheet_id") or sched.get("id") or sched.get("schedule_id")
                    if sid:
                        collected_schedule_ids.add(int(sid))

                # 2. Extract booking class (existing logic)
                classes = schedules_data[0].get("booking_classes", [])
                public_class = next((c for c in classes if "public" in c.get("name", "").lower()), None)
                guest_class = next((c for c in classes if "guest" in c.get("name", "").lower()), None)
                target_class = public_class or guest_class or (classes[0] if classes else None)
                if target_class:
                    booking_class = target_class.get("booking_class_id")
        except: pass
    
    api_key_match = API_KEY_PATTERN.search(html)
    if api_key_match:
        api_key = api_key_match.group(1)

    # Convert set to sorted list for deterministic output
    schedule_ids_str = json.dumps(sorted(list(collected_schedule_ids)))
    
    # Timezone fix
    city = course_data.get("city")
    state = course_data.get("state")
    raw_tz = course_data.get("timezone", "UTC")
    
    # We ideally want to geocode, but geopy calls are sync. 
    # If we call this here, it will block the async loop if we are not careful.
    # But since this is CPU bound parsing function, we can just call it.
    # Wait, geopy does network IO. It WILL block. 
    # To avoid blocking the event loop, we should ideally run it in an executor, 
    # OR since we are just a script, maybe blocking is "okay" as long as we don't starve?
    # BUT we want to speed up scraping.
    # Let's keep it simple: We allow it to block the thread, but since we use semaphores,
    # we might slow down. 
    # ACTUALLY: Let's defer geocoding to a quick check or just accept the tiny block. 
    # We are scraping 10 at a time. Blocking one blocks all (GIL/Single thread).
    # To fix this properly: run_in_executor.
    
    return {
        "name": course_data.get("name"),
        "address": f"{course_data.get('address', '')}, {course_data.get('city', '')}, {course_data.get('state', '')} {course_data.get('zip', '')}".strip(" ,"),
        "city": city,
        "state": state,
        "website": course_data.get("website"),
        "phone": course_data.get("phone"),
        "provider": "ForeUp",
        "active": True,
        "configs": {
            "course_id": str(course_id),
            "schedule_id": str(schedule_id) if schedule_id else None,
            "schedule_ids": schedule_ids_str,
            "booking_class": str(booking_class) if booking_class else None,
            "api_key": api_key,
            "timezone": raw_tz # Placeholder, will update later or inside here?
        }
    }

# Lock for geocoding to strictly enforce rate limits
GEOCODE_LOCK = asyncio.Lock()

async def get_real_timezone_safe(city: str, state: str, default_tz: str) -> str:
    """
    Async wrapper that acquires a lock and enforces sleep to respect Nominatim's rate limit.
    """
    async with GEOCODE_LOCK:
        # Check cache first (redundant check but safe inside lock)
        key = f"{city.strip().lower()}|{state.strip().lower()}"
        if key in timezone_cache:
            return timezone_cache[key]
            
        loop = asyncio.get_running_loop()
        # Sleep to respect 1 req/sec rate limit
        await asyncio.sleep(1.1)
        
        # Run blocking geocode in executor
        return await loop.run_in_executor(
            None, 
            get_real_timezone, 
            city, 
            state, 
            default_tz
        )

async def process_course(client: httpx.AsyncClient, course_id: int, sem: asyncio.Semaphore) -> Optional[Dict]:
    async with sem:
        html = await fetch_booking_page(client, course_id)
        if not html:
            return None
            
        data = parse_html(html, course_id)
        if not data:
            return None
            
        # Post-process timezone with Geocoding (safe rate-limited)
        real_tz = await get_real_timezone_safe(
            data["city"], 
            data["state"], 
            data["configs"]["timezone"]
        )
        data["configs"]["timezone"] = real_tz
        
        print(f"[{course_id}] Found: {data['name']} ({real_tz})")
        return data

async def scrape_range(start_id: int, end_id: int, output_file: str):
    load_timezone_cache()
    
    # 10 concurrent requests
    sem = asyncio.Semaphore(10)
    tasks = []
    
    print(f"Scraping ForeUp courses from ID {start_id} to {end_id} with concurrency=10...")
    
    async with httpx.AsyncClient() as client:
        for cid in range(start_id, end_id + 1):
            tasks.append(process_course(client, cid, sem))
        
        # Gather results
        raw_results = await asyncio.gather(*tasks)
    
    results = [r for r in raw_results if r]
    print(f"\nFound {len(results)} courses.")
    
    # Save cache
    save_timezone_cache()

    # Load existing if file exists
    existing = []
    try:
        with open(output_file, "r") as f:
            existing = json.load(f)
    except FileNotFoundError:
        pass
    
    # Merge (upsert/replace by course_id)
    merged_map = {c["configs"]["course_id"]: c for c in existing}
    
    new_count = 0
    updated_count = 0
    for r in results:
        cid = r["configs"]["course_id"]
        if cid not in merged_map:
            new_count += 1
        else:
            updated_count += 1
        merged_map[cid] = r
            
    final_list = list(merged_map.values())
            
    with open(output_file, "w") as f:
        json.dump(final_list, f, indent=2)
    
    print(f"Saved {len(final_list)} courses ({new_count} new, {updated_count} updated) to {output_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape ForeUp course data")
    parser.add_argument("--start", type=int, required=True, help="Start Course ID")
    parser.add_argument("--end", type=int, required=True, help="End Course ID")
    parser.add_argument("--out", type=str, default="backend/seeds/courses.json", help="Output JSON file")
    
    args = parser.parse_args()
    
    asyncio.run(scrape_range(args.start, args.end, args.out))
