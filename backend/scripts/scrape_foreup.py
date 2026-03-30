import asyncio
import argparse
import re
import json
import httpx
import os
import random
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Set, Tuple
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable
from timezonefinder import TimezoneFinder

# Regex patterns
COURSE_PATTERN = re.compile(r"COURSE\s*=\s*(\{.*?\});", re.DOTALL)
DEFAULT_FILTER_PATTERN = re.compile(r"DEFAULT_FILTER\s*=\s*(\{.*?\});")
API_KEY_PATTERN = re.compile(r"API_KEY\s*=['\"](.+?)['\"];")
SCHEDULES_PATTERN = re.compile(r"SCHEDULES\s*=\s*(\[.*?\]);", re.DOTALL)

async def fetch_times_for_validation(client: httpx.AsyncClient, course_id: int, schedule_id: int, booking_class: int) -> List[Dict]:
    """
    Fetch tee times for a schedule to validate prices and start times.
    Checks today and tomorrow to ensure we get some data.
    """
    days_to_check = [
        datetime.now().strftime("%m-%d-%Y"),
        (datetime.now() + timedelta(days=1)).strftime("%m-%d-%Y")
    ]
    
    all_times = []
    for date_str in days_to_check:
        url = f"https://foreupsoftware.com/index.php/api/booking/times"
        params = {
            "time": "all",
            "date": date_str,
            "holes": "all",
            "players": "0",
            "booking_class": str(booking_class),
            "schedule_id": str(schedule_id),
            "specials_only": "0",
            "api_key": "no_limits"
        }
        try:
            # Random jitter to avoid hammering
            await asyncio.sleep(random.uniform(0.1, 0.3))
            resp = await client.get(url, params=params, timeout=10.0)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    all_times.extend(data)
                    # If we found times for today, we can stop
                    if len(data) > 0:
                        break
        except Exception:
            pass
            
    return all_times


# Known course name keywords for multi-course facilities
COURSE_KEYWORDS = [
    "black", "blue", "red", "yellow", "green", "white", "gold", "silver",
    "north", "south", "east", "west",
    "front", "back",
    "championship", "executive", "par 3",
    "lake", "mountain", "valley", "river", "ocean", "links",
]


