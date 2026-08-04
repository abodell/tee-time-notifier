"""
Tests for alert_service.py core functions.

Covers:
  - rollover_recurring_alerts: expired recurring alerts → rolled forward 7 days
  - process_single_alert: finds matching tee times (from a pre-fetched row set,
    shared across alerts on the same course+holes), records alert_notifications
  - process_single_alert: no tee times → no notification record inserted
  - process_single_alert: already-notified availability IDs are not re-notified
  - process_single_alert: batches the alert_notifications dedup check and the
    resulting inserts into a single call each, instead of one per tee time
  - _matches_alert: in-memory players filter (replaces the old or_() query filter)
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, call


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_supabase_for_rollover(expired_alerts):
    """Mock supabase for rollover tests. Returns (mock, alerts_table_mock)."""
    mock = MagicMock()

    select_chain = MagicMock()
    select_chain.eq = MagicMock(return_value=select_chain)
    select_chain.lt = MagicMock(return_value=select_chain)
    select_chain.execute = AsyncMock(return_value=MagicMock(data=expired_alerts))

    update_chain = MagicMock()
    update_chain.eq = MagicMock(return_value=update_chain)
    update_chain.execute = AsyncMock(return_value=MagicMock(data=[]))

    alerts_table = MagicMock()
    alerts_table.select = MagicMock(return_value=select_chain)
    alerts_table.update = MagicMock(return_value=update_chain)

    mock.table = MagicMock(return_value=alerts_table)
    return mock, alerts_table


def make_supabase_for_process(existing_notifications=None):
    """
    Mock supabase for process_single_alert tests. Rows are now passed in
    directly via the `rows=` kwarg (shared across alerts on the same
    course+holes), so this only needs to mock the alert_notifications table.
    Returns (mock, notif_table).
    """
    mock = MagicMock()
    existing_notifications = existing_notifications or []

    notif_select_chain = MagicMock()
    notif_select_chain.eq = MagicMock(return_value=notif_select_chain)
    notif_select_chain.in_ = MagicMock(return_value=notif_select_chain)
    notif_select_chain.order = MagicMock(return_value=notif_select_chain)
    notif_select_chain.execute = AsyncMock(return_value=MagicMock(data=existing_notifications))

    notif_insert_chain = MagicMock()
    notif_insert_chain.execute = AsyncMock(return_value=MagicMock(data=[{"id": 1}]))

    notif_table = MagicMock()
    notif_table.select = MagicMock(return_value=notif_select_chain)
    notif_table.insert = MagicMock(return_value=notif_insert_chain)

    mock.table = MagicMock(return_value=notif_table)
    return mock, notif_table


def make_alert(alert_id=1, user_id="user-123", course_id=100, holes=18, players=None):
    return {
        "id": alert_id,
        "user_id": user_id,
        "course_id": course_id,
        "holes": holes,
        "players": players,
        "start_time": datetime(2026, 3, 24, 12, 0, 0, tzinfo=timezone.utc).isoformat(),
        "end_time": datetime(2026, 3, 24, 16, 0, 0, tzinfo=timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# rollover_recurring_alerts
# ---------------------------------------------------------------------------

async def test_rollover_updates_expired_alerts():
    """
    Expired recurring alerts should be updated with dates rolled 7 days forward.
    """
    from app.services.alert_service import rollover_recurring_alerts

    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    expired_alert = {
        "id": 1,
        "date_from": "2026-03-17T00:00:00+00:00",
        "date_to": "2026-03-17T23:59:59+00:00",
        "start_time": "2026-03-17T12:00:00+00:00",
        "end_time": "2026-03-17T16:00:00+00:00",
        "courses": {"time_zone": "America/Chicago"},
    }

    supabase, alerts_table = make_supabase_for_rollover([expired_alert])
    await rollover_recurring_alerts(supabase, now)

    update_call = alerts_table.update.call_args
    assert update_call is not None, "update() should have been called"

    updated = update_call[0][0]
    # date_from should be 7 days later than 2026-03-17
    new_date_from = datetime.fromisoformat(updated["date_from"])
    assert new_date_from.day == 24  # March 17 + 7 = March 24


async def test_rollover_no_expired_alerts_no_update():
    """No expired alerts → no update calls."""
    from app.services.alert_service import rollover_recurring_alerts

    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    supabase, alerts_table = make_supabase_for_rollover([])
    await rollover_recurring_alerts(supabase, now)

    alerts_table.update.assert_not_called()


async def test_rollover_rolls_start_and_end_time():
    """Both start_time and end_time are rolled forward by 7 days."""
    from app.services.alert_service import rollover_recurring_alerts

    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    expired_alert = {
        "id": 5,
        "date_from": "2026-03-17T00:00:00+00:00",
        "date_to": "2026-03-17T23:59:59+00:00",
        "start_time": "2026-03-17T13:00:00+00:00",
        "end_time": "2026-03-17T17:00:00+00:00",
        "courses": {"time_zone": "America/Chicago"},
    }

    supabase, alerts_table = make_supabase_for_rollover([expired_alert])
    await rollover_recurring_alerts(supabase, now)

    updated = alerts_table.update.call_args[0][0]
    new_start = datetime.fromisoformat(updated["start_time"])
    new_end = datetime.fromisoformat(updated["end_time"])

    orig_start = datetime.fromisoformat("2026-03-17T13:00:00+00:00")
    orig_end = datetime.fromisoformat("2026-03-17T17:00:00+00:00")

    assert (new_start - orig_start).days >= 6  # at least 6 days (may vary due to DST)
    assert (new_end - orig_end).days >= 6


# ---------------------------------------------------------------------------
# process_single_alert
# ---------------------------------------------------------------------------

async def test_process_single_alert_inserts_notification_for_new_tee_time():
    """
    When matching tee times exist and haven't been notified yet,
    a notification record is inserted and the alert is tracked in summaries.
    """
    from app.services.alert_service import process_single_alert

    rows = [{"id": 42, "course_id": 100, "tee_time": "2026-03-24T12:00:00+00:00", "holes": 18}]
    supabase, notif_table = make_supabase_for_process(existing_notifications=[])

    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    summaries = {}
    alert = make_alert()

    await process_single_alert(supabase, alert, now, summaries, rows=rows)

    # Inserts are batched: one insert() call carrying a list of payloads.
    insert_call = notif_table.insert.call_args
    assert insert_call is not None
    payloads = insert_call[0][0]
    assert isinstance(payloads, list)
    assert len(payloads) == 1
    assert payloads[0]["alert_id"] == 1
    assert payloads[0]["availability_id"] == 42

    assert 1 in summaries
    assert summaries[1]["count"] == 1


async def test_process_single_alert_no_tee_times_no_notification():
    """When no rows match the alert's window, no notification is recorded."""
    from app.services.alert_service import process_single_alert

    supabase, notif_table = make_supabase_for_process()

    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    summaries = {}
    alert = make_alert()

    await process_single_alert(supabase, alert, now, summaries, rows=[])

    notif_table.insert.assert_not_called()
    assert 1 not in summaries


