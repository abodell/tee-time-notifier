import asyncio
from app.db import create_supabase

async def check_constraints():
    supabase = await create_supabase()
    # Query information_schema for constraints on alert_notifications
    sql = """
    SELECT
        tc.constraint_name, 
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
    FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints AS rc
          ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'alert_notifications';
    """
    # Supabase Python client doesn't support raw SQL easily unless we have a function
    # Let's try to just check if availability_id still exists for old notifications
    
    print("Checking for orphaned notifications...")
    res = await supabase.table("alert_notifications").select("id, availability_id").limit(10).execute()
    for row in res.data or []:
        avail_id = row['availability_id']
        avail_check = await supabase.table("availability").select("id").eq("id", avail_id).execute()
        if not avail_check.data:
            print(f"Notification {row['id']} points to MISSING availability {avail_id}")
        else:
            print(f"Notification {row['id']} points to VALID availability {avail_id}")

if __name__ == "__main__":
    asyncio.run(check_constraints())
