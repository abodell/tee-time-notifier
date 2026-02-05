import asyncio
from app.db import create_supabase

async def check_notifications():
    supabase = await create_supabase()
    print("--- alert_notifications Table ---")
    
    # 1. Check schema
    res = await supabase.table("alert_notifications").select("*").limit(1).execute()
    if res.data:
        print("Columns:", res.data[0].keys())
    else:
        print("No records found in alert_notifications.")
        
    # 2. Check recent notifications
    recent = await supabase.table("alert_notifications").select("*").order("sent_at", desc=True).limit(10).execute()
    print("\nRecent Notifications:")
    for r in recent.data or []:
        print(f"ID: {r.get('id')}, Alert: {r.get('alert_id')}, Availability: {r.get('availability_id')}, Sent: {r.get('sent_at')}")

if __name__ == "__main__":
    asyncio.run(check_notifications())