async def test_process_single_alert_already_notified_skipped():
    """
    A tee time that already has an alert_notification record (with spots
    unchanged) should NOT trigger another insert.
    """
    from app.services.alert_service import process_single_alert

    rows = [{"id": 42, "course_id": 100, "tee_time": "2026-03-24T12:00:00+00:00", "holes": 18}]
    existing_notifications = [{"availability_id": 42, "spots_available": None, "sent_at": "2026-03-20T00:00:00+00:00"}]
    supabase, notif_table = make_supabase_for_process(existing_notifications=existing_notifications)

    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    summaries = {}
    alert = make_alert()

    await process_single_alert(supabase, alert, now, summaries, rows=rows)

    notif_table.insert.assert_not_called()
    assert 1 not in summaries


async def test_process_single_alert_batches_notification_check_and_insert():
    """
    The alert_notifications existence check and the insert must each be a
    single call covering all matched tee times, not one call per tee time
    (this is the fix for the N+1 query pattern that was driving egress up).
    """
    from app.services.alert_service import process_single_alert

    rows = [
        {"id": 10, "course_id": 100, "tee_time": "2026-03-24T12:00:00+00:00", "holes": 18},
        {"id": 11, "course_id": 100, "tee_time": "2026-03-24T12:30:00+00:00", "holes": 18},
        {"id": 12, "course_id": 100, "tee_time": "2026-03-24T13:00:00+00:00", "holes": 18},
    ]
    supabase, notif_table = make_supabase_for_process(existing_notifications=[])

    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    summaries = {}
    alert = make_alert()

    await process_single_alert(supabase, alert, now, summaries, rows=rows)

    assert notif_table.select.call_count == 1  # one dedup check for all 3 rows
    assert notif_table.insert.call_count == 1  # one bulk insert for all 3 rows
    assert len(notif_table.insert.call_args[0][0]) == 3
    assert summaries[1]["count"] == 3


# ---------------------------------------------------------------------------
# _matches_alert: in-memory players filter (replaces the old or_() query filter)
# ---------------------------------------------------------------------------

def test_matches_alert_players_filter_blocks_insufficient_spots():
    """When alert.players=3, a row with spots_available=2 should not match."""
    from app.services.alert_service import _matches_alert

    row = {"tee_time": "2026-03-24T12:00:00+00:00", "spots_available": 2}
    start = datetime(2026, 3, 24, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 3, 24, 23, 59, tzinfo=timezone.utc)

    assert _matches_alert(row, start, end, players=3) is False


def test_matches_alert_players_filter_allows_null_spots():
    """
    Unknown spots_available (NULL) must pass through so providers without
    player count data don't silently block notifications.
    """
    from app.services.alert_service import _matches_alert

    row = {"tee_time": "2026-03-24T12:00:00+00:00", "spots_available": None}
    start = datetime(2026, 3, 24, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 3, 24, 23, 59, tzinfo=timezone.utc)

    assert _matches_alert(row, start, end, players=3) is True


def test_matches_alert_players_filter_allows_sufficient_spots():
    """spots_available >= players should match."""
    from app.services.alert_service import _matches_alert

    row = {"tee_time": "2026-03-24T12:00:00+00:00", "spots_available": 4}
    start = datetime(2026, 3, 24, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 3, 24, 23, 59, tzinfo=timezone.utc)

    assert _matches_alert(row, start, end, players=3) is True


def test_matches_alert_no_players_filter_when_none():
    """When alert.players=None (Any), spots_available is never checked."""
    from app.services.alert_service import _matches_alert

    row = {"tee_time": "2026-03-24T12:00:00+00:00", "spots_available": 0}
    start = datetime(2026, 3, 24, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 3, 24, 23, 59, tzinfo=timezone.utc)

    assert _matches_alert(row, start, end, players=None) is True


def test_matches_alert_outside_window_excluded():
    """A tee time outside the alert's start/end window should not match."""
    from app.services.alert_service import _matches_alert

    row = {"tee_time": "2026-03-25T12:00:00+00:00", "spots_available": None}
    start = datetime(2026, 3, 24, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 3, 24, 23, 59, tzinfo=timezone.utc)

    assert _matches_alert(row, start, end, players=None) is False
