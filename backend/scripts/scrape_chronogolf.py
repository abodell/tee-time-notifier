import asyncio
import httpx
import json
import argparse
from typing import List, Dict, Optional

async def fetch_org(client: httpx.AsyncClient, club_id: int) -> Optional[Dict]:
    url = f"https://www.chronogolf.com/marketplace/organizations/{club_id}"
    try:
        resp = await client.get(url, headers={"Accept": "application/json"}, timeout=10.0)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        # print(f"[{club_id}] Org Error: {e}")
        return None

async def fetch_courses(client: httpx.AsyncClient, club_id: int) -> List[Dict]:
    url = f"https://www.chronogolf.com/marketplace/clubs/{club_id}/courses"
    try:
        resp = await client.get(url, headers={"Accept": "application/json"}, timeout=10.0)
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return []

async def process_club(client: httpx.AsyncClient, club_id: int, sem: asyncio.Semaphore) -> List[Dict]:
    async with sem:
        org = await fetch_org(client, club_id)
        if not org:
            return []
            
        courses = await fetch_courses(client, club_id)
        if not courses:
            return []
            
        # Filter based on active status AND online booking enabled
        is_active = org.get("active")
        booking = org.get("online_booking_enabled")
        
        if not (is_active and booking):
            # print(f"[{club_id}] Skipping: {org['name']} (Inactive or booking disabled)")
            return []
            
        results = []
        settings = org.get("settings", {})
        default_affiliation = settings.get("default_affiliation_type_id")
        
        for c in courses:
            slug = org.get("slug")
            booking_link = f"https://www.chronogolf.com/club/{slug}" if slug else None
            
            entry = {
                "name": f"{org['name']} - {c['name']}",
                "city": org.get("city"),
                "state": org.get("province_name") or org.get("province", {}).get("name"),
                "website": org.get("website"),
                "phone": org.get("phone_number"),
                "provider": "ChronoGolf",
                "active": c.get("online_booking_enabled", True),
                "booking_link": booking_link,
                "configs": {
                    "club_id": str(club_id),
                    "course_id": str(c["id"]),
                    "affiliation_id": str(default_affiliation) if default_affiliation else None,
                    "nb_holes": str(c.get("holes", 18)),
                    "timezone": org.get("timezone"),
                    "slug": slug
                }
            }
            results.append(entry)
        
        print(f"[{club_id}] Found: {org['name']} ({len(results)} courses)")
        return results

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, help="Start Club ID")
    parser.add_argument("--end", type=int, help="End Club ID")
    parser.add_argument("--id", type=int, help="Single Club ID (overrides range)")
    parser.add_argument("--concurrency", type=int, default=10, help="Max parallel requests")
    parser.add_argument("--out", default="backend/seeds/chronogolf_courses.json", help="Output file")
    args = parser.parse_args()
    
    start_id = args.id if args.id else args.start
    end_id = args.id if args.id else args.end
    
    if start_id is None or end_id is None:
        print("Error: Must provide --id or both --start and --end")
        return

    print(f"Scraping Chrono Golf IDs from {start_id} to {end_id} (concurrency={args.concurrency})...")
    
    sem = asyncio.Semaphore(args.concurrency)
    async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}) as client:
        tasks = [process_club(client, club_id, sem) for club_id in range(start_id, end_id + 1)]
        results_nested = await asyncio.gather(*tasks)
        
    all_courses = [item for sublist in results_nested for item in sublist]
    
    with open(args.out, "w") as f:
        json.dump(all_courses, f, indent=2)
        
    print(f"\nFinished! Saved {len(all_courses)} courses to {args.out}")

if __name__ == "__main__":
    asyncio.run(main())
