"""
teesignal_reddit.py — Find Reddit posts/threads from people talking about
booking trips to or tee times at courses TeeSignal supports, draft a reply,
and post it only after a human reviews it.

Same find -> draft -> post pattern as ~/repos/swing-analyzer/comment.py,
adapted for text posts instead of swing videos. Point this script's REDDIT_*
env vars at the same Reddit app/account swing-analyzer already uses (copy
that .env here, or export the vars yourself) — no need to register a second
Reddit app.

Usage:
    python teesignal_reddit.py --find [--limit N] [--output-dir DIR]
    python teesignal_reddit.py --draft <post_id> "<comment text>" [--output-dir DIR]
    python teesignal_reddit.py --post <post_id> [--output-dir DIR]

Outputs one folder per post under downloads/, named by post ID:
    downloads/<post_id>/
        meta.json     (title, author, subreddit, permalink, selftext, matched cluster)
        context.md    (existing thread comments + your recent comments, for voice matching)
        comment.md    (draft comment — written by --draft, read by --post)

--post always asks for a final y/N confirmation before it hits the API.
Posting requires REDDIT_USERNAME/REDDIT_PASSWORD in .env in addition to the
client id/secret/user agent --find uses.
"""
import argparse
import json
import os
import sys

from dotenv import load_dotenv
import praw

load_dotenv()

# Subreddits worth scanning directly, beyond whatever a cross-subreddit
# search turns up. Keep this list curated — add to it once you've confirmed
# a sub is both real and relevant (r/golfwrx-style niche forums aren't on
# Reddit at all, so they're not candidates here).
SUBREDDITS = ["golf"]

# Each cluster maps to courses TeeSignal actually supports today. Search
# terms are specific to course names on purpose — generic terms like "golf
# trip" drown everything in noise.
COURSE_CLUSTERS = [
    {
        "label": "Bethpage Black",
        "search_terms": ["Bethpage Black tee time", "Bethpage Black reservation", "Bethpage Black booking"],
        "reply_angle": (
            "You personally use TeeSignal weekly across all 5 Bethpage courses. Lead with "
            "a real tip (resident/non-resident window, 28-day rule) and only mention the app "
            "if it fits naturally. Never imply it automates booking — that's the exact thing "
            "NY State Parks is cracking down on."
        ),
    },
    {
        "label": "Torrey Pines South",
        "search_terms": ["Torrey Pines South tee time", "Torrey Pines tee time", "Torrey Pines booking"],
        "reply_angle": "The 3-day resident-release-to-non-resident rule is a genuinely useful tip on its own.",
    },
    {
        "label": "Chambers Bay",
        "search_terms": ["Chambers Bay tee time", "Chambers Bay booking", "Chambers Bay reservation"],
        "reply_angle": "The Jan 1 outside-window release date is the non-obvious, useful detail here.",
    },
    {
        "label": "TPC Scottsdale",
        "search_terms": ["TPC Scottsdale tee time", "TPC Scottsdale Stadium Course booking"],
        "reply_angle": "Dynamic pricing + the 7-30 day window is the hook, especially near Phoenix Open season.",
    },
    {
        "label": "Pinehurst area (Tobacco Road / Mid Pines / Pine Needles / Southern Pines / Tot Hill Farm)",
        "search_terms": [
            "Tobacco Road tee time", "Tobacco Road golf trip", "Pinehurst golf trip",
            "Mid Pines tee time", "Pine Needles tee time", "Southern Pines golf tee time",
            "Tot Hill Farm tee time",
        ],
        "reply_angle": (
            "You have a real story here: TeeSignal beat Tobacco Road's own Noteefy waitlist "
            "by a few minutes, twice, same trip you also landed Southern Pines. Tell it as a "
            "story, disclose you built the app, don't pitch features."
        ),
    },
    {
        "label": "Generic high-intent (no specific course)",
        "search_terms": [
            "app to get notified tee time cancellation", "tee time alert app",
            "app for tee time availability", "notified when tee time opens up",
        ],
        "reply_angle": "These people are explicitly asking for exactly what TeeSignal does.",
    },
]

SEARCH_SORT = "new"
SEARCH_TIME_FILTER = "month"
SEARCH_LIMIT = 15


def get_reddit_client(read_only: bool = True):
    kwargs = dict(
        client_id=os.environ["REDDIT_CLIENT_ID"],
        client_secret=os.environ["REDDIT_CLIENT_SECRET"],
        user_agent=os.environ["REDDIT_USER_AGENT"],
    )
    if not read_only:
        kwargs["username"] = os.environ["REDDIT_USERNAME"]
        kwargs["password"] = os.environ["REDDIT_PASSWORD"]
    return praw.Reddit(**kwargs)


