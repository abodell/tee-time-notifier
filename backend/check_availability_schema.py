import asyncio
from app.db import create_supabase

async def main():
    supabase = await create_supabase()
    try:
        response = await supabase.table("availability").select("*").limit(1).execute()
        if response.data:
            print("Columns:", response.data[0].keys())
        else:
            print("No data in availability table.")
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
