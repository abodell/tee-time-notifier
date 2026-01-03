import asyncio
import argparse
import re
import json
import httpx
from typing import Optional, Dict

# Regex patterns to find global variables in the HTML
COURSE_PATTERN = re.compile(r"COURSE\s*=\s*(\{.*?\});", re.DOTALL)
DEFAULT_FILTER_PATTERN = re.compile(r"DEFAULT_FILTER\s*=\s*(\{.*?\});")
API_KEY_PATTERN = re.compile(r"API_KEY\s*=\s*['\"](.*?)['\"];")
SCHEDULES_PATTERN = re.compile(r"SCHEDULES\s*=\s*(\[.*?\]);", re.DOTALL)

async def fetch_booking_page(client: httpx.AsyncClient, course_id: int) -> Optional[str]:
    url = f"https://foreupsoftware.com/index.php/booking/{course_id}"
    try:
        response = await client.get(url, timeout=10.0, follow_redirects=True)
        if response.status_code == 200:
            return response.text
        return None
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def parse_html(html: str, course_id: int) -> Optional[Dict]:
    # Extract COURSE object
    course_match = COURSE_PATTERN.search(html)
    if not course_match:
        return None
    
    try:
        course_data = json.loads(course_match.group(1))
    except json.JSONDecodeError:
        print(f"[{course_id}] Failed to parse COURSE JSON")
        return None

    # check if valid course
    if not course_data.get("name"):
        return None

    # Extract DEFAULT_FILTER for schedule_id default
    schedule_id = None
    filter_match = DEFAULT_FILTER_PATTERN.search(html)
    if filter_match:
        try:
            filter_data = json.loads(filter_match.group(1))
            schedule_id = filter_data.get("schedule_id")
        except:
            pass
            
    # Extract Booking Class from SCHEDULES
    booking_class = None
    schedules_match = SCHEDULES_PATTERN.search(html)
    if schedules_match:
        try:
            schedules_data = json.loads(schedules_match.group(1))
            if schedules_data and isinstance(schedules_data, list):
                # Try to find 'booking_classes' in the first schedule
                classes = schedules_data[0].get("booking_classes", [])
                
                # Priority: "Public" -> "Guest" -> First available
                public_class = next((c for c in classes if "public" in c.get("name", "").lower()), None)
                guest_class = next((c for c in classes if "guest" in c.get("name", "").lower()), None)
                
                target_class = public_class or guest_class or (classes[0] if classes else None)
                
                if target_class:
                    booking_class = target_class.get("booking_class_id")
        except json.JSONDecodeError:
            print(f"[{course_id}] Failed to parse SCHEDULES JSON")
    
    # Extract API_KEY
    api_key = "no_limits"
    api_key_match = API_KEY_PATTERN.search(html)
    if api_key_match:
        api_key = api_key_match.group(1)

    # Format schedule_ids as a stringified list [id]
    schedule_ids_str = json.dumps([int(schedule_id)]) if schedule_id else "[]"

    # Construct clean object
    return {
        "name": course_data.get("name"),
        "address": f"{course_data.get('address', '')}, {course_data.get('city', '')}, {course_data.get('state', '')} {course_data.get('zip', '')}".strip(" ,"),
        "city": course_data.get("city"),
        "state": course_data.get("state"),
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
            "timezone": course_data.get("timezone", "UTC")
        }
    }

async def scrape_range(start_id: int, end_id: int, output_file: str):
    results = []
    print(f"Scraping ForeUp courses from ID {start_id} to {end_id}...")
    
    async with httpx.AsyncClient() as client:
        for cid in range(start_id, end_id + 1):
            html = await fetch_booking_page(client, cid)
            if html:
                data = parse_html(html, cid)
                if data:
                    print(f"[{cid}] Found: {data['name']}")
                    results.append(data)
                else:
                    print(f"[{cid}] Invalid/Empty data")
            else:
                print(f"[{cid}] 404/Error")
            
            # Be nice to the server
            await asyncio.sleep(0.5)

    print(f"\nFound {len(results)} courses.")
    
    # Load existing if file exists
    existing = []
    try:
        with open(output_file, "r") as f:
            existing = json.load(f)
    except FileNotFoundError:
        pass
    
    # Merge (upsert/replace by course_id)
    # Create a dict of existing {course_id: course_obj}
    merged_map = {c["configs"]["course_id"]: c for c in existing}
    
    # Update/Add new results
    new_count = 0
    updated_count = 0
    for r in results:
        cid = r["configs"]["course_id"]
        if cid not in merged_map:
            new_count += 1
        else:
            updated_count += 1
        merged_map[cid] = r
            
    # Convert back to list
    final_list = list(merged_map.values())
            
    with open(output_file, "w") as f:
        json.dump(final_list, f, indent=2)
    
    print(f"Saved {len(final_list)} courses ({new_count} new, {updated_count} updated) to {output_file}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape ForeUp course data")
    parser.add_argument("--start", type=int, required=True, help="Start Course ID")
    parser.add_argument("--end", type=int, required=True, help="End Course ID")
    parser.add_argument("--out", type=str, default="seeds/courses.json", help="Output JSON file")
    
    args = parser.parse_args()
    
    asyncio.run(scrape_range(args.start, args.end, args.out))
