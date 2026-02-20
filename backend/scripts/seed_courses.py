import asyncio
import json
import os
import sys
from typing import Optional

# Add the parent directory to sys.path so we can import app modules
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

import argparse
from app.db import create_supabase

async def seed_courses(json_file: str, filter_id: Optional[str] = None):
    print(f"Seeding courses from {json_file}...")
    if filter_id:
        print(f"Filtering for Course ID: {filter_id}")
    
    try:
        with open(json_file, "r") as f:
            courses_data = json.load(f)
    except FileNotFoundError:
        print(f"File not found: {json_file}")
        return

    supabase = await create_supabase()
    
    count = 0
    skipped = 0
    for course_item in courses_data:
        configs = course_item.get("configs", {})
        course_id_raw = configs.get("course_id")

        if filter_id and str(course_id_raw) != str(filter_id):
            continue

        # Validate critical configs
        provider = course_item.get("provider", "ForeUp")
        
        if provider == "ForeUp":
            if not configs.get("schedule_id") or not configs.get("booking_class"):
                print(f"Skipping {course_item['name']} - Missing schedule_id or booking_class")
                skipped += 1
                continue
        elif provider == "ChronoGolf":
            if not configs.get("club_id") or not configs.get("course_id"):
                print(f"Skipping {course_item['name']} - Missing club_id or course_id")
                skipped += 1
                continue
            
        provider_url = ""
        if provider == "ForeUp":
            provider_url = f"https://foreupsoftware.com/index.php/booking/{configs['course_id']}"
        elif provider == "ChronoGolf":
            slug = configs.get("slug")
            if slug:
                provider_url = f"https://www.chronogolf.com/club/{slug}#/teetimes?course_id={configs['course_id']}"
            else:
                provider_url = f"https://www.chronogolf.com/marketplace/clubs/{configs['club_id']}/teetimes?course_id={configs['course_id']}"
        elif provider == "Quick18":
            provider_url = f"{configs.get('base_url')}/teetimes/searchmatrix"

        course_payload = {
            "name": course_item["name"],
            "city": course_item["city"],
            "state": course_item["state"],
            "country": "USA",
            "provider": provider,
            "provider_course_id": configs["course_id"],
            "provider_url": provider_url,
            "time_zone": configs.get("timezone") or course_item.get("time_zone"),
            "active": course_item.get("active", True)
        }
        
        # Check if exists by name (simplified for now, ideally unique slug or ID)
        # Using upsert on name if unique constraint exists, or manual check
        # Assuming 'name' might not be unique globally, but for now we'll match on it 
        # or just insert. ForeUp doesn't give us a global UUID, only integer IDs which might vary per provider.
        
        # Let's try to match by name + provider first to avoid duplicates
        existing = await supabase.table("courses") \
            .select("id") \
            .eq("name", course_item["name"]) \
            .eq("provider", provider) \
            .execute()
        
        if existing.data:
            course_id = existing.data[0]["id"]
            # Update?
            await supabase.table("courses").update(course_payload).eq("id", course_id).execute()
            print(f"Updated course: {course_item['name']}")
        else:
            res = await supabase.table("courses").insert(course_payload).execute()
            if not res.data:
                print(f"Failed to insert {course_item['name']}")
                continue
            course_id = res.data[0]["id"]
            print(f"Created course: {course_item['name']}")
            
        # 2. Upsert Configs
        configs = course_item.get("configs", {})
        ALLOWED_CONFIG_KEYS = {
            "booking_class", "schedule_id", "schedule_ids", "api_key", # ForeUp
            "club_id", "course_id", "affiliation_id", "nb_holes", "timezone", "slug", # ChronoGolf
            "base_url", "provider_type" # Quick18
        }
        
        if configs:
            config_rows = []
            for key, value in configs.items():
                if value is None: 
                    continue
                if key not in ALLOWED_CONFIG_KEYS:
                    continue
                    
                config_rows.append({
                    "course_id": course_id,
                    "provider": provider,
                    "key": key,
                    "value": str(value)
                })
            
            # Delete existing configs to be safe (full replace)
            await supabase.table("provider_configs").delete().eq("course_id", course_id).execute()
            
            # Insert new
            if config_rows:
                await supabase.table("provider_configs").insert(config_rows).execute()
                
        count += 1

    print(f"Seeding complete. Processed {count} courses.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed courses from JSON to Supabase")
    parser.add_argument("file", nargs="?", default="backend/seeds/courses.json", help="JSON file to seed")
    parser.add_argument("--id", help="Only seed course with this provider course ID")
    
    args = parser.parse_args()
    
    asyncio.run(seed_courses(args.file, args.id))
