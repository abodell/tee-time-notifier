"""
Short-TTL cache for data fetched redundantly by near-simultaneous scan jobs.

Several scheduled jobs query the same shape of data within the same few
seconds of each other (e.g. all 9 provider scans asking "which alerts are
active" every ~45s, or all 3 membership-tier alert-engine jobs asking for
the same full alert list every 60s). Caching for a short TTL lets whichever
job runs first in a cycle populate it once, and the rest reuse it instead
of each hitting Supabase independently.
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Awaitable, Callable

_TTL = timedelta(seconds=30)
_cache: dict[str, tuple[Any, datetime]] = {}


async def get_or_fetch(key: str, fetch_fn: Callable[[], Awaitable[Any]]) -> Any:
    now = datetime.now(timezone.utc)
    entry = _cache.get(key)
    if entry and now - entry[1] < _TTL:
        return entry[0]

    value = await fetch_fn()
    _cache[key] = (value, now)
    return value