def _save_candidate(reddit, submission, cluster, matched_term, output_dir: str) -> str:
    post_dir = os.path.join(output_dir, submission.id)
    os.makedirs(post_dir, exist_ok=True)

    meta = {
        "post_id": submission.id,
        "title": submission.title,
        "selftext": submission.selftext or "",
        "author": str(submission.author),
        "subreddit": str(submission.subreddit),
        "score": submission.score,
        "permalink": submission.permalink,
        "reddit_url": f"https://www.reddit.com{submission.permalink}",
        "matched_cluster": cluster["label"],
        "matched_term": matched_term,
        "reply_angle": cluster["reply_angle"],
    }
    with open(os.path.join(post_dir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    _save_voice_context(reddit, submission, post_dir)
    return post_dir


def _save_voice_context(reddit, submission, post_dir: str, comment_limit: int = 20):
    """Pull existing thread comments + the account's own recent comments so
    the drafted reply can match real phrasing instead of reading as AI-written."""
    submission.comment_sort = "best"
    submission.comments.replace_more(limit=0)
    thread_comments = [
        {"author": str(c.author), "score": c.score, "body": c.body}
        for c in submission.comments[:comment_limit]
    ]

    own_comments = []
    username = os.environ.get("REDDIT_USERNAME")
    if username:
        try:
            for c in reddit.redditor(username).comments.new(limit=comment_limit):
                own_comments.append({"subreddit": str(c.subreddit), "body": c.body})
        except Exception:
            pass  # read-only client or account has no history yet — non-fatal

    with open(os.path.join(post_dir, "context.md"), "w") as f:
        f.write("# Voice reference — read before drafting a comment\n\n")
        f.write("## Existing comments on this thread (top-sorted)\n\n")
        if thread_comments:
            for c in thread_comments:
                f.write(f"**{c['author']}** ({c['score']} pts): {c['body']}\n\n")
        else:
            f.write("(no comments yet)\n\n")
        f.write("## Your own recent comments (match this voice)\n\n")
        if own_comments:
            for c in own_comments:
                f.write(f"[r/{c['subreddit']}] {c['body']}\n\n")
        else:
            f.write("(none found)\n\n")


def find(limit: int, output_dir: str):
    reddit = get_reddit_client(read_only=True)
    os.makedirs(output_dir, exist_ok=True)
    found = []

    for cluster in COURSE_CLUSTERS:
        if len(found) >= limit:
            break
        for term in cluster["search_terms"]:
            if len(found) >= limit:
                break
            print(f"Searching for \"{term}\" ({cluster['label']})...")
            try:
                results = reddit.subreddit("all").search(
                    term, sort=SEARCH_SORT, time_filter=SEARCH_TIME_FILTER, limit=SEARCH_LIMIT
                )
            except Exception as exc:
                print(f"  [warn] search failed: {exc}")
                continue

            for submission in results:
                if len(found) >= limit:
                    break
                post_dir_path = os.path.join(output_dir, submission.id)
                if os.path.exists(post_dir_path):
                    continue  # already surfaced in a prior run

                print(f"  [candidate] {submission.id} — {submission.title[:70]}")
                post_dir = _save_candidate(reddit, submission, cluster, term, output_dir)
                found.append(submission.id)
                print(f"    saved to {post_dir}")

    if found:
        print(f"\nReady for review: {' '.join(found)}")
        print("For each: read meta.json + context.md, then --draft a reply, then --post.")
    else:
        print("\nNo new candidates found this run.")
    return found


def draft(post_id: str, text: str, output_dir: str):
    post_dir = os.path.join(output_dir, post_id)
    if not os.path.isdir(post_dir):
        print(f"✗ no {post_dir}/ — run --find first")
        sys.exit(1)

    comment_path = os.path.join(post_dir, "comment.md")
    with open(comment_path, "w") as f:
        f.write(text.strip() + "\n")

    print(f"✓ draft saved to {comment_path}")
    print("\n--- draft ---")
    print(text.strip())
    print("--- end draft ---")
    print("\nReview/edit the file, then run --post to publish it.")


def post(post_id: str, output_dir: str):
    post_dir = os.path.join(output_dir, post_id)
    comment_path = os.path.join(post_dir, "comment.md")
    if not os.path.exists(comment_path):
        print(f"✗ no draft at {comment_path} — run --draft first")
        sys.exit(1)

    with open(comment_path) as f:
        text = f.read().strip()

    meta_path = os.path.join(post_dir, "meta.json")
    reddit_url = None
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            reddit_url = json.load(f).get("reddit_url")

    print("--- comment to post ---")
    print(text)
    print("--- end comment ---")
    if reddit_url:
        print(f"\nThread: {reddit_url}")

    confirm = input("\nPost this comment? [y/N] ").strip().lower()
    if confirm != "y":
        print("Aborted — nothing posted.")
        return

    reddit = get_reddit_client(read_only=False)
    submission = reddit.submission(id=post_id)
    comment = submission.reply(text)
    print(f"✓ posted: https://www.reddit.com{comment.permalink}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--find", action="store_true", help="Scan for new candidate posts/threads")
    group.add_argument("--draft", nargs=2, metavar=("POST_ID", "TEXT"), help="Save a draft comment for a post")
    group.add_argument("--post", metavar="POST_ID", help="Post the saved draft comment (asks for confirmation)")
    parser.add_argument("--limit", type=int, default=10, help="--find: max new candidates to surface")
    parser.add_argument("--output-dir", default="downloads", help="Output directory")
    args = parser.parse_args()

    if args.find:
        find(limit=args.limit, output_dir=args.output_dir)
    elif args.draft:
        draft(args.draft[0], args.draft[1], output_dir=args.output_dir)
    elif args.post:
        post(args.post, output_dir=args.output_dir)
