"""
Test script for the WebTrac scraper.

Usage:
    cd backend
    python -m scripts.test_webtrac \
        --url "https://sccharlestonweb.myvscloud.com/webtrac/web/search.html" \
        --date "03/30/2026" \
        --players 4 \
        --holes 18
"""

import asyncio
import argparse
import json
from app.services.webtrac_service import fetch_webtrac_times


async def main(base_url: str, date_str: str, players: int, holes: int):
    results = await fetch_webtrac_times(base_url, date_str, players, holes)

    if not results:
        print("No tee times found.")
        return

    print(f"\nFound {len(results)} tee time(s) on {date_str}:\n")
    for r in results:
        slots = r.get("spots_available", "?")
        print(f"  {r['time']}  |  {r['holes_raw']}  |  {r['course_name']}  |  {slots} open slot(s)")

    print("\nRaw data:")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test WebTrac scraper")
    parser.add_argument("--url", required=True, help="Base URL of the WebTrac search page")
    parser.add_argument("--date", required=True, help="Date in MM/DD/YYYY format")
    parser.add_argument("--players", type=int, default=4, help="Number of players")
    parser.add_argument("--holes", type=int, default=18, help="Number of holes")
    args = parser.parse_args()

    asyncio.run(main(args.url, args.date, args.players, args.holes))
