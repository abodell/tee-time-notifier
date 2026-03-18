"""
Tests for alert notification logic: formatting, matching, and push dispatch.

Covers:
  - fmt() formats tee times in course-local timezone (not UTC)
  - Exact match: finds tee time within alert window → sends notification
  - Nearby match: finds tee time outside window but within ±3 days
  - No match: sends "watching" message
  - Notification text format
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# fmt() — pure function extracted from _check_and_notify for unit testing
# ---------------------------------------------------------------------------

def make_fmt(tz_name: str):
    """Replicate the fmt() closure from _check_and_notify."""
    try:
        course_tz = ZoneInfo(tz_name)
    except Exception:
        course_tz = timezone.utc

    def fmt(dt: datetime) -> str:
        local_dt = dt.astimezone(course_tz)
        time_str = local_dt.strftime("%I:%M %p").lstrip("0")
        return f"{local_dt.strftime('%a %b')} {local_dt.day} at {time_str}"

    return fmt


class TestFmt:
    def test_central_course_7am_cdt(self):
        """
        Regression: 12:00 UTC for a Central (CDT) course must show 7AM, not 6AM.
        Before fix: GolfNow stored wrong UTC → 11:00 UTC → 6AM CDT.
        After fix:  correct UTC stored → 12:00 UTC → 7AM CDT. ✓
        """
        fmt = make_fmt("America/Chicago")
        tee_dt = datetime(2026, 3, 24, 12, 0, 0, tzinfo=timezone.utc)  # 7AM CDT
        result = fmt(tee_dt)
        assert "7:00 AM" in result, f"Expected '7:00 AM' in '{result}'"

    def test_eastern_course_7am_edt(self):
        """Eastern course: 11:00 UTC → 7AM EDT."""
        fmt = make_fmt("America/New_York")
        tee_dt = datetime(2026, 3, 24, 11, 0, 0, tzinfo=timezone.utc)  # 7AM EDT
        result = fmt(tee_dt)
        assert "7:00 AM" in result, f"Expected '7:00 AM' in '{result}'"

    def test_pacific_course_7am_pdt(self):
        """Pacific course: 14:00 UTC → 7AM PDT."""
        fmt = make_fmt("America/Los_Angeles")
        tee_dt = datetime(2026, 3, 24, 14, 0, 0, tzinfo=timezone.utc)  # 7AM PDT
        result = fmt(tee_dt)
        assert "7:00 AM" in result, f"Expected '7:00 AM' in '{result}'"

    def test_does_not_show_utc_time(self):
        """A 12:00 UTC tee time must NOT show '12:00 PM' for a CDT course."""
        fmt = make_fmt("America/Chicago")
        tee_dt = datetime(2026, 3, 24, 12, 0, 0, tzinfo=timezone.utc)
        result = fmt(tee_dt)
        assert "12:00 PM" not in result, f"Should not show UTC time, got '{result}'"

    def test_invalid_tz_falls_back_to_utc(self):
        """An unrecognized timezone name should fall back to UTC without crashing."""
        fmt = make_fmt("Not/A_Timezone")
        tee_dt = datetime(2026, 3, 24, 12, 0, 0, tzinfo=timezone.utc)
        result = fmt(tee_dt)
        assert "12:00 PM" in result  # UTC fallback

    def test_leading_zero_stripped(self):
        """Hours should not have a leading zero: '7:00 AM' not '07:00 AM'."""
        fmt = make_fmt("America/Chicago")
        tee_dt = datetime(2026, 3, 24, 12, 0, 0, tzinfo=timezone.utc)  # 7AM CDT
        result = fmt(tee_dt)
        assert not result.split("at ")[1].startswith("0"), (
            f"Hour should not have leading zero: '{result}'"
        )

    def test_noon_shows_pm(self):
        """12PM local should show 'PM', not 'AM'."""
        fmt = make_fmt("America/Chicago")
        # Noon CDT = 17:00 UTC
        tee_dt = datetime(2026, 3, 24, 17, 0, 0, tzinfo=timezone.utc)
        result = fmt(tee_dt)
        assert "PM" in result, f"Expected PM for noon CDT, got '{result}'"

    def test_date_format_includes_day_of_week_and_month(self):
        """fmt() result should include abbreviated weekday and month."""
        fmt = make_fmt("America/Chicago")
        tee_dt = datetime(2026, 3, 24, 12, 0, 0, tzinfo=timezone.utc)  # Tuesday Mar 24
        result = fmt(tee_dt)
        assert "Tue" in result, f"Expected weekday abbrev in '{result}'"
        assert "Mar" in result, f"Expected month abbrev in '{result}'"


# ---------------------------------------------------------------------------
# _check_and_notify integration — with mocked supabase + push
# ---------------------------------------------------------------------------

def make_alert(course_tz="America/Chicago"):
    """Build a minimal alert dict as returned from supabase."""
    now = datetime(2026, 3, 24, tzinfo=timezone.utc)
    return {
        "id": 1,
        "user_id": "user-abc",
        "course_id": 100,
        "holes": 18,
        "active": True,
        "start_time": datetime(2026, 3, 24, 12, 0, 0, tzinfo=timezone.utc).isoformat(),
        "end_time": datetime(2026, 3, 24, 16, 0, 0, tzinfo=timezone.utc).isoformat(),
        "courses": {
            "id": 100,
            "name": "Lions Municipal",
            "provider": "GolfNow",
            "time_zone": course_tz,
        },
    }


def make_supabase_mock_for_notify(exact_tee_time=None, nearby_tee_time=None, push_token="ExponentPushToken[test]"):
    """Mock supabase for _check_and_notify tests."""
    mock = MagicMock()

    def table(name):
        t = MagicMock()

        if name == "profiles":
            chain = MagicMock()
            chain.execute = AsyncMock(return_value=MagicMock(
                data=[{"push_token": push_token}] if push_token else []
            ))
            chain.eq = MagicMock(return_value=chain)
            t.select = MagicMock(return_value=chain)

        elif name == "alerts":
            chain = MagicMock()
            chain.execute = AsyncMock(return_value=MagicMock(data=[make_alert()]))
            chain.eq = MagicMock(return_value=chain)
            chain.single = MagicMock(return_value=chain)
            t.select = MagicMock(return_value=chain)

        elif name == "availability":
            def select_side_effect(*args, **kwargs):
                chain = MagicMock()
                chain.eq = MagicMock(return_value=chain)
                chain.gte = MagicMock(return_value=chain)
                chain.lte = MagicMock(return_value=chain)
                chain.order = MagicMock(return_value=chain)
                chain.limit = MagicMock(return_value=chain)

                # First call → exact match, second → nearby
                call_count = getattr(select_side_effect, "_calls", 0)
                select_side_effect._calls = call_count + 1

                if call_count == 0 and exact_tee_time:
                    chain.execute = AsyncMock(return_value=MagicMock(
                        data=[{"id": 1, "tee_time": exact_tee_time}]
                    ))
                elif call_count == 1 and nearby_tee_time:
                    chain.execute = AsyncMock(return_value=MagicMock(
                        data=[{"id": 2, "tee_time": nearby_tee_time}]
                    ))
                else:
                    chain.execute = AsyncMock(return_value=MagicMock(data=[]))

                return chain

            t.select = MagicMock(side_effect=select_side_effect)

        elif name == "alert_notifications":
            chain = MagicMock()
            chain.execute = AsyncMock(return_value=MagicMock(data=[{"id": 1}]))
            t.insert = MagicMock(return_value=chain)

        return t

    mock.table = MagicMock(side_effect=table)
    return mock


class TestCheckAndNotify:
    async def test_exact_match_sends_tee_time_notification(self):
        """When an exact tee time is found, push notification includes course name + time."""
        from app.routes.alerts import _check_and_notify

        exact_time = datetime(2026, 3, 24, 12, 0, 0, tzinfo=timezone.utc).isoformat()
        supabase = make_supabase_mock_for_notify(exact_tee_time=exact_time)

        sent = []
        with patch("app.routes.alerts.send_push_notification", new=AsyncMock(side_effect=lambda *a, **kw: sent.append(a))), \
             patch("app.routes.alerts.get_user_push_token", new=AsyncMock(return_value="ExponentPushToken[test]")):
            await _check_and_notify(alert_id=1, supabase=supabase, alert=make_alert())

        assert len(sent) == 1
        title, body = sent[0][1], sent[0][2]
        assert "Lions Municipal" in title
        assert "Tap to book" in body
        assert "7:00 AM" in body  # CDT for 12:00 UTC

    async def test_exact_match_notification_shows_course_local_time(self):
        """Notification body must show course-local time, not UTC."""
        from app.routes.alerts import _check_and_notify

        # 12:00 UTC = 7AM CDT (correct) not 12PM UTC (wrong)
        exact_time = datetime(2026, 3, 24, 12, 0, 0, tzinfo=timezone.utc).isoformat()
        supabase = make_supabase_mock_for_notify(exact_tee_time=exact_time)

        sent = []
        with patch("app.routes.alerts.send_push_notification", new=AsyncMock(side_effect=lambda *a, **kw: sent.append(a))), \
             patch("app.routes.alerts.get_user_push_token", new=AsyncMock(return_value="ExponentPushToken[test]")):
            await _check_and_notify(alert_id=1, supabase=supabase, alert=make_alert())

        body = sent[0][2]
        assert "12:00 PM" not in body, f"Should not show UTC time in body: '{body}'"
        assert "7:00 AM" in body, f"Should show 7AM CDT: '{body}'"

    async def test_no_push_token_skips_notification(self):
        """If user has no push token, no notification is sent."""
        from app.routes.alerts import _check_and_notify

        exact_time = datetime(2026, 3, 24, 12, 0, 0, tzinfo=timezone.utc).isoformat()
        supabase = make_supabase_mock_for_notify(exact_tee_time=exact_time)

        sent = []
        with patch("app.routes.alerts.send_push_notification", new=AsyncMock(side_effect=lambda *a, **kw: sent.append(a))), \
             patch("app.routes.alerts.get_user_push_token", new=AsyncMock(return_value=None)):
            await _check_and_notify(alert_id=1, supabase=supabase, alert=make_alert())

        assert len(sent) == 0

    async def test_no_match_sends_watching_message(self):
        """When no tee times are found at all, a 'watching' push is sent."""
        from app.routes.alerts import _check_and_notify

        supabase = make_supabase_mock_for_notify()  # no exact or nearby

        sent = []
        with patch("app.routes.alerts.send_push_notification", new=AsyncMock(side_effect=lambda *a, **kw: sent.append(a))), \
             patch("app.routes.alerts.get_user_push_token", new=AsyncMock(return_value="ExponentPushToken[test]")):
            await _check_and_notify(alert_id=1, supabase=supabase, alert=make_alert())

        assert len(sent) == 1
        body = sent[0][2]
        assert "watching" in body.lower() or "No openings" in body
