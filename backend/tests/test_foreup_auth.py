"""
Tests for ForeUp authenticated scanning (Bethpage resident booking class).

Covers:
  - Non-auth courses: _get_auth_token returns None (no use_auth config)
  - Auth courses: JWT is fetched on first call and cached for subsequent calls
  - Auth courses: 401 response evicts cache, re-logins, and retries the request
  - Missing env credentials: _login_foreup returns None gracefully
  - fetch_foreup_times: x-authorization header present when use_auth=true
  - fetch_foreup_times: no x-authorization header for regular courses
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import httpx
from datetime import datetime, timezone


BETHPAGE_COURSE = {"id": 9536, "name": "Bethpage Red", "time_zone": "America/New_York"}
REGULAR_COURSE  = {"id": 1,    "name": "Regular Course", "time_zone": "America/Chicago"}

BETHPAGE_CONFIGS = {
    "use_auth": "true",
    "course_id": "19765",
    "booking_class": "50295",
    "schedule_id": "2432",
    "schedule_ids": [2433, 2539, 2432, 2435],
    "api_key": "no_limits",
    "login_booking_class_id": "50293",
}

REGULAR_CONFIGS = {
    "course_id": "12345",
    "booking_class": "999",
    "schedule_id": "111",
    "schedule_ids": [111],
    "api_key": "no_limits",
}

FAKE_JWT = "eyJ.fake.jwt"


def _make_http_response(status_code: int, json_body):
    """Build a mock httpx.Response-like object."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.is_success = (200 <= status_code < 300)
    resp.json = MagicMock(return_value=json_body)
    resp.raise_for_status = MagicMock(
        side_effect=None if resp.is_success else httpx.HTTPStatusError(
            "error", request=MagicMock(), response=resp
        )
    )
    return resp


# ---------------------------------------------------------------------------
# _get_auth_token
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_auth_token_returns_none_for_non_auth_course():
    """Courses without use_auth should get None — no login attempted."""
    import app.services.foreup_service as svc
    svc._jwt_cache.clear()

    with patch.object(svc, "_login_foreup", new=AsyncMock()) as mock_login:
        token = await svc._get_auth_token(REGULAR_CONFIGS)

    assert token is None
    mock_login.assert_not_called()


@pytest.mark.asyncio
async def test_get_auth_token_logins_when_cache_empty():
    """First call for an auth course should trigger login."""
    import app.services.foreup_service as svc
    svc._jwt_cache.clear()

    with patch.object(svc, "_login_foreup", new=AsyncMock(return_value=FAKE_JWT)) as mock_login:
        token = await svc._get_auth_token(BETHPAGE_CONFIGS)

    assert token == FAKE_JWT
    mock_login.assert_called_once_with("19765", "50293")


@pytest.mark.asyncio
async def test_get_auth_token_uses_cache_on_repeat_calls():
    """Subsequent calls for the same facility should use the cached JWT, not re-login."""
    import app.services.foreup_service as svc
    svc._jwt_cache.clear()
    svc._jwt_cache["19765"] = (FAKE_JWT, datetime.now(timezone.utc))

    with patch.object(svc, "_login_foreup", new=AsyncMock()) as mock_login:
        token = await svc._get_auth_token(BETHPAGE_CONFIGS)

    assert token == FAKE_JWT
    mock_login.assert_not_called()


# ---------------------------------------------------------------------------
# _login_foreup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_login_foreup_returns_none_when_no_credentials():
    """If FOREUP_USERNAME/PASSWORD are empty, login returns None without making a request."""
    import app.services.foreup_service as svc
    svc._jwt_cache.clear()

    with patch("app.services.foreup_service.settings") as mock_settings:
        mock_settings.FOREUP_USERNAME = ""
        mock_settings.FOREUP_PASSWORD = ""
        token = await svc._login_foreup("19765")

    assert token is None


@pytest.mark.asyncio
async def test_login_foreup_returns_none_on_failed_response():
    """Non-2xx login response returns None."""
    import app.services.foreup_service as svc
    svc._jwt_cache.clear()

    failed_resp = _make_http_response(401, {"error": "bad credentials"})

    with patch("app.services.foreup_service.settings") as mock_settings, \
         patch("app.services.foreup_service.AsyncClient") as mock_client_cls:
        mock_settings.FOREUP_USERNAME = "user@example.com"
        mock_settings.FOREUP_PASSWORD = "password"

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.post = AsyncMock(return_value=failed_resp)
        mock_client_cls.return_value = mock_client

        token = await svc._login_foreup("19765")

    assert token is None


