import asyncio
import json
import os
import sys

# Add the parent directory to sys.path so we can import app modules
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from app.db import create_supabase

async def seed_courses(json_file: str):
    print(f"Seeding courses from {json_file}...")
    
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
        # Validate critical configs
        configs = course_item.get("configs", {})
        schedule_id = configs.get("schedule_id")
        booking_class = configs.get("booking_class")
        
        if "demo" in course_item["name"].lower():
            print(f"Skipping {course_item['name']} - Demo course")
            skipped += 1
            continue

        if not schedule_id or not booking_class:
            print(f"Skipping {course_item['name']} - Missing schedule_id or booking_class")
            skipped += 1
            continue
            
        # 1. Upsert Course
        course_payload = {
            "name": course_item["name"],
            # address column doesn't exist in courses table
            "city": course_item["city"],
            "state": course_item["state"],
            "country": "USA", # Defaulting to USA as ForeUp is primarily US
            "provider": course_item["provider"],
            "provider_course_id": configs["course_id"],
            "provider_url": f"https://foreupsoftware.com/index.php/booking/{configs['course_id']}",
            "time_zone": configs.get("timezone"),
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
            .eq("provider", "ForeUp") \
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
        ALLOWED_CONFIG_KEYS = {"booking_class", "schedule_id", "schedule_ids", "api_key"}
        
        if configs:
            config_rows = []
            for key, value in configs.items():
                if value is None: 
                    continue
                if key not in ALLOWED_CONFIG_KEYS:
                    continue
                    
                config_rows.append({
                    "course_id": course_id,
                    "provider": "ForeUp",
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
    if len(sys.argv) > 1:
        json_file = sys.argv[1]
    else:
        json_file = "backend/seeds/courses.json"
        
    asyncio.run(seed_courses(json_file))
