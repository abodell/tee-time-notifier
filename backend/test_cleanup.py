import asyncio
import sys
import os
from datetime import datetime, timedelta, timezone

sys.path.append(os.getcwd())

from app.scheduler.jobs import cleanup_old_availability_job
from app.db import create_supabase

async def seed_stale_data():
    supabase = await create_supabase()
    print("Seeding stale data...")
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    
    # Insert a dummy record with a past tee_time
    # We need a valid course_id, let's pick one from the DB or assume 1 exists
    # If 1 doesn't exist this might fail, but we'll try to find one first
    courses = await supabase.table("courses").select("id").limit(1).execute()
    if not courses.data:
        print("No courses found, skipping test seed.")
        return

    course_id = courses.data[0]['id']
    
    payload = {
        "course_id": course_id,
        "tee_time": yesterday,
        "price": 50,
        "holes": 18,
        "available": True,
        "data": {"source": "Test"},
    }
    
    await supabase.table("availability").upsert(payload).execute()
    print(f"Propagated stale record for course {course_id} at {yesterday}")

async def main():
    await seed_stale_data()
    print("Testing cleanup_old_availability_job()...")
    await cleanup_old_availability_job()
    print("Test complete.")

if __name__ == "__main__":
    asyncio.run(main())