def extract_core_course_name(title: str, facility_name: str) -> str:
    """
    Extract the core course name from a schedule title.
    
    Examples:
        "Bethpage Blue Course" -> "blue"
        "Bethpage Early AM 9 Holes Blue" -> "blue"
        "Lido Golf Course" -> "default"
    
    Returns "default" if no distinct course identifier found.
    """
    if not title:
        return "default"
    
    title_lower = title.lower()
    facility_lower = facility_name.lower() if facility_name else ""
    
    # Remove facility name prefix if present
    if facility_lower and title_lower.startswith(facility_lower):
        title_lower = title_lower[len(facility_lower):].strip()
    
    # Remove common suffixes/prefixes that don't indicate different courses
    noise_patterns = [
        r'\b\d+\s*holes?\b',      # "18 holes", "9 hole"
        r'\bearly\s*am\b',         # "early am"
        r'\btwilight\b',           # "twilight"
        r'\bweekend\b',            # "weekend"
        r'\bweekday\b',            # "weekday"
        r'\bsenior\b',             # "senior"
        r'\bjunior\b',             # "junior"
        r'\bresident\b',           # "resident"
        r'\bnon[- ]?resident\b',   # "non-resident"
        r'\bcourse\b',             # "course"
        r'\bgolf\b',               # "golf"
    ]
    
    cleaned = title_lower
    for pattern in noise_patterns:
        cleaned = re.sub(pattern, '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    
    # Check for known course keywords
    for keyword in COURSE_KEYWORDS:
        if keyword in cleaned or keyword in title_lower:
            return keyword
    
    return "default"


def select_best_booking_class(schedules: List[Dict]) -> Optional[str]:
    """
    Extract best valid booking class from a list of schedules.
    Prioritizes: Unblocked > 18 Holes > Public/Guest/Non-Resident > First Available
    """
    all_classes = []
    
    for sched in schedules:
        sched_classes = sched.get("booking_classes", [])
        for bc in sched_classes:
            name = bc.get("name", "").lower()
            raw_protected = bc.get("online_booking_protected", "1")
            is_protected = str(raw_protected) == "1"
            
            all_classes.append({
                "id": bc.get("booking_class_id"),
                "name": name,
                "protected": is_protected
            })
    
    if not all_classes:
        return None
    
    # Filter for unblocked first
    unblocked = [c for c in all_classes if not c["protected"]]
    
    if not unblocked:
        return None  # No unblocked classes available
    
    # 1. Unblocked 18-hole
    bc_18 = next((c for c in unblocked if "18" in c["name"]), None)
    if bc_18:
        return bc_18["id"]
    
    # 2. Unblocked Public/Guest/Non-Resident
    bc_public = next((c for c in unblocked if any(k in c["name"] for k in ["public", "guest", "non-resident", "non resident"])), None)
    if bc_public:
        return bc_public["id"]
    
    # 3. First unblocked
    return unblocked[0]["id"]


# Globals for Geocoding
geolocator = Nominatim(user_agent="tee-time-notifier-scraper")
tf = TimezoneFinder()
TIMEZONE_CACHE_FILE = "backend/seeds/timezone_cache.json"
timezone_cache = {}
TZ_MAPPING = {
    "Etc/GMT+10": "Pacific/Honolulu"
}


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
    """
    if not city or not state:
        return default_tz
    
    key = f"{city.strip().lower()}|{state.strip().lower()}"
    if key in timezone_cache:
        return timezone_cache[key]

    query = f"{city}, {state}, USA"
    for attempt in range(3):
        try:
            if attempt > 0:
                import time
                time.sleep(random.uniform(1.0, 2.0))
            
            location = geolocator.geocode(query, timeout=10)
            if location:
                tz_str = tf.timezone_at(lng=location.longitude, lat=location.latitude)
                if tz_str:
                    timezone_cache[key] = tz_str
                    return tz_str
        except Exception as e:
            print(f"Geocoding error for {query}: {e}")
            break

    return TZ_MAPPING.get(default_tz, default_tz)


async def fetch_booking_page(client: httpx.AsyncClient, course_id: int) -> Optional[str]:
    url = f"https://foreupsoftware.com/index.php/booking/{course_id}"
    try:
        await asyncio.sleep(random.uniform(0.1, 0.3)) 
        response = await client.get(url, timeout=15.0, follow_redirects=True)
        if response.status_code == 200:
            return response.text
        return None
    except Exception:
        return None


async def validate_unblocked_schedules(client: httpx.AsyncClient, course_id: int, schedules: List[Dict], facility_name: str) -> List[Dict]:
    """
    Validate unblocked schedules via API, filter out $0 price sheets.
    Returns many entries if multiple valid schedules exist.
    """
    valid_pools = []
    
    for sched in schedules:
        # 1. Get best unblocked booking class for THIS schedule
        booking_class = select_best_booking_class([sched])
        if not booking_class:
            continue
            
        schedule_id_val = sched.get("teesheet_id") or sched.get("id") or sched.get("schedule_id")
        if not schedule_id_val:
            continue
        schedule_id = int(schedule_id_val)
            
        # 2. Fetch times for validation
        times = await fetch_times_for_validation(client, course_id, schedule_id, int(booking_class))
        
        # 3. Price Validation Logic
        if times:
            first_time = times[0]
            green_fee = float(first_time.get("green_fee", 0) or 0)
            green_fee_18 = float(first_time.get("green_fee_18", 0) or 0)
            
            if green_fee <= 0 and green_fee_18 <= 0:
                continue

        # 4. Add as a separate entry
        valid_pools.append({
            "schedule_id": schedule_id,
            "booking_class": booking_class,
            "title": sched.get("title", ""),
            "holes": str(sched.get("holes", "18")),
            "all_ids": {schedule_id}
        })

    return valid_pools


async def parse_html(client: httpx.AsyncClient, html: str, course_id: int) -> Optional[List[Dict]]:
    """
    Parse HTML and return a list of course entries.
    Creates one entry per valid, unblocked schedule_id.
    """
    course_match = COURSE_PATTERN.search(html)
    if not course_match:
        return None
    
    try:
        course_data = json.loads(course_match.group(1))
    except json.JSONDecodeError:
        return None

    facility_name = course_data.get("name")
    if not facility_name:
        return None

    # Extract API key
    api_key = "no_limits"
    api_key_match = API_KEY_PATTERN.search(html)
    if api_key_match:
        api_key = api_key_match.group(1)

    # Common course info
    base_info = {
        "address": f"{course_data.get('address', '')}, {course_data.get('city', '')}, {course_data.get('state', '')} {course_data.get('zip', '')}".strip(" ,"),
        "city": course_data.get("city"),
        "state": course_data.get("state"),
        "website": course_data.get("website"),
        "phone": course_data.get("phone"),
        "provider": "ForeUp",
        "active": True,
        "raw_timezone": course_data.get("timezone", "UTC"),
    }

    # Parse SCHEDULES data
    schedules_match = SCHEDULES_PATTERN.search(html)
    if not schedules_match:
        return None
        
    try:
        schedules_data = json.loads(schedules_match.group(1))
        if not isinstance(schedules_data, list):
            return None
    except:
        return None

    # Validate unblocked schedules (includes price check)
    validated_pools = await validate_unblocked_schedules(client, course_id, schedules_data, facility_name)
    
    if not validated_pools:
        return None

    # Determine if we need suffixes (if multiple valid schedules exist)
    needs_suffix = len(validated_pools) > 1
    
    results = []
    for pool in validated_pools:
        if needs_suffix:
            # Clean up title if it repeats the facility name
            title = pool["title"]
            if facility_name.lower() in title.lower():
                # Try to extract the core name or just use the title as is if clean
                core = extract_core_course_name(title, facility_name)
                if core != "default":
                    course_name = f"{facility_name} - {core.title()} ({pool['title']})"
                else:
                    course_name = f"{facility_name} - {pool['title']}"
            else:
                course_name = f"{facility_name} - {pool['title']}"
        else:
            course_name = facility_name
            
        course_entry = {
            "name": course_name,
            **base_info,
            "configs": {
                "course_id": str(course_id),
                "schedule_id": str(pool["schedule_id"]),
                "schedule_ids": json.dumps(sorted(list(pool["all_ids"]))),
                "booking_class": str(pool["booking_class"]),
                "api_key": api_key,
                "timezone": base_info["raw_timezone"]
            }
        }
        # Delete internal field
        if "raw_timezone" in course_entry:
            del course_entry["raw_timezone"]
        results.append(course_entry)
        
    return results




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

async def process_course(client: httpx.AsyncClient, course_id: int, sem: asyncio.Semaphore) -> Optional[List[Dict]]:
    """Process a single ForeUp course ID and return a list of course entries."""
    async with sem:
        html = await fetch_booking_page(client, course_id)
        if not html:
            return None
            
        courses = await parse_html(client, html, course_id)
        if not courses:
            return None
        
        # Post-process timezone with Geocoding for each course entry
        for course in courses:
            real_tz = await get_real_timezone_safe(
                course["city"], 
                course["state"], 
                course["configs"]["timezone"]
            )
            course["configs"]["timezone"] = real_tz
            print(f"[{course_id}] Found: {course['name']} ({real_tz})")
        
        return courses



async def scrape_range(start_id: int, end_id: int, output_file: str):
    load_timezone_cache()
    
    # 10 concurrent requests
    sem = asyncio.Semaphore(10)
    tasks = []
    
    print(f"Scraping ForeUp courses from ID {start_id} to {end_id} with concurrency=10...")
    
    async with httpx.AsyncClient() as client:
        for cid in range(start_id, end_id + 1):
            tasks.append(process_course(client, cid, sem))
        
        # Gather results (each result is a list of courses or None)
        raw_results = await asyncio.gather(*tasks)
    
    # Flatten results: each raw_result is a list of course dicts
    results = []
    for course_list in raw_results:
        if course_list:
            results.extend(course_list)
    
    print(f"\nFound {len(results)} course entries.")
    
    # Save cache
    save_timezone_cache()

    # Load existing if file exists
    existing = []
    try:
        with open(output_file, "r") as f:
            existing = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    
    # Use composite key (course_id + schedule_id) for merging
    # This allows multi-course facilities to have separate entries
    def get_merge_key(course: Dict) -> str:
        configs = course.get("configs", {})
        if "course_id" not in configs:
            return f"name:{course.get('name', 'unknown')}"
        cid = configs["course_id"]
        sid = configs.get("schedule_id") or "none"
        return f"{cid}:{sid}"
    
    merged_map = {get_merge_key(c): c for c in existing}
    
    new_count = 0
    updated_count = 0
    for r in results:
        key = get_merge_key(r)
        if key not in merged_map:
            new_count += 1
        else:
            updated_count += 1
        merged_map[key] = r
            
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
