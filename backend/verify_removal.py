import asyncio
import sys
import os
from datetime import datetime, timedelta, timezone
from dateutil import tz

sys.path.append(os.getcwd())

from app.services.foreup_service import normalize_and_store, run_foreup_scan
from app.db import create_supabase
from app.models.tee_time import TeeTime

async def verify_disappearing_removal():
    supabase = await create_supabase()
    
    # 1. Get a course to test with
    courses = await supabase.table("courses").select("*").eq("provider", "ForeUp").limit(1).execute()
    if not courses.data:
        print("No ForeUp courses found to test with.")
        return
    
    course = courses.data[0]
    course_id = course['id']
    
    # Use tomorrow's date for the test
    test_date = (datetime.now() + timedelta(days=1))
    date_str = test_date.strftime("%m-%d-%Y")

    # 2. Get a valid user_id
    users = await supabase.table("user_profiles").select("id").limit(1).execute()
    if not users.data:
        print("No users found in user_profiles. Cannot create temporary alert.")
        return
    user_id = users.data[0]['id']

    # 3. Insert a "Ghost" tee time (one that won't be in the real scan)
    # 11:59 PM usually safe to assume it won't be in a real scan
    local_tz = tz.gettz(course.get("time_zone")) or tz.tzutc()

    ghost_time_local = test_date.replace(hour=23, minute=59, second=0, microsecond=0, tzinfo=local_tz)
    ghost_time_utc = ghost_time_local.astimezone(timezone.utc)
    
    # Cleanup previous ghost if any
    print(f"Cleaning up previous ghost records for course {course_id}...")
    await (
        supabase.table("availability")
        .delete()
        .eq("course_id", course_id)
        .eq("tee_time", ghost_time_utc.isoformat())
        .execute()
    )

    print(f"Inserting ghost tee time for course {course_id} at {ghost_time_utc.isoformat()}...")
    
    ghost_payload = {
        "course_id": course_id,
        "tee_time": ghost_time_utc.isoformat(),
        "price": 99.99,
        "holes": 18,
        "available": True,
        "data": {"source": "VerificationTest"}
    }
    
    await supabase.table("availability").insert(ghost_payload).execute()
    
    # 4. Create a temporary alert to trigger a scan for this course/date
    print(f"Creating temporary alert for user {user_id} on course {course_id} for {date_str}...")
    
    # Alert range: full day
    date_from = test_date.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    date_to = test_date.replace(hour=23, minute=59, second=59, microsecond=999999).isoformat()
    
    alert_payload = {
        "user_id": user_id,
        "course_id": course_id,
        "holes": 18,
        "date_from": date_from,
        "date_to": date_to,
        "start_time": date_from,
        "end_time": date_to,
        "active": True
    }
    
    alert_res = await supabase.table("alerts").insert(alert_payload).execute()


    alert_id = alert_res.data[0]['id']
    
    try:
        # 4. Run the ForeUp scan
        print("Running ForeUp scan...")
        await run_foreup_scan()
        
        # 5. Verify results
        print("Verifying results...")
        check_res = await (
            supabase.table("availability")
            .select("*")
            .eq("course_id", course_id)
            .eq("tee_time", ghost_time_utc.isoformat())
            .execute()
        )
        
        if not check_res.data:
            print("\n[PASS] Ghost tee time was successfully removed!")
        else:
            print("\n[FAIL] Ghost tee time still exists in the database.")
            
        # Also check if we found real times
        real_times = await (
            supabase.table("availability")
            .select("*")
            .eq("course_id", course_id)
            .execute()
        )
        print(f"Total availability records for this course now: {len(real_times.data)}")

    finally:
        # Cleanup alert
        print("Cleaning up temporary alert...")
        await supabase.table("alerts").delete().eq("id", alert_id).execute()

if __name__ == "__main__":
    asyncio.run(verify_disappearing_removal())
