"""
Tests for EagleClub normalize_and_store logic.

Covers:
  - Date "YYYYMMDD" + Time "HHMM" → course-local → UTC
  - ReserveOnline != 1 skipped
  - NineFee + CarriageNineFee → 9-hole row
  - EighteenFee + CarriageEighteenFee → 18-hole row
  - Both fees zero → entry skipped
  - Deduplication: duplicate (time, holes) → keep lowest price
  - Stale DB records removed via diff
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


def make_raw_entry(date="20260324", time="0700", reserve_online=1,
                   nine_fee=0.0, nine_carriage=0.0,
                   eighteen_fee=55.0, eighteen_carriage=15.0):
    return {
        "Date": date,
        "Time": time,
        "ReserveOnline": reserve_online,
        "NineFee": nine_fee,
        "CarriageNineFee": nine_carriage,
        "EighteenFee": eighteen_fee,
        "CarriageEighteenFee": eighteen_carriage,
    }


CENTRAL_COURSE = {
    "id": 1,
    "name": "Test EagleClub Course",
    "time_zone": "America/Chicago",
}


# ---------------------------------------------------------------------------
# Timezone conversion
# ---------------------------------------------------------------------------

async def test_7am_central_stored_as_12pm_utc():
    """Time '0700' for CDT course → 12:00 UTC."""
    supabase = make_supabase_mock()
    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [make_raw_entry(time="0700")]
        await normalize_and_store(CENTRAL_COURSE, raw, "20260324")

    call = supabase.table().upsert.call_args
    assert call is not None
    rows = call[0][0]
    # Should have one 18-hole row (NineFee=0, EighteenFee=55)
    assert any(r["holes"] == 18 for r in rows)
    utc_row = next(r for r in rows if r["holes"] == 18)
    stored_dt = datetime.fromisoformat(utc_row["tee_time"])
    assert stored_dt.astimezone(tz.tzutc()).hour == 12


async def test_7am_eastern_stored_as_11am_utc():
    """Time '0700' for EDT course → 11:00 UTC."""
    eastern_course = {"id": 2, "name": "Eastern", "time_zone": "America/New_York"}
    supabase = make_supabase_mock()
    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [make_raw_entry(time="0700")]
        await normalize_and_store(eastern_course, raw, "20260324")

    rows = supabase.table().upsert.call_args[0][0]
    utc_row = next(r for r in rows if r["holes"] == 18)
    stored_dt = datetime.fromisoformat(utc_row["tee_time"])
    local = stored_dt.astimezone(tz.gettz("America/New_York"))
    assert local.hour == 7


# ---------------------------------------------------------------------------
# ReserveOnline filtering
# ---------------------------------------------------------------------------

async def test_reserve_online_0_skipped():
    """Entries with ReserveOnline != 1 must not be stored."""
    supabase = make_supabase_mock()
    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [make_raw_entry(reserve_online=0)]
        await normalize_and_store(CENTRAL_COURSE, raw, "20260324")

    assert supabase.table().upsert.call_args is None


async def test_reserve_online_1_stored():
    """Entries with ReserveOnline == 1 are stored."""
    supabase = make_supabase_mock()
    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [make_raw_entry(reserve_online=1)]
        await normalize_and_store(CENTRAL_COURSE, raw, "20260324")

    assert supabase.table().upsert.call_args is not None


# ---------------------------------------------------------------------------
# 9 / 18 hole splitting
# ---------------------------------------------------------------------------

async def test_eighteen_only_creates_one_row():
    """Only EighteenFee > 0 → one 18-hole row."""
    supabase = make_supabase_mock()
    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [make_raw_entry(nine_fee=0, eighteen_fee=55.0, eighteen_carriage=15.0)]
        await normalize_and_store(CENTRAL_COURSE, raw, "20260324")

    rows = supabase.table().upsert.call_args[0][0]
    hole_counts = {r["holes"] for r in rows}
    assert hole_counts == {18}


async def test_nine_only_creates_one_row():
    """Only NineFee > 0 → one 9-hole row."""
    supabase = make_supabase_mock()
    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [make_raw_entry(nine_fee=30.0, nine_carriage=10.0, eighteen_fee=0, eighteen_carriage=0)]
        await normalize_and_store(CENTRAL_COURSE, raw, "20260324")

    rows = supabase.table().upsert.call_args[0][0]
    hole_counts = {r["holes"] for r in rows}
    assert hole_counts == {9}


async def test_both_fees_creates_two_rows():
    """Both NineFee and EighteenFee > 0 → one row for each."""
    supabase = make_supabase_mock()
    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [make_raw_entry(nine_fee=30.0, nine_carriage=10.0,
                              eighteen_fee=55.0, eighteen_carriage=15.0)]
        await normalize_and_store(CENTRAL_COURSE, raw, "20260324")

    rows = supabase.table().upsert.call_args[0][0]
    hole_counts = {r["holes"] for r in rows}
    assert hole_counts == {9, 18}


async def test_both_fees_zero_entry_skipped():
    """Both NineFee and EighteenFee == 0 → entry not stored."""
    supabase = make_supabase_mock()
    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [make_raw_entry(nine_fee=0, nine_carriage=0, eighteen_fee=0, eighteen_carriage=0)]
        await normalize_and_store(CENTRAL_COURSE, raw, "20260324")

    assert supabase.table().upsert.call_args is None


# ---------------------------------------------------------------------------
# Price calculation
# ---------------------------------------------------------------------------

async def test_eighteen_price_sums_fee_and_carriage():
    """18-hole price = EighteenFee + CarriageEighteenFee."""
    supabase = make_supabase_mock()
    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [make_raw_entry(eighteen_fee=55.0, eighteen_carriage=15.0)]
        await normalize_and_store(CENTRAL_COURSE, raw, "20260324")

    rows = supabase.table().upsert.call_args[0][0]
    row_18 = next(r for r in rows if r["holes"] == 18)
    assert row_18["price"] == 70.0


async def test_nine_price_sums_fee_and_carriage():
    """9-hole price = NineFee + CarriageNineFee."""
    supabase = make_supabase_mock()
    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [make_raw_entry(nine_fee=30.0, nine_carriage=10.0, eighteen_fee=0, eighteen_carriage=0)]
        await normalize_and_store(CENTRAL_COURSE, raw, "20260324")

    rows = supabase.table().upsert.call_args[0][0]
    row_9 = next(r for r in rows if r["holes"] == 9)
    assert row_9["price"] == 40.0


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

async def test_duplicate_time_and_holes_deduplicates_to_lowest_price():
    """Two entries with same time + holes: lowest price wins."""
    supabase = make_supabase_mock()
    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [
            make_raw_entry(time="0700", eighteen_fee=70.0, eighteen_carriage=0),
            make_raw_entry(time="0700", eighteen_fee=55.0, eighteen_carriage=0),  # cheaper
        ]
        await normalize_and_store(CENTRAL_COURSE, raw, "20260324")

    rows = supabase.table().upsert.call_args[0][0]
    rows_18 = [r for r in rows if r["holes"] == 18]
    assert len(rows_18) == 1
    assert rows_18[0]["price"] == 55.0


# ---------------------------------------------------------------------------
# Stale record diffing
# ---------------------------------------------------------------------------

async def test_stale_records_deleted():
    """DB records not returned by scan are deleted."""
    old_dt = datetime(2026, 3, 24, 11, 0, 0, tzinfo=tz.tzutc())
    existing_records = [{"id": 888, "tee_time": old_dt.isoformat(), "holes": 18}]
    supabase = make_supabase_mock(existing_records=existing_records)

    with patch("app.services.eagleclub_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.eagleclub_service import normalize_and_store

        raw = [make_raw_entry(time="0700")]  # different time → stale record gets deleted
        await normalize_and_store(CENTRAL_COURSE, raw, "20260324")

    delete_call = supabase.table().delete().in_.call_args
    assert delete_call is not None
    assert 888 in delete_call[0][1]
