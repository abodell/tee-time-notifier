"""
Tests for ForeUp normalize_and_store logic.

Covers:
  - ISO string time (naive → apply course local_tz → UTC)
  - ISO string time already tz-aware (converted to UTC)
  - holes "9/18" → two rows (9 and 18 holes)
  - holes missing → defaults to 18
  - booked/locked items skipped
  - price from green_fee
  - stale DB records removed via diff
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from dateutil import tz

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_supabase_mock(existing_records=None):
    existing_records = existing_records or []

    mock = MagicMock()

    select_chain = MagicMock()
    select_chain.execute = AsyncMock(return_value=MagicMock(data=existing_records))
    select_chain.eq = MagicMock(return_value=select_chain)
    select_chain.gte = MagicMock(return_value=select_chain)
    select_chain.lte = MagicMock(return_value=select_chain)

    upsert_chain = MagicMock()
    upsert_chain.execute = AsyncMock(return_value=MagicMock(data=[]))

    delete_chain = MagicMock()
    delete_chain.execute = AsyncMock(return_value=MagicMock(data=[]))
    delete_chain.in_ = MagicMock(return_value=delete_chain)

    table_mock = MagicMock()
    table_mock.select = MagicMock(return_value=select_chain)
    table_mock.upsert = MagicMock(return_value=upsert_chain)
    table_mock.delete = MagicMock(return_value=delete_chain)

    mock.table = MagicMock(return_value=table_mock)
    return mock


def make_raw_entry(time_str, green_fee=45.0, holes="18", booked=False, locked=False):
    return {
        "time": time_str,
        "green_fee": green_fee,
        "holes": holes,
        "booked": booked,
        "locked": locked,
    }


CENTRAL_COURSE = {
    "id": 1,
    "name": "Test Course",
    "time_zone": "America/Chicago",
}


# ---------------------------------------------------------------------------
# Timezone conversion
# ---------------------------------------------------------------------------

async def test_naive_time_applies_course_timezone():
    """
    Naive ISO string (no tz offset) should be treated as course-local time.
    7AM naive for a CDT course → 12:00 UTC.
    """
    supabase = make_supabase_mock()
    with patch("app.services.foreup_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.foreup_service import normalize_and_store

        raw = [make_raw_entry("2026-03-24T07:00:00")]  # naive → CDT local
        await normalize_and_store(CENTRAL_COURSE, raw, "03-24-2026")

    call = supabase.table().upsert.call_args
    assert call is not None
    rows = call[0][0]
    assert len(rows) == 1
    assert "12:00:00" in rows[0]["tee_time"], f"Expected 12:00 UTC, got {rows[0]['tee_time']}"


async def test_tz_aware_time_converted_to_utc():
    """
    tz-aware ISO string should be converted to UTC as-is (not re-applied course tz).
    2026-03-24T12:00:00+00:00 → stored as 12:00 UTC.
    """
    supabase = make_supabase_mock()
    with patch("app.services.foreup_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.foreup_service import normalize_and_store

        raw = [make_raw_entry("2026-03-24T12:00:00+00:00")]
        await normalize_and_store(CENTRAL_COURSE, raw, "03-24-2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert "12:00:00" in rows[0]["tee_time"]


async def test_eastern_course_7am_stores_11am_utc():
    """Eastern course: 7AM naive → 11:00 UTC (EDT)."""
    eastern_course = {"id": 2, "name": "Eastern", "time_zone": "America/New_York"}
    supabase = make_supabase_mock()
    with patch("app.services.foreup_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.foreup_service import normalize_and_store

        raw = [make_raw_entry("2026-03-24T07:00:00")]
        await normalize_and_store(eastern_course, raw, "03-24-2026")

    stored_dt = datetime.fromisoformat(supabase.table().upsert.call_args[0][0][0]["tee_time"])
    local = stored_dt.astimezone(tz.gettz("America/New_York"))
    assert local.hour == 7


# ---------------------------------------------------------------------------
# Holes parsing
# ---------------------------------------------------------------------------

async def test_holes_9_slash_18_creates_two_rows():
    """'9/18' in holes field should produce one row for 9 holes and one for 18."""
    supabase = make_supabase_mock()
    with patch("app.services.foreup_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.foreup_service import normalize_and_store

        raw = [make_raw_entry("2026-03-24T07:00:00", holes="9/18")]
        await normalize_and_store(CENTRAL_COURSE, raw, "03-24-2026")

    rows = supabase.table().upsert.call_args[0][0]
    hole_counts = {r["holes"] for r in rows}
    assert hole_counts == {9, 18}


async def test_holes_18_creates_one_row():
    """Standard 18-hole entry creates exactly one row."""
    supabase = make_supabase_mock()
    with patch("app.services.foreup_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.foreup_service import normalize_and_store

        raw = [make_raw_entry("2026-03-24T07:00:00", holes="18")]
        await normalize_and_store(CENTRAL_COURSE, raw, "03-24-2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert len(rows) == 1
    assert rows[0]["holes"] == 18


async def test_holes_missing_defaults_to_18():
    """Missing holes field defaults to 18."""
    supabase = make_supabase_mock()
    with patch("app.services.foreup_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.foreup_service import normalize_and_store

        raw = [{"time": "2026-03-24T07:00:00", "green_fee": 45.0}]
        await normalize_and_store(CENTRAL_COURSE, raw, "03-24-2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert rows[0]["holes"] == 18


# ---------------------------------------------------------------------------
# Booked / locked filtering
# ---------------------------------------------------------------------------

async def test_booked_entry_is_marked_not_available():
    """Booked entries set available=False."""
    supabase = make_supabase_mock()
    with patch("app.services.foreup_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.foreup_service import normalize_and_store

        raw = [make_raw_entry("2026-03-24T07:00:00", booked=True)]
        await normalize_and_store(CENTRAL_COURSE, raw, "03-24-2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert rows[0]["available"] is False


async def test_locked_entry_is_marked_not_available():
    """Locked entries set available=False."""
    supabase = make_supabase_mock()
    with patch("app.services.foreup_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.foreup_service import normalize_and_store

        raw = [make_raw_entry("2026-03-24T07:00:00", locked=True)]
        await normalize_and_store(CENTRAL_COURSE, raw, "03-24-2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert rows[0]["available"] is False


# ---------------------------------------------------------------------------
# Price
# ---------------------------------------------------------------------------

async def test_price_extracted_from_green_fee():
    """green_fee value is stored as price."""
    supabase = make_supabase_mock()
    with patch("app.services.foreup_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.foreup_service import normalize_and_store

        raw = [make_raw_entry("2026-03-24T07:00:00", green_fee=72.50)]
        await normalize_and_store(CENTRAL_COURSE, raw, "03-24-2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert rows[0]["price"] == 72.50


async def test_missing_price_defaults_to_zero():
    """Missing green_fee defaults to 0."""
    supabase = make_supabase_mock()
    with patch("app.services.foreup_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.foreup_service import normalize_and_store

        raw = [{"time": "2026-03-24T07:00:00", "holes": "18"}]
        await normalize_and_store(CENTRAL_COURSE, raw, "03-24-2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert rows[0]["price"] == 0.0


# ---------------------------------------------------------------------------
# Stale record diffing
# ---------------------------------------------------------------------------

async def test_stale_records_deleted_when_not_in_scan():
    """
    Records in the DB that are NOT in the fresh scan should be deleted.
    """
    existing_dt = datetime(2026, 3, 24, 11, 0, 0, tzinfo=tz.tzutc())  # 6AM CDT
    existing_records = [{"id": 999, "tee_time": existing_dt.isoformat(), "holes": 18}]
    supabase = make_supabase_mock(existing_records=existing_records)

    with patch("app.services.foreup_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.foreup_service import normalize_and_store

        # Scan returns a DIFFERENT time (7AM CDT = 12:00 UTC)
        raw = [make_raw_entry("2026-03-24T07:00:00")]
        await normalize_and_store(CENTRAL_COURSE, raw, "03-24-2026")

    delete_call = supabase.table().delete().in_.call_args
    assert delete_call is not None, "Expected stale records to be deleted"
    deleted_ids = delete_call[0][1]
    assert 999 in deleted_ids