@pytest.mark.asyncio
async def test_login_foreup_caches_and_returns_jwt():
    """Successful login stores JWT in cache and returns it."""
    import app.services.foreup_service as svc
    svc._jwt_cache.clear()

    success_resp = _make_http_response(200, {"jwt": FAKE_JWT, "logged_in": True})

    with patch("app.services.foreup_service.settings") as mock_settings, \
         patch("app.services.foreup_service.AsyncClient") as mock_client_cls:
        mock_settings.FOREUP_USERNAME = "user@example.com"
        mock_settings.FOREUP_PASSWORD = "password"

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.post = AsyncMock(return_value=success_resp)
        mock_client_cls.return_value = mock_client

        token = await svc._login_foreup("19765")

    assert token == FAKE_JWT
    assert svc._jwt_cache["19765"][0] == FAKE_JWT


# ---------------------------------------------------------------------------
# fetch_foreup_times — header behaviour
# ---------------------------------------------------------------------------

def _make_async_client_mock(responses: list):
    """Return a mock AsyncClient whose .get() returns responses in order."""
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = AsyncMock(side_effect=responses)
    return mock_client


@pytest.mark.asyncio
async def test_fetch_foreup_times_includes_auth_header_for_bethpage():
    """x-authorization header is sent when use_auth=true."""
    import app.services.foreup_service as svc
    svc._jwt_cache.clear()
    svc._jwt_cache["19765"] = (FAKE_JWT, datetime.now(timezone.utc))

    ok_resp = _make_http_response(200, [{"time": "2026-04-04T07:00:00", "holes": "18", "green_fee": 50}])

    with patch("app.services.foreup_service.AsyncClient") as mock_client_cls:
        mock_client = _make_async_client_mock([ok_resp])
        mock_client_cls.return_value = mock_client

        await svc.fetch_foreup_times(BETHPAGE_COURSE, BETHPAGE_CONFIGS, "04-04-2026")

    call_kwargs = mock_client.get.call_args
    sent_headers = mock_client_cls.call_args[1]["headers"]
    assert "x-authorization" in sent_headers
    assert sent_headers["x-authorization"] == f"Bearer {FAKE_JWT}"


@pytest.mark.asyncio
async def test_fetch_foreup_times_no_auth_header_for_regular_course():
    """x-authorization header is NOT sent for courses without use_auth."""
    import app.services.foreup_service as svc
    svc._jwt_cache.clear()

    ok_resp = _make_http_response(200, [{"time": "2026-03-24T07:00:00", "holes": "18", "green_fee": 45}])

    with patch("app.services.foreup_service.AsyncClient") as mock_client_cls:
        mock_client = _make_async_client_mock([ok_resp])
        mock_client_cls.return_value = mock_client

        await svc.fetch_foreup_times(REGULAR_COURSE, REGULAR_CONFIGS, "03-24-2026")

    sent_headers = mock_client_cls.call_args[1]["headers"]
    assert "x-authorization" not in sent_headers


# ---------------------------------------------------------------------------
# fetch_foreup_times — 401 retry
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fetch_foreup_times_retries_after_401():
    """
    On 401, the cached JWT is evicted, login is called, and the request is retried.
    The retry should succeed and return tee time data.
    """
    import app.services.foreup_service as svc
    svc._jwt_cache.clear()
    svc._jwt_cache["19765"] = ("expired.jwt", datetime.now(timezone.utc))

    NEW_JWT = "new.fresh.jwt"
    ok_body = [{"time": "2026-04-04T07:00:00", "holes": "18", "green_fee": 50}]

    unauthorized_resp = _make_http_response(401, {"success": False})
    ok_resp = _make_http_response(200, ok_body)

    with patch("app.services.foreup_service.AsyncClient") as mock_client_cls, \
         patch.object(svc, "_login_foreup", new=AsyncMock(return_value=NEW_JWT)) as mock_login:

        mock_client = _make_async_client_mock([unauthorized_resp, ok_resp])
        mock_client_cls.return_value = mock_client

        result = await svc.fetch_foreup_times(BETHPAGE_COURSE, BETHPAGE_CONFIGS, "04-04-2026")

    mock_login.assert_called_once_with("19765", "50293")
    assert "19765" not in svc._jwt_cache or svc._jwt_cache.get("19765") == NEW_JWT
    assert result == ok_body
