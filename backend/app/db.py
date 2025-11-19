import os
from supabase import create_async_client, AsyncClient
import asyncio
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

async def create_supabase() -> AsyncClient:
    return await create_async_client(
        SUPABASE_URL,
        SUPABASE_KEY,
    )