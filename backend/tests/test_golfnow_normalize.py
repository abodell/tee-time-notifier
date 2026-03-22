"""
Tests for GolfNow scan normalization logic.

Covers the bugs fixed 2026-03-18:
  - GolfNow API changed `time` from a string to a dict {date, formatted, ...}
  - GolfNow API changed `minTeeTimeRate` from a float to a dict {value, ...}
  - GolfNow sends course-local time with a bogus +00:00 UTC label — must strip
    and apply the course's real timezone before converting to UTC.
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from dateutil import tz

import pytest

# Import the function under test
from scripts.scan_golfnow_job import normalize_and_store


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_supabase_mock(existing_records=None):
    """Return a mock supabase client that returns `existing_records` for select
    and accepts upsert/delete without error."""
    existing_records = existing_records or []

    mock = MagicMock()

    # Chain: .table().select().eq().gte().lte().execute()
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


def make_entry(time_value, price_value=52.0, hole_counts=None):
    """Build a raw GolfNow tee-time entry."""
    rates = []
    for h in (hole_counts or [18]):
        rates.append({"holeCount": h})
    return {
        "time": time_value,
        "minTeeTimeRate": price_value,
        "teeTimeRates": rates,
    }


CENTRAL_COURSE = {
    "id": 1,
    "name": "Test Course",
    "time_zone": "America/Chicago",
}


# ---------------------------------------------------------------------------
# time field: dict format (current GolfNow API)
# ---------------------------------------------------------------------------

async def test_time_as_dict_extracts_date_key():
    """GolfNow now returns time as a dict with a `date` key — must extract it."""
    supabase = make_supabase_mock()
    entry = make_entry(
        time_value={"date": "2026-03-24T07:00:00+00:00", "formatted": "7:00", "formattedTimeMeridian": "AM"}
    )
    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    upsert_call = supabase.table().upsert.call_args
    assert upsert_call is not None, "upsert should have been called"
    rows = upsert_call[0][0]
    assert len(rows) == 1
    # 7AM CDT (America/Chicago) → 12:00 UTC
    assert "12:00:00" in rows[0]["tee_time"], (
        f"Expected 12:00 UTC for 7AM CDT, got {rows[0]['tee_time']}"
    )


async def test_time_as_string_still_works():
    """Older entries with time as a plain ISO string should still parse correctly."""
    supabase = make_supabase_mock()
    entry = make_entry(time_value="2026-03-24T07:00:00+00:00")
    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    upsert_call = supabase.table().upsert.call_args
    assert upsert_call is not None
    rows = upsert_call[0][0]
    assert len(rows) == 1
    assert "12:00:00" in rows[0]["tee_time"]


async def test_time_dict_missing_date_key_skipped():
    """A dict entry without a `date` key should be silently skipped."""
    supabase = make_supabase_mock()
    entry = make_entry(time_value={"formatted": "7:00", "formattedTimeMeridian": "AM"})
    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    upsert_call = supabase.table().upsert.call_args
    assert upsert_call is None, "No rows should be upserted when date key is missing"


async def test_time_none_skipped():
    """Entries with no time field at all should be skipped."""
    supabase = make_supabase_mock()
    entry = {"minTeeTimeRate": 50.0, "teeTimeRates": [{"holeCount": 18}]}
    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    assert supabase.table().upsert.call_args is None


# ---------------------------------------------------------------------------
# Timezone conversion: course-local time stored as correct UTC
# ---------------------------------------------------------------------------

async def test_timezone_central_course_7am_stores_12pm_utc():
    """
    Regression: GolfNow sends '07:00:00+00:00' for a 7AM CDT tee time.
    Before fix: stored as 07:00 UTC → displayed as 2AM CDT.
    After fix:  stored as 12:00 UTC → displayed as 7AM CDT. ✓
    """
    supabase = make_supabase_mock()
    entry = make_entry(time_value={"date": "2026-03-24T07:00:00+00:00", "formatted": "7:00", "formattedTimeMeridian": "AM"})
    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    rows = supabase.table().upsert.call_args[0][0]
    stored_dt = datetime.fromisoformat(rows[0]["tee_time"])
    # Convert stored UTC back to CDT — must equal 7AM
    cdt = tz.gettz("America/Chicago")
    local_dt = stored_dt.astimezone(cdt)
    assert local_dt.hour == 7, (
        f"Expected 7AM CDT after round-trip, got {local_dt.hour}AM CDT "
        f"(stored as {stored_dt.isoformat()} UTC)"
    )


async def test_timezone_eastern_course_7am_stores_11am_utc():
    """Eastern course: 7AM EDT stored as 11:00 UTC."""
    eastern_course = {"id": 2, "name": "Eastern Course", "time_zone": "America/New_York"}
    supabase = make_supabase_mock()
    entry = make_entry(time_value={"date": "2026-03-24T07:00:00+00:00", "formatted": "7:00", "formattedTimeMeridian": "AM"})
    await normalize_and_store(supabase, eastern_course, [entry], "Mar 24 2026")

    rows = supabase.table().upsert.call_args[0][0]
    stored_dt = datetime.fromisoformat(rows[0]["tee_time"])
    edt = tz.gettz("America/New_York")
    local_dt = stored_dt.astimezone(edt)
    assert local_dt.hour == 7, (
        f"Expected 7AM EDT after round-trip, got {local_dt.hour} "
        f"(stored as {stored_dt.isoformat()} UTC)"
    )


async def test_timezone_pacific_course_7am_stores_14pm_utc():
    """Pacific course: 7AM PDT stored as 14:00 UTC."""
    pacific_course = {"id": 3, "name": "Pacific Course", "time_zone": "America/Los_Angeles"}
    supabase = make_supabase_mock()
    entry = make_entry(time_value={"date": "2026-03-24T07:00:00+00:00", "formatted": "7:00", "formattedTimeMeridian": "AM"})
    await normalize_and_store(supabase, pacific_course, [entry], "Mar 24 2026")

    rows = supabase.table().upsert.call_args[0][0]
    stored_dt = datetime.fromisoformat(rows[0]["tee_time"])
    pdt = tz.gettz("America/Los_Angeles")
    local_dt = stored_dt.astimezone(pdt)
    assert local_dt.hour == 7, (
        f"Expected 7AM PDT after round-trip, got {local_dt.hour} "
        f"(stored as {stored_dt.isoformat()} UTC)"
    )


# ---------------------------------------------------------------------------
# price field: dict format (current GolfNow API)
# ---------------------------------------------------------------------------

async def test_price_as_dict_extracts_value_key():
    """
    Regression: GolfNow now returns minTeeTimeRate as a dict {value: 52.0, ...}.
    Before fix: float(dict) → TypeError.
    After fix:  extracts .value → 52.0. ✓
    """
    supabase = make_supabase_mock()
    price_dict = {
        "value": 52.0,
        "currencyCode": "USD",
        "roundedFormattedValue": "$52",
    }
    entry = make_entry(time_value={"date": "2026-03-24T07:00:00+00:00", "formatted": "7:00", "formattedTimeMeridian": "AM"},
                       price_value=price_dict)
    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert rows[0]["price"] == 52.0, f"Expected 52.0, got {rows[0]['price']}"


async def test_price_as_float_still_works():
    """Older entries with price as a plain float should still parse."""
    supabase = make_supabase_mock()
    entry = make_entry(
        time_value={"date": "2026-03-24T07:00:00+00:00", "formatted": "7:00", "formattedTimeMeridian": "AM"},
        price_value=39.99
    )
    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert rows[0]["price"] == 39.99


async def test_price_dict_missing_value_defaults_to_zero():
    """Price dict without a value key should default to 0."""
    supabase = make_supabase_mock()
    entry = make_entry(
        time_value={"date": "2026-03-24T07:00:00+00:00", "formatted": "7:00", "formattedTimeMeridian": "AM"},
        price_value={"currencyCode": "USD"}  # no `value` key
    )
    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert rows[0]["price"] == 0.0


# ---------------------------------------------------------------------------
# hole counts
# ---------------------------------------------------------------------------

async def test_hole_counts_from_tee_time_rates():
    """teeTimeRates with multiple holeCount values produce one row per hole count."""
    supabase = make_supabase_mock()
    entry = {
        "time": {"date": "2026-03-24T07:00:00+00:00", "formatted": "7:00", "formattedTimeMeridian": "AM"},
        "minTeeTimeRate": 50.0,
        "teeTimeRates": [{"holeCount": 9}, {"holeCount": 18}],
    }
    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    rows = supabase.table().upsert.call_args[0][0]
    hole_counts = {r["holes"] for r in rows}
    assert hole_counts == {9, 18}, f"Expected 9 and 18 hole rows, got {hole_counts}"


async def test_hole_count_defaults_to_18_when_missing():
    """If teeTimeRates has no holeCount, default to 18 holes."""
    supabase = make_supabase_mock()
    entry = {
        "time": {"date": "2026-03-24T07:00:00+00:00", "formatted": "7:00", "formattedTimeMeridian": "AM"},
        "minTeeTimeRate": 50.0,
        "teeTimeRates": [],
    }
    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert len(rows) == 1
    assert rows[0]["holes"] == 18


# ---------------------------------------------------------------------------
# parse_dt: supabase-py returns datetime objects for timestamp columns
# ---------------------------------------------------------------------------

async def test_existing_db_records_with_datetime_objects():
    """
    Regression: supabase-py newer versions return datetime objects (not strings)
    for timestamp columns, causing fromisoformat to fail in db_map construction.
    parse_dt() must handle both.
    """
    # Simulate supabase returning a datetime object for tee_time
    existing_dt = datetime(2026, 3, 24, 12, 0, 0, tzinfo=tz.tzutc())
    existing_records = [{"id": 999, "tee_time": existing_dt, "holes": 18}]
    supabase = make_supabase_mock(existing_records=existing_records)

    # New scan returns same tee time — should upsert (not crash)
    entry = make_entry(time_value={"date": "2026-03-24T07:00:00+00:00", "formatted": "7:00", "formattedTimeMeridian": "AM"})
    # Should not raise
    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")


# ---------------------------------------------------------------------------
# spots_available — playerRule parsing
# ---------------------------------------------------------------------------

from app.services.golfnow_service import _player_rule_to_max


def test_player_rule_single_word():
    """'Two' → 2."""
    assert _player_rule_to_max("Two") == 2


def test_player_rule_compound():
    """'OneTwo' → 2 (highest word)."""
    assert _player_rule_to_max("OneTwo") == 2


def test_player_rule_full_range():
    """'OneTwoThreeFour' → 4."""
    assert _player_rule_to_max("OneTwoThreeFour") == 4


def test_player_rule_any():
    """'Any' → 4."""
    assert _player_rule_to_max("Any") == 4


def test_player_rule_empty_string():
    """Empty rule → None."""
    assert _player_rule_to_max("") is None


def test_player_rule_none_input():
    """None rule → None."""
    assert _player_rule_to_max(None) is None


async def test_player_rule_stored_as_spots_available():
    """playerRule in raw entry is parsed and stored as spots_available."""
    supabase = make_supabase_mock()
    entry = make_entry(
        time_value={"date": "2026-03-24T08:00:00+00:00", "formatted": "8:00", "formattedTimeMeridian": "AM"},
        price_value={"value": 52.0},
    )
    entry["playerRule"] = "OneTwo"  # max 2 players

    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert any(r["spots_available"] == 2 for r in rows)


async def test_missing_player_rule_is_none():
    """Entry with no playerRule → spots_available=None."""
    supabase = make_supabase_mock()
    entry = make_entry(
        time_value={"date": "2026-03-24T08:00:00+00:00", "formatted": "8:00", "formattedTimeMeridian": "AM"},
        price_value={"value": 52.0},
    )
    # playerRule intentionally omitted

    await normalize_and_store(supabase, CENTRAL_COURSE, [entry], "Mar 24 2026")

    rows = supabase.table().upsert.call_args[0][0]
    assert all(r["spots_available"] is None for r in rows)
