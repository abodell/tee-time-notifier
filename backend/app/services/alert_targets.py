"""
Shared "which alerts are active" fetch, reused by every provider scan.

All 9 provider scan jobs (ForeUp, ChronoGolf, Quick18, EagleClub, WebTrac,
CPS, TeeItUp, Whoosh, GolfNow) used to independently query
`alerts JOIN courses` every cycle, each filtered to its own provider at the
SQL level. Since they all run within seconds of each other, this fetches
the join once (cached briefly via scan_cache) and lets each provider filter
by name in Python instead.
"""
from datetime import datetime, timezone, timedelta

from app.services import scan_cache


async def _fetch_active_alerts_with_courses(supabase):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    res = await (
        supabase.table("alerts")
        .select("date_from, date_to, courses!alerts_course_id_fkey!inner(id, name, provider, time_zone)")
        .eq("active", True)
        .gte("date_to", cutoff)
        .execute()
    )
    return res.data or []


async def get_active_alerts_with_courses(supabase) -> list[dict]:
    """ All active, non-expired alerts joined with their course — every provider, not filtered. """
    return await scan_cache.get_or_fetch(
        "active_alerts_with_courses",
        lambda: _fetch_active_alerts_with_courses(supabase),
    )
