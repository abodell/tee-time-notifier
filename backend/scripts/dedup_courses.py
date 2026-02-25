"""
dedup_courses.py — Detect and resolve duplicate courses across providers.

When the same real-world golf course appears in multiple booking systems
(e.g. "Wescott Golf Club" in GolfNow and "The Golf Club at Wescott Plantation"
in ChronoGolf), this script identifies the pair, keeps the higher-trust source,
and deletes the lower-trust one — migrating any active alerts to the winner.

Provider trust order (highest → lowest):
    ForeUp > GolfNow > ChronoGolf > Quick18

Usage:
    # Preview what would happen (no DB changes)
    python backend/scripts/dedup_courses.py --dry-run

    # Apply resolutions automatically
    python backend/scripts/dedup_courses.py

    # Tune fuzzy-match sensitivity (0-100, default 82)
    python backend/scripts/dedup_courses.py --threshold 85 --dry-run

    # Only check a specific provider's courses against the rest
    python backend/scripts/dedup_courses.py --provider GolfNow --dry-run
"""

import asyncio
import argparse
import os
import sys
import re
from difflib import SequenceMatcher
from itertools import combinations
from typing import Dict, List, Optional, Tuple

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from app.db import create_supabase

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Higher index = lower trust. In any pair, the lower-index provider wins.
PROVIDER_TRUST_ORDER = ["ForeUp", "GolfNow", "ChronoGolf", "Quick18"]

# Words that carry no real signal for course identity — stripped before comparison
_NOISE_WORDS = {
    "the", "a", "an", "and", "at", "of", "in", "on", "by",
    "golf", "course", "club", "links", "plantation", "country",
    "resort", "greens", "fairways", "meadows", "ridge", "hills",
}


# ---------------------------------------------------------------------------
# Name normalization
# ---------------------------------------------------------------------------

def normalize_name(name: str) -> str:
    """
    Strip noise words, punctuation, and extra whitespace so that
    "The Golf Club at Wescott Plantation" and "Wescott Golf Club"
    both reduce to roughly the same core tokens.
    """
    name = name.lower()
    name = re.sub(r"[^a-z0-9 ]", " ", name)   # remove punctuation
    tokens = [t for t in name.split() if t not in _NOISE_WORDS]
    return " ".join(tokens)


def similarity(a: str, b: str) -> float:
    """Return 0-100 fuzzy similarity between two normalized names."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio() * 100


# ---------------------------------------------------------------------------
# Trust helpers
# ---------------------------------------------------------------------------

def trust_rank(provider: str) -> int:
    """Lower number = higher trust. Unknown providers get lowest trust."""
    try:
        return PROVIDER_TRUST_ORDER.index(provider)
    except ValueError:
        return len(PROVIDER_TRUST_ORDER)


def pick_winner(a: Dict, b: Dict) -> Tuple[Dict, Dict]:
    """Return (winner, loser) based on provider trust and then course id tiebreak."""
    rank_a = trust_rank(a["provider"])
    rank_b = trust_rank(b["provider"])
    if rank_a < rank_b:
        return a, b
    if rank_b < rank_a:
        return b, a
    # Same provider — keep the lower DB id (presumably older / canonical)
    return (a, b) if a["id"] < b["id"] else (b, a)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

async def fetch_all_courses(supabase, bottom_range, top_range, provider_filter: Optional[str]) -> List[Dict]:
    query = supabase.table("courses").select("id, name, city, state, provider").range(bottom_range, top_range)
    res = await query.execute()
    courses = res.data or []
    if provider_filter:
        courses = [c for c in courses if c["provider"] == provider_filter]
    return courses


async def fetch_alert_count(supabase, course_id: int) -> int:
    res = await (
        supabase.table("alerts")
        .select("id", count="exact")
        .eq("course_id", course_id)
        .execute()
    )
    return res.count or 0


async def migrate_alerts(supabase, from_id: int, to_id: int) -> int:
    """Move all alerts from the losing course to the winning course."""
    res = await (
        supabase.table("alerts")
        .update({"course_id": to_id})
        .eq("course_id", from_id)
        .execute()
    )
    return len(res.data or [])


async def delete_course(supabase, course_id: int) -> None:
    """Delete a course's provider_configs, then the course row itself."""
    await supabase.table("provider_configs").delete().eq("course_id", course_id).execute()
    await supabase.table("courses").delete().eq("id", course_id).execute()


# ---------------------------------------------------------------------------
# Core dedup logic
# ---------------------------------------------------------------------------

