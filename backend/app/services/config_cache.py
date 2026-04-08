"""
In-memory cache for provider_configs rows.

Keyed by course_id. Each entry stores the full config dict and the time it
was cached. Entries expire after TTL_HOURS and are refreshed on next access.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

_TTL = timedelta(hours=24)
_cache: dict[int, tuple[dict, datetime]] = {}


def get(course_id: int) -> Optional[dict]:
    """Return cached configs for course_id, or None if missing/expired."""
    entry = _cache.get(course_id)
    if entry and datetime.now(timezone.utc) - entry[1] < _TTL:
        return entry[0]
    return None


def set(course_id: int, configs: dict) -> None:
    """Store configs for course_id, resetting the TTL."""
    _cache[course_id] = (configs, datetime.now(timezone.utc))


def update_key(course_id: int, key: str, value) -> None:
    """
    Merge a single key into an existing cached entry without resetting the TTL.
    Used when a value is discovered at runtime (e.g. ChronoGolf course_uuid).
    No-op if the course is not already cached.
    """
    entry = _cache.get(course_id)
    if entry:
        configs, cached_at = entry
        _cache[course_id] = ({**configs, key: value}, cached_at)
