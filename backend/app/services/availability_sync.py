"""
Shared helper for pruning stale availability rows after a provider scan.

Replaces the old select-existing-rows -> diff-in-python -> delete-by-id
pattern (one extra SELECT round trip per course/date, every ~45s, across
every provider) with a single server-side RPC call that computes and
performs the same diff inside Postgres.

Falls back to the original client-side diff when settings.SERVER_SIDE_PRUNE
is False, so reverting is an env var + restart, not a code rollback.
"""
from datetime import datetime, timezone
from typing import Iterable, Set, Tuple

from app.config import settings


def _keep_payload(scanned_keys: Iterable[Tuple[str, int]]) -> list:
    return [{"tee_time": t, "holes": h} for t, h in scanned_keys]


async def prune_stale(
    supabase,
    course_id: int,
    start_utc: datetime,
    end_utc: datetime,
    scanned_keys: Set[Tuple[str, int]],
) -> None:
    """
    Remove availability rows for (course_id, [start_utc, end_utc]) whose
    (tee_time, holes) key is not in scanned_keys — i.e. rows this scan no
    longer sees. scanned_keys entries are (iso_time_in_utc, holes) tuples,
    matching what every provider service already builds for its old diff.
    """
    if settings.SERVER_SIDE_PRUNE:
        await supabase.rpc(
            "prune_stale_availability",
            {
                "p_course_id": course_id,
                "p_start": start_utc.isoformat(),
                "p_end": end_utc.isoformat(),
                "p_keep": _keep_payload(scanned_keys),
            },
        ).execute()
        return

    current_res = await (
        supabase.table("availability")
        .select("id, tee_time, holes")
        .eq("course_id", course_id)
        .gte("tee_time", start_utc.isoformat())
        .lte("tee_time", end_utc.isoformat())
        .execute()
    )
    db_map = {
        (datetime.fromisoformat(r["tee_time"]).astimezone(timezone.utc).isoformat(), int(r["holes"])): r["id"]
        for r in current_res.data or []
    }
    ids_to_remove = [db_id for key, db_id in db_map.items() if key not in scanned_keys]
    if ids_to_remove:
        await supabase.table("availability").delete().in_("id", ids_to_remove).execute()