async def find_duplicates(
    courses: List[Dict],
    threshold: float,
    provider_filter: Optional[str],
) -> List[Tuple[Dict, Dict, float]]:
    """
    Compare all pairs of courses that share city + state.
    Returns list of (course_a, course_b, score) for pairs above threshold.
    
    If provider_filter is set, at least one course in each pair must be
    from that provider.
    """
    # Group by (city, state) — only compare within the same location
    groups: Dict[Tuple[str, str], List[Dict]] = {}
    for c in courses:
        key = (
            (c.get("city") or "").strip().lower(),
            (c.get("state") or "").strip().lower(),
        )
        groups.setdefault(key, []).append(c)

    duplicates = []
    for (city, state), group in groups.items():
        if len(group) < 2:
            continue
        for a, b in combinations(group, 2):
            # If filtering by provider, at least one must match
            if provider_filter:
                if a["provider"] != provider_filter and b["provider"] != provider_filter:
                    continue
            # Don't flag same-provider pairs as duplicates
            if a["provider"] == b["provider"]:
                continue
            score = similarity(a["name"], b["name"])
            if score >= threshold:
                duplicates.append((a, b, score))

    # Sort by score descending
    duplicates.sort(key=lambda x: x[2], reverse=True)
    return duplicates


async def resolve_duplicates(
    supabase,
    duplicates: List[Tuple[Dict, Dict, float]],
    dry_run: bool,
) -> None:
    if not duplicates:
        print("\n✅ No duplicates found.")
        return

    print(f"\n{'[DRY RUN] ' if dry_run else ''}Found {len(duplicates)} potential duplicate pair(s):\n")
    print(f"{'Score':>5}  {'Winner':<12}  {'Loser':<12}  Detail")
    print("-" * 80)

    resolved = 0
    skipped = 0
    already_processed_losers = set()  # avoid double-deleting same course

    for a, b, score in duplicates:
        winner, loser = pick_winner(a, b)

        if loser["id"] in already_processed_losers:
            continue

        print(
            f"{score:>4.0f}%  "
            f"[{winner['provider']:<10}] {winner['name'][:45]:<45}  "
            f"vs  [{loser['provider']:<10}] {loser['name'][:45]}"
        )
        print(
            f"       City: {winner.get('city')}, {winner.get('state')} | "
            f"Winner ID={winner['id']} | Loser ID={loser['id']}"
        )

        if not dry_run:
            # Migrate alerts first
            alert_count = await fetch_alert_count(supabase, loser["id"])
            if alert_count > 0:
                migrated = await migrate_alerts(supabase, loser["id"], winner["id"])
                print(f"       ↳ Migrated {migrated} alert(s) from loser → winner")

            await delete_course(supabase, loser["id"])
            already_processed_losers.add(loser["id"])
            print(f"       ↳ Deleted loser course (ID={loser['id']}) + its provider_configs")
            resolved += 1
        else:
            already_processed_losers.add(loser["id"])
            skipped += 1

        print()

    if dry_run:
        print(
            f"[DRY RUN] Would resolve {skipped} duplicate(s). "
            f"Run without --dry-run to apply."
        )
    else:
        print(f"✅ Resolved {resolved} duplicate(s).")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def main(threshold: float, dry_run: bool, provider_filter: Optional[str]):
    print("Dedup Courses")
    print(f"  Threshold : {threshold:.0f}%")
    print(f"  Dry run   : {dry_run}")
    print(f"  Provider  : {provider_filter or 'all'}")
    print(f"  Trust order: {' > '.join(PROVIDER_TRUST_ORDER)}\n")

    supabase = await create_supabase()

    # Fetch all courses (or filtered subset for detection, but we need full
    # list so we can compare against all providers)
    all_courses = []
    for i in range(0, 7041, 1000):
        all_courses.extend(await fetch_all_courses(supabase, i, i + 1000, provider_filter=None))
    print(f"Loaded {len(all_courses)} course(s) from DB.")

    duplicates = await find_duplicates(all_courses, threshold, provider_filter)
    await resolve_duplicates(supabase, duplicates, dry_run)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Detect and resolve duplicate courses across providers."
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=82,
        help="Fuzzy-match similarity threshold 0-100 (default: 82)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen without making any DB changes",
    )
    parser.add_argument(
        "--provider",
        type=str,
        default=None,
        choices=PROVIDER_TRUST_ORDER,
        help="Only check pairs where at least one course is from this provider",
    )
    args = parser.parse_args()
    asyncio.run(main(args.threshold, args.dry_run, args.provider))
