"""
Tests for alert_service.py core functions.

Covers:
  - rollover_recurring_alerts: expired recurring alerts → rolled forward 7 days
  - process_single_alert: finds matching tee times, records alert_notifications
  - process_single_alert: no tee times → no notification record inserted
  - process_single_alert: already-notified availability IDs are not re-notified
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


def make_supabase_for_process(tee_times=None, existing_notifications=None):
    """Mock supabase for process_single_alert tests. Returns (mock, availability_table, notif_table)."""
    mock = MagicMock()
    tee_times = tee_times or []
    existing_notifications = existing_notifications or []

    avail_chain = MagicMock()
    avail_chain.eq = MagicMock(return_value=avail_chain)
    avail_chain.gte = MagicMock(return_value=avail_chain)
    avail_chain.lte = MagicMock(return_value=avail_chain)
    avail_chain.or_ = MagicMock(return_value=avail_chain)
    avail_chain.execute = AsyncMock(return_value=MagicMock(data=tee_times))

    avail_table = MagicMock()
    avail_table.select = MagicMock(return_value=avail_chain)

    notif_select_chain = MagicMock()
    notif_select_chain.eq = MagicMock(return_value=notif_select_chain)
    notif_select_chain.order = MagicMock(return_value=notif_select_chain)
    notif_select_chain.limit = MagicMock(return_value=notif_select_chain)
    notif_select_chain.execute = AsyncMock(return_value=MagicMock(data=existing_notifications))

    notif_insert_chain = MagicMock()
    notif_insert_chain.execute = AsyncMock(return_value=MagicMock(data=[{"id": 1}]))

    notif_table = MagicMock()
    notif_table.select = MagicMock(return_value=notif_select_chain)
    notif_table.insert = MagicMock(return_value=notif_insert_chain)

    table_map = {
        "availability": avail_table,
        "alert_notifications": notif_table,
    }
    mock.table = MagicMock(side_effect=lambda name: table_map.get(name, MagicMock()))
    return mock, avail_table, notif_table


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

    tee_times = [{"id": 42, "course_id": 100, "tee_time": "2026-03-24T12:00:00+00:00", "holes": 18}]
    supabase, avail_table, notif_table = make_supabase_for_process(
        tee_times=tee_times, existing_notifications=[]
    )

    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    summaries = {}
    alert = make_alert()

    await process_single_alert(supabase, alert, now, summaries)

    insert_call = notif_table.insert.call_args
    assert insert_call is not None
    payload = insert_call[0][0]
    assert payload["alert_id"] == 1
    assert payload["availability_id"] == 42

    assert 1 in summaries
    assert summaries[1]["count"] == 1


async def test_process_single_alert_no_tee_times_no_notification():
    """When no tee times are found, no notification is recorded."""
    from app.services.alert_service import process_single_alert

    supabase, avail_table, notif_table = make_supabase_for_process(tee_times=[])

    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    summaries = {}
    alert = make_alert()

    await process_single_alert(supabase, alert, now, summaries)

    notif_table.insert.assert_not_called()
    assert 1 not in summaries


async def test_process_single_alert_already_notified_skipped():
    """
    A tee time that already has an alert_notification record should NOT
    trigger another insert.
    """
    from app.services.alert_service import process_single_alert

    tee_times = [{"id": 42, "course_id": 100, "tee_time": "2026-03-24T12:00:00+00:00", "holes": 18}]
    existing_notifications = [{"id": 99}]
    supabase, avail_table, notif_table = make_supabase_for_process(
        tee_times=tee_times,
        existing_notifications=existing_notifications,
    )

    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    summaries = {}
    alert = make_alert()

    await process_single_alert(supabase, alert, now, summaries)

    notif_table.insert.assert_not_called()
    assert 1 not in summaries


async def test_process_single_alert_multiple_new_tee_times():
    """Multiple new tee times result in multiple inserts and correct count in summary."""
    from app.services.alert_service import process_single_alert

    tee_times = [
        {"id": 10, "course_id": 100, "tee_time": "2026-03-24T12:00:00+00:00", "holes": 18},
        {"id": 11, "course_id": 100, "tee_time": "2026-03-24T12:30:00+00:00", "holes": 18},
        {"id": 12, "course_id": 100, "tee_time": "2026-03-24T13:00:00+00:00", "holes": 18},
    ]
    supabase, avail_table, notif_table = make_supabase_for_process(
        tee_times=tee_times, existing_notifications=[]
    )

    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    summaries = {}
    alert = make_alert()

    await process_single_alert(supabase, alert, now, summaries)

    assert summaries[1]["count"] == 3


# ---------------------------------------------------------------------------
# players filter in process_single_alert
# ---------------------------------------------------------------------------

async def test_players_filter_applied_when_set():
    """
    When alert.players=3, the query must include an or_ filter that allows
    spots_available IS NULL or spots_available >= 3.
    """
    from app.services.alert_service import process_single_alert

    tee_times = [{"id": 55, "course_id": 100, "tee_time": "2026-03-24T12:00:00+00:00", "holes": 18}]
    supabase, avail_table, notif_table = make_supabase_for_process(tee_times=tee_times)

    alert = make_alert(players=3)
    await process_single_alert(supabase, alert, datetime(2026, 3, 24, tzinfo=timezone.utc), {})

    # or_ must have been called on the availability query chain
    avail_table.select.return_value.or_.assert_called_once()
    call_arg = avail_table.select.return_value.or_.call_args[0][0]
    assert "spots_available.is.null" in call_arg
    assert "spots_available.gte.3" in call_arg


async def test_players_filter_not_applied_when_none():
    """
    When alert.players=None (Any), or_ must NOT be called on the query.
    """
    from app.services.alert_service import process_single_alert

    tee_times = [{"id": 56, "course_id": 100, "tee_time": "2026-03-24T12:00:00+00:00", "holes": 18}]
    supabase, avail_table, notif_table = make_supabase_for_process(tee_times=tee_times)

    alert = make_alert(players=None)
    await process_single_alert(supabase, alert, datetime(2026, 3, 24, tzinfo=timezone.utc), {})

    avail_table.select.return_value.or_.assert_not_called()
