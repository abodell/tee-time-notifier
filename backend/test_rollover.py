import asyncio
from datetime import datetime, timezone, timedelta
import zoneinfo
from app.db import create_supabase

async def test_180():
    supabase = await create_supabase()
    res = await supabase.table("alerts").select("*, courses!alerts_course_id_fkey(time_zone)").eq("id", 180).execute()
    if not res.data:
        print("Alert 180 not found!")
        return
        
    alert = res.data[0]
    print(f"Original:")
    print(f"  date_from:  {alert['date_from']}")
    print(f"  date_to:    {alert['date_to']}")
    print(f"  start_time: {alert['start_time']}")
    print(f"  end_time:   {alert['end_time']}")
    
    tz_str = alert.get("courses", {}).get("time_zone", "UTC")
    tz = zoneinfo.ZoneInfo(tz_str)
    
    def add_7_days_local(iso_str):
        if not iso_str: return None
        dt_utc = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        if dt_utc.tzinfo is None:
            dt_utc = dt_utc.replace(tzinfo=timezone.utc)
        dt_local = dt_utc.astimezone(tz)
        dt_next_week = dt_local + timedelta(days=7)
        return dt_next_week.astimezone(timezone.utc).isoformat()
        
    def add_168_hours_utc(iso_str):
        if not iso_str: return None
        dt_utc = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        if dt_utc.tzinfo is None:
            dt_utc = dt_utc.replace(tzinfo=timezone.utc)
        dt_next_utc = dt_utc + timedelta(days=7)
        return dt_next_utc.isoformat()

    new_date_from = add_168_hours_utc(alert.get("date_from"))
    new_date_to = add_168_hours_utc(alert.get("date_to"))
    new_start = add_7_days_local(alert.get("start_time"))
    new_end = add_7_days_local(alert.get("end_time"))
    
    print(f"\nRolled (Next Week) [TZ: {tz_str}]:")
    print(f"  date_from:  {new_date_from}")
    print(f"  date_to:    {new_date_to}")
    print(f"  start_time: {new_start}")
    print(f"  end_time:   {new_end}")
    
    # We can also insert it if we want
    new_payload = {
        "user_id": alert["user_id"],
        "course_id": alert["course_id"],
        "holes": alert["holes"],
        "date_from": new_date_from,
        "date_to": new_date_to,
        "start_time": new_start,
        "end_time": new_end,
        "is_recurring": False,
        "active": False
    }
    insert_res = await supabase.table("alerts").insert(new_payload).execute()
    print(f"\nInserted test alert ID: {insert_res.data[0]['id']}")

asyncio.run(test_180())
