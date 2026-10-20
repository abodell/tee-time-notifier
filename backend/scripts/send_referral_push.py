"""
One-off broadcast: tell Free-tier users about the referral program.

Excludes membership_tier_id 2 (Plus) and 3 (Pro) — only users who stand to
gain from referring (they don't already have paid access) get this.

Usage:
    python scripts/send_referral_push.py                # dry run (default)
    python scripts/send_referral_push.py --send          # actually send
    python scripts/send_referral_push.py --send --limit 1  # smoke test on one user first
"""
import argparse
import asyncio
import sys

import httpx

sys.path.insert(0, ".")
from app.db import create_supabase

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXCLUDED_TIER_IDS = [2, 3]  # Plus, Pro
REFERRAL_REWARD_DAYS = 7  # keep in sync with app/routes/referrals.py

TITLE = "Refer a friend, get free Pro 🏌️"
BODY = (
    f"Invite a friend to TeeSignal and you'll both get {REFERRAL_REWARD_DAYS} days "
    "of Pro — faster alerts, more courses, unlimited alerts. Find your code in the app."
)


async def get_recipients(limit: int | None = None, exclude_ids: list[str] | None = None) -> list[dict]:
    supabase = await create_supabase()
    query = (
        supabase.table("user_profiles")
        .select("id, expo_push_token, membership_tier_id")
        .not_.in_("membership_tier_id", EXCLUDED_TIER_IDS)
        .like("expo_push_token", "ExponentPushToken%")
    )
    res = await query.execute()
    rows = res.data or []

    if exclude_ids:
        rows = [r for r in rows if r["id"] not in exclude_ids]

    if limit:
        rows = rows[:limit]
    return rows


def chunked(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


async def send_batch(tokens: list[str]) -> None:
    messages = [
        {
            "to": token,
            "sound": "default",
            "title": TITLE,
            "body": BODY,
            "data": {"type": "referral_promo"},
        }
        for token in tokens
    ]
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(EXPO_PUSH_URL, json=messages)
        resp.raise_for_status()
        result = resp.json()

    tickets = result.get("data", [])
    errors = [t for t in tickets if t.get("status") != "ok"]
    print(f"  sent {len(tickets) - len(errors)}/{len(tickets)} ok")
    for t in errors:
        print(f"  ERROR: {t}")


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--send", action="store_true", help="Actually send (default is dry run).")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N recipients.")
    parser.add_argument("--exclude-id", action="append", default=[], help="user_profiles.id to exclude (repeatable).")
    args = parser.parse_args()

    recipients = await get_recipients(limit=args.limit, exclude_ids=args.exclude_id)
    tokens = [r["expo_push_token"] for r in recipients]

    print(f"Title: {TITLE}")
    print(f"Body:  {BODY}")
    print(f"Recipients (tier != {EXCLUDED_TIER_IDS}, valid token): {len(tokens)}")

    if not args.send:
        print("\nDry run only — pass --send to actually push. Use --limit 1 to smoke-test first.")
        return

    for batch in chunked(tokens, 100):  # Expo's max per request
        await send_batch(batch)


if __name__ == "__main__":
    asyncio.run(main())
