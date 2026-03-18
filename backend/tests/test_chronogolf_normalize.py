"""
Tests for ChronoGolf normalize_and_store logic.

Covers:
  - date + start_time fields → local naive → UTC conversion
  - out_of_capacity items skipped
  - price extracted from green_fees array
  - stale DB records removed via diff
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
from dateutil import tz


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


def make_raw_entry(date="2026-03-24", start_time="07:00", nb_holes=18,
                   out_of_capacity=False, price=55.0):
    return {
        "date": date,
        "start_time": start_time,
        "nb_holes": nb_holes,
        "out_of_capacity": out_of_capacity,
        "green_fees": [{"price": price}] if price is not None else [],
    }


CENTRAL_COURSE = {
    "id": 1,
    "name": "Test ChronoGolf Course",
    "time_zone": "America/Chicago",
}


# ---------------------------------------------------------------------------
# Timezone conversion
# ---------------------------------------------------------------------------

async def test_7am_central_stored_as_12pm_utc():
    """7AM local for CDT course → 12:00 UTC."""
    supabase = make_supabase_mock()
    with patch("app.services.chronogolf_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.chronogolf_service import normalize_and_store

        raw = [make_raw_entry(start_time="07:00")]
        await normalize_and_store(CENTRAL_COURSE, raw, "2026-03-24")

    call = supabase.table().upsert.call_args
    assert call is not None
    rows = call[0][0]
    assert len(rows) == 1
    assert "12:00:00" in rows[0]["tee_time"], f"Expected 12:00 UTC, got {rows[0]['tee_time']}"


async def test_7am_eastern_stored_as_11am_utc():
    """7AM local for EDT course → 11:00 UTC."""
    eastern_course = {"id": 2, "name": "Eastern Course", "time_zone": "America/New_York"}
    supabase = make_supabase_mock()
    with patch("app.services.chronogolf_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.chronogolf_service import normalize_and_store

        raw = [make_raw_entry(start_time="07:00")]
        await normalize_and_store(eastern_course, raw, "2026-03-24")

    rows = supabase.table().upsert.call_args[0][0]
    stored_dt = datetime.fromisoformat(rows[0]["tee_time"])
    local = stored_dt.astimezone(tz.gettz("America/New_York"))
    assert local.hour == 7


async def test_7am_pacific_stored_as_2pm_utc():
    """7AM local for PDT course → 14:00 UTC."""
    pacific_course = {"id": 3, "name": "Pacific Course", "time_zone": "America/Los_Angeles"}
    supabase = make_supabase_mock()
    with patch("app.services.chronogolf_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.chronogolf_service import normalize_and_store

        raw = [make_raw_entry(start_time="07:00")]
        await normalize_and_store(pacific_course, raw, "2026-03-24")

    rows = supabase.table().upsert.call_args[0][0]
    stored_dt = datetime.fromisoformat(rows[0]["tee_time"])
    local = stored_dt.astimezone(tz.gettz("America/Los_Angeles"))
    assert local.hour == 7


# ---------------------------------------------------------------------------
# out_of_capacity filtering
# ---------------------------------------------------------------------------

async def test_out_of_capacity_skipped():
    """out_of_capacity=True entries must be excluded from upsert."""
    supabase = make_supabase_mock()
    with patch("app.services.chronogolf_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.chronogolf_service import normalize_and_store

        raw = [make_raw_entry(out_of_capacity=True)]
        await normalize_and_store(CENTRAL_COURSE, raw, "2026-03-24")

    assert supabase.table().upsert.call_args is None, "No upsert expected for out_of_capacity entries"


async def test_mixed_capacity_only_available_upserted():
    """Only non-out_of_capacity entries should be upserted."""
    supabase = make_supabase_mock()
    with patch("app.services.chronogolf_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.chronogolf_service import normalize_and_store

        raw = [
            make_raw_entry(start_time="07:00", out_of_capacity=False),
            make_raw_entry(start_time="08:00", out_of_capacity=True),
        ]
        await normalize_and_store(CENTRAL_COURSE, raw, "2026-03-24")

    rows = supabase.table().upsert.call_args[0][0]
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# Price
# ---------------------------------------------------------------------------

async def test_price_extracted_from_green_fees():
    """Price comes from green_fees[0].price."""
    supabase = make_supabase_mock()
    with patch("app.services.chronogolf_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.chronogolf_service import normalize_and_store

        raw = [make_raw_entry(price=88.0)]
        await normalize_and_store(CENTRAL_COURSE, raw, "2026-03-24")

    rows = supabase.table().upsert.call_args[0][0]
    assert rows[0]["price"] == 88.0


async def test_no_green_fees_defaults_to_zero():
    """Empty green_fees defaults to 0.0."""
    supabase = make_supabase_mock()
    with patch("app.services.chronogolf_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.chronogolf_service import normalize_and_store

        raw = [make_raw_entry(price=None)]  # price=None → empty green_fees
        await normalize_and_store(CENTRAL_COURSE, raw, "2026-03-24")

    rows = supabase.table().upsert.call_args[0][0]
    assert rows[0]["price"] == 0.0


# ---------------------------------------------------------------------------
# Holes
# ---------------------------------------------------------------------------

async def test_nb_holes_stored_correctly():
    """nb_holes from ChronoGolf entry is preserved in stored row."""
    supabase = make_supabase_mock()
    with patch("app.services.chronogolf_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.chronogolf_service import normalize_and_store

        raw = [make_raw_entry(nb_holes=9)]
        await normalize_and_store(CENTRAL_COURSE, raw, "2026-03-24")

    rows = supabase.table().upsert.call_args[0][0]
    assert rows[0]["holes"] == 9


# ---------------------------------------------------------------------------
# Stale record diffing
# ---------------------------------------------------------------------------

async def test_stale_records_deleted():
    """DB records not in the current scan are deleted."""
    old_dt = datetime(2026, 3, 24, 10, 0, 0, tzinfo=tz.tzutc())
    existing_records = [{"id": 777, "tee_time": old_dt.isoformat(), "holes": 18}]
    supabase = make_supabase_mock(existing_records=existing_records)

    with patch("app.services.chronogolf_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.chronogolf_service import normalize_and_store

        # Scan has a different time — 7AM CDT = 12:00 UTC
        raw = [make_raw_entry(start_time="07:00")]
        await normalize_and_store(CENTRAL_COURSE, raw, "2026-03-24")

    delete_call = supabase.table().delete().in_.call_args
    assert delete_call is not None
    assert 777 in delete_call[0][1]
