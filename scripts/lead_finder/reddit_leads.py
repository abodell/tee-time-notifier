"""
Finds Reddit posts/comments from people talking about booking trips to or tee
times at courses TeeSignal supports, so they can be reviewed and replied to
*manually*. This script only reads Reddit — it never posts, comments, or DMs.
That's deliberate: automated posting is what gets accounts banned/shadowed,
automated reading does not.

Setup:
    pip install praw
    export REDDIT_CLIENT_ID=...
    export REDDIT_CLIENT_SECRET=...
    export REDDIT_USER_AGENT="teesignal-lead-finder by u/<your_username>"

Usage:
    python reddit_leads.py

Output:
    Writes leads/<today>.md with any newly-seen matches. Already-seen posts
    and comments are tracked in seen_state.json so re-runs only surface new
    activity.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import praw

HERE = Path(__file__).parent
SEEN_STATE_PATH = HERE / "seen_state.json"
LEADS_DIR = HERE / "leads"

# Each cluster maps to a group of courses TeeSignal actually supports today.
# Search terms are OR'd together per cluster; keep them specific to the course
# names themselves (not generic "golf trip") to avoid drowning in noise.
COURSE_CLUSTERS = [
    {
        "label": "Bethpage Black",
        "search_terms": ["Bethpage Black tee time", "Bethpage Black reservation", "Bethpage Black booking"],
        "reply_angle": (
            "Genuine tip, not a pitch: mention the resident/non-resident window and the "
            "28-day rule if relevant, then note you use an alert app (TeeSignal) that "
            "watches for cancellations instead of refreshing manually. Disclose you built it "
            "if asked or if it feels natural."
        ),
    },
    {
        "label": "Torrey Pines South",
        "search_terms": ["Torrey Pines South tee time", "Torrey Pines tee time", "Torrey Pines booking"],
        "reply_angle": (
            "The non-obvious tip (resident slots releasing 3 days out to non-residents) is "
            "genuinely useful on its own — lead with that, mention the app only if it fits."
        ),
    },
    {
        "label": "Chambers Bay",
        "search_terms": ["Chambers Bay tee time", "Chambers Bay booking", "Chambers Bay reservation"],
        "reply_angle": "Mention the Jan 1 outside-window release date — most visitors don't know it exists.",
    },
    {
        "label": "TPC Scottsdale",
        "search_terms": ["TPC Scottsdale tee time", "TPC Scottsdale Stadium Course booking"],
        "reply_angle": "Dynamic pricing + the 7-30 day window is the useful hook, especially near Phoenix Open season.",
    },
    {
        "label": "Pinehurst area (Tobacco Road / Mid Pines / Pine Needles / Southern Pines / Tot Hill Farm)",
        "search_terms": [
            "Tobacco Road tee time", "Tobacco Road golf trip", "Pinehurst golf trip",
            "Mid Pines tee time", "Pine Needles tee time", "Southern Pines golf tee time",
            "Tot Hill Farm tee time",
        ],
        "reply_angle": (
            "This is the cluster where you have a real, specific story (beat Tobacco Road's "
            "own Noteefy waitlist). Use it — it reads as a golf story, not an ad."
        ),
    },
    {
        "label": "Generic high-intent (no specific course)",
        "search_terms": [
            "app to get notified tee time cancellation", "tee time alert app",
            "app for tee time availability", "notified when tee time opens up",
        ],
        "reply_angle": "These people are explicitly asking for exactly what TeeSignal does. Highest-intent bucket.",
    },
]

SEARCH_SORT = "new"
SEARCH_TIME_FILTER = "month"
SEARCH_LIMIT = 15


def load_seen() -> set:
    if SEEN_STATE_PATH.exists():
        return set(json.loads(SEEN_STATE_PATH.read_text()))
    return set()


def save_seen(seen: set) -> None:
    SEEN_STATE_PATH.write_text(json.dumps(sorted(seen), indent=2))


def get_reddit() -> praw.Reddit:
    return praw.Reddit(
        client_id=os.environ["REDDIT_CLIENT_ID"],
        client_secret=os.environ["REDDIT_CLIENT_SECRET"],
        user_agent=os.environ.get("REDDIT_USER_AGENT", "teesignal-lead-finder/0.1"),
    )


def find_leads(reddit: praw.Reddit, seen: set) -> list[dict]:
    new_leads = []
    for cluster in COURSE_CLUSTERS:
        for term in cluster["search_terms"]:
            try:
                results = reddit.subreddit("all").search(
                    term, sort=SEARCH_SORT, time_filter=SEARCH_TIME_FILTER, limit=SEARCH_LIMIT
                )
            except Exception as exc:  # network/auth hiccups shouldn't kill the whole run
                print(f"  [warn] search failed for '{term}': {exc}")
                continue

            for submission in results:
                fullname = submission.fullname
                if fullname in seen:
                    continue
                seen.add(fullname)
                new_leads.append(
                    {
                        "cluster": cluster["label"],
                        "reply_angle": cluster["reply_angle"],
                        "matched_term": term,
                        "type": "post",
                        "subreddit": str(submission.subreddit),
                        "title": submission.title,
                        "author": str(submission.author),
                        "snippet": (submission.selftext or "")[:300],
                        "permalink": f"https://reddit.com{submission.permalink}",
                        "created_utc": datetime.fromtimestamp(
                            submission.created_utc, tz=timezone.utc
                        ).isoformat(),
                    }
                )
    return new_leads


def write_digest(leads: list[dict]) -> Path | None:
    if not leads:
        return None

    LEADS_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_path = LEADS_DIR / f"{today}.md"

    lines = [f"# Reddit leads — {today}", ""]
    by_cluster: dict[str, list[dict]] = {}
    for lead in leads:
        by_cluster.setdefault(lead["cluster"], []).append(lead)

    for cluster, cluster_leads in by_cluster.items():
        lines.append(f"## {cluster}")
        lines.append("")
        for lead in cluster_leads:
            lines.append(f"- **[{lead['title']}]({lead['permalink']})**")
            lines.append(f"  - r/{lead['subreddit']} · u/{lead['author']} · matched \"{lead['matched_term']}\"")
            if lead["snippet"]:
                lines.append(f"  - > {lead['snippet'].replace(chr(10), ' ')}")
            lines.append(f"  - *Reply angle:* {lead['reply_angle']}")
            lines.append("")

    out_path.write_text("\n".join(lines))
    return out_path


def main() -> None:
    seen = load_seen()
    reddit = get_reddit()
    print("Searching Reddit (read-only — nothing will be posted)...")
    leads = find_leads(reddit, seen)
    save_seen(seen)

    out_path = write_digest(leads)
    if out_path:
        print(f"Found {len(leads)} new lead(s). Digest written to {out_path}")
    else:
        print("No new leads since last run.")


if __name__ == "__main__":
    main()
