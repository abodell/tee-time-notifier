"""
test_player_counts.py — One-off diagnostic to discover which provider APIs
expose a player/spot count field in their raw tee-time responses.

Usage (from backend/):
    python scripts/test_player_counts.py

Auto-discovers one active course per provider from the DB.
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta

# Allow imports from app/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from app.db import create_supabase

# Date to scan (defaults to tomorrow)
SCAN_DATE = (datetime.today() + timedelta(days=1)).strftime("%Y-%m-%d")

async def find_course_for_provider(supabase, provider: str) -> dict | None:
    """Return the first course for the given provider from the courses table."""
    res = await (
        supabase.table("courses")
        .select("id, name, provider, time_zone")
        .eq("provider", provider)
        .limit(1)
        .execute()
    )
    return (res.data or [None])[0]


def print_section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)


def inspect_item(item: dict, provider: str):
    """Print full raw item so we can identify the player-count field by eye."""
    print(f"\n[{provider}] Keys: {list(item.keys())}")
    print(json.dumps(item, indent=2, default=str))


# ── ChronoGolf ───────────────────────────────────────────────────────────────
async def test_chronogolf():
    print_section("ChronoGolf")
    from app.services.chronogolf_service import get_provider_configs, fetch_chronogolf_times
    supabase = await create_supabase()
    course = await find_course_for_provider(supabase, "ChronoGolf")
    if not course:
        print("  SKIPPED — no active ChronoGolf alerts found")
        return
    print(f"  Using course: {course['name']} (id={course['id']})")
    configs = await get_provider_configs(supabase, course["id"])
    data = await fetch_chronogolf_times(configs, SCAN_DATE)
    print(f"  Returned {len(data)} items")
    if data:
        inspect_item(data[0], "ChronoGolf")


# ── ForeUp ───────────────────────────────────────────────────────────────────
async def test_foreup():
    print_section("ForeUp")
    from app.services.foreup_service import get_provider_configs, fetch_foreup_times
    supabase = await create_supabase()
    course = await find_course_for_provider(supabase, "ForeUp")
    if not course:
        print("  SKIPPED — no active ForeUp alerts found")
        return
    print(f"  Using course: {course['name']} (id={course['id']})")
    configs = await get_provider_configs(supabase, course["id"])
    date_str = datetime.strptime(SCAN_DATE, "%Y-%m-%d").strftime("%m-%d-%Y")
    data = await fetch_foreup_times(course, configs, date_str, "all")
    print(f"  Returned {len(data)} items")
    if data:
        inspect_item(data[0], "ForeUp")


# ── GolfNow ──────────────────────────────────────────────────────────────────
async def test_golfnow():
    print_section("GolfNow")
    import httpx
    from app.services.golfnow_service import get_provider_configs, fetch_golfnow_times
    supabase = await create_supabase()
    course = await find_course_for_provider(supabase, "GolfNow")
    if not course:
        print("  SKIPPED — no active GolfNow alerts found")
        return
    print(f"  Using course: {course['name']} (id={course['id']})")
    configs = await get_provider_configs(supabase, course["id"])
    date_str = datetime.strptime(SCAN_DATE, "%Y-%m-%d").strftime("%b %d %Y")
    async with httpx.AsyncClient(verify=False) as client:
        data = await fetch_golfnow_times(client, course, configs, date_str)
    print(f"  Returned {len(data)} items")
    if data:
        inspect_item(data[0], "GolfNow")
        rates = data[0].get("teeTimeRates") or []
        if rates:
            print(f"\n  [GolfNow] First teeTimeRate entry:")
            inspect_item(rates[0], "GolfNow.teeTimeRate")


# ── Quick18 ──────────────────────────────────────────────────────────────────
async def test_quick18():
    print_section("Quick18")
    import httpx
    from app.services.quick18_service import get_provider_configs, fetch_quick18_times
    supabase = await create_supabase()
    course = await find_course_for_provider(supabase, "Quick18")
    if not course:
        print("  SKIPPED — no active Quick18 alerts found")
        return
    print(f"  Using course: {course['name']} (id={course['id']})")
    configs = await get_provider_configs(supabase, course["id"])
    base_url = configs.get("base_url")
    if not base_url:
        print("  No base_url config found for this course")
        return
    date_str = datetime.strptime(SCAN_DATE, "%Y-%m-%d").strftime("%Y%m%d")
    async with httpx.AsyncClient() as client:
        html = await fetch_quick18_times(client, base_url, date_str)
    if html:
        print(f"  Got HTML response ({len(html)} chars). Quick18 is scraped HTML.")
        import re
        snippet = re.search(r'(?i)(player|spot|golfer).{0,200}', html)
        if snippet:
            print(f"  Snippet near player/spot/golfer: ...{snippet.group(0)[:300]}...")
        else:
            print("  No 'player/spot/golfer' text found in HTML.")
    else:
        print("  No HTML returned.")


# ── EagleClub ────────────────────────────────────────────────────────────────
async def test_eagleclub():
    print_section("EagleClub")
    import httpx
    from app.services.eagleclub_service import get_provider_configs, fetch_eagleclub_times
    supabase = await create_supabase()
    course = await find_course_for_provider(supabase, "EagleClub")
    if not course:
        print("  SKIPPED — no active EagleClub alerts found")
        return
    print(f"  Using course: {course['name']} (id={course['id']})")
    configs = await get_provider_configs(supabase, course["id"])
    date_str = datetime.strptime(SCAN_DATE, "%Y-%m-%d").strftime("%Y%m%d")
    async with httpx.AsyncClient() as client:
        data = await fetch_eagleclub_times(client, course, configs, date_str)
    print(f"  Returned {len(data)} items")
    if data:
        inspect_item(data[0], "EagleClub")


async def main():
    print(f"\nPlayer Count Discovery Diagnostic — scanning date: {SCAN_DATE}")
    print("Edit COURSE_* constants at the top of this file before running.\n")
    await test_chronogolf()
    await test_foreup()
    await test_golfnow()
    await test_quick18()
    await test_eagleclub()
    print("\n\nDone. Review '*** PLAYER FIELDS FOUND' lines above.")


if __name__ == "__main__":
    asyncio.run(main())
