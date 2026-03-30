"""
Tests for CPS normalize_and_store logic.

Covers:
  - content as dict (NO_TEETIMES response for past/empty dates) → treated as empty
  - content as None → treated as empty
  - content as list → processed normally
  - opts response as string → handled gracefully (isinstance guard)
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone


CPS_COURSE = {"id": 9535, "name": "Emerald Lake Golf Club", "time_zone": "America/New_York"}


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


# ---------------------------------------------------------------------------
# normalize_and_store: raw_data shape handling
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_empty_list_stores_nothing():
    """Empty raw_data produces no upsert."""
    supabase = make_supabase_mock()
    with patch("app.services.cps_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.cps_service import normalize_and_store
        await normalize_and_store(CPS_COURSE, [], "Mon Mar 30 2026")

    supabase.table().upsert.assert_not_called()


@pytest.mark.asyncio
async def test_valid_tee_time_is_stored():
    """A well-formed CPS item is normalized and upserted."""
    supabase = make_supabase_mock()
    raw = [{
        "startTime": "2026-03-30T07:00:00",
        "availableParticipantNo": [1, 2, 3, 4],
        "isContain18HoleItems": True,
        "isContain9HoleItems": False,
        "shItemPrices": [{"shItemCode": "GreenFee18", "currentPrice": 55.0}],
    }]
    with patch("app.services.cps_service.create_supabase", AsyncMock(return_value=supabase)):
        from app.services.cps_service import normalize_and_store
        await normalize_and_store(CPS_COURSE, raw, "Mon Mar 30 2026")

    supabase.table().upsert.assert_called_once()
    rows = supabase.table().upsert.call_args[0][0]
    assert len(rows) == 1
    assert rows[0]["holes"] == 18
    assert rows[0]["price"] == 55.0
    assert rows[0]["spots_available"] == 4


# ---------------------------------------------------------------------------
# fetch_cps_times: content shape handling
# ---------------------------------------------------------------------------

def _make_http_response(status_code, json_body):
    import httpx
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.is_success = (200 <= status_code < 300)
    resp.json = MagicMock(return_value=json_body)
    resp.raise_for_status = MagicMock(side_effect=None)
    return resp


def _make_client_mock(seed_resp, opts_resp, reg_resp, tee_times_resp):
    """Builds an AsyncClient mock returning responses in order for get/post calls."""
    client = AsyncMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)
    client.get = AsyncMock(side_effect=[seed_resp, seed_resp, opts_resp, tee_times_resp])
    client.post = AsyncMock(return_value=reg_resp)
    return client


def _standard_mocks(tee_times_body):
    seed = _make_http_response(200, "")
    opts = _make_http_response(200, {"webSiteId": "abc", "reservationOptions": {"terminalId": 3}})
    reg  = _make_http_response(200, {})
    tts  = _make_http_response(200, tee_times_body)
    return seed, opts, reg, tts


@pytest.mark.asyncio
async def test_content_as_dict_returns_empty_list():
    """
    When CPS returns content as a dict (NO_TEETIMES error object for past/empty dates),
    fetch_cps_times should return [] rather than crashing.
    """
    no_tee_times_body = {
        "isSuccess": True,
        "content": {
            "messageKey": "NO_TEETIMES",
            "messageTemplate": "No tee times available",
        },
    }
    seed, opts, reg, tts = _standard_mocks(no_tee_times_body)

    with patch("app.services.cps_service.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value = _make_client_mock(seed, opts, reg, tts)
        from app.services.cps_service import fetch_cps_times
        result = await fetch_cps_times("emeraldlake", "fake-key", 1, "Sat Mar 28 2026")

    assert result == []


@pytest.mark.asyncio
async def test_content_as_none_returns_empty_list():
    """content: null in response returns []."""
    body = {"isSuccess": True, "content": None}
    seed, opts, reg, tts = _standard_mocks(body)

    with patch("app.services.cps_service.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value = _make_client_mock(seed, opts, reg, tts)
        from app.services.cps_service import fetch_cps_times
        result = await fetch_cps_times("emeraldlake", "fake-key", 1, "Sat Mar 28 2026")

    assert result == []


@pytest.mark.asyncio
async def test_is_success_false_returns_empty_list():
    """isSuccess=False returns []."""
    body = {"isSuccess": False, "content": []}
    seed, opts, reg, tts = _standard_mocks(body)

    with patch("app.services.cps_service.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value = _make_client_mock(seed, opts, reg, tts)
        from app.services.cps_service import fetch_cps_times
        result = await fetch_cps_times("emeraldlake", "fake-key", 1, "Sat Mar 28 2026")

    assert result == []


@pytest.mark.asyncio
async def test_opts_as_string_handled_gracefully():
    """If GetAllOptions returns a plain string (not a dict), request still proceeds."""
    seed = _make_http_response(200, "")
    opts = _make_http_response(200, "unexpected string response")
    reg  = _make_http_response(200, {})
    tts  = _make_http_response(200, {"isSuccess": True, "content": []})

    with patch("app.services.cps_service.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value = _make_client_mock(seed, opts, reg, tts)
        from app.services.cps_service import fetch_cps_times
        result = await fetch_cps_times("emeraldlake", "fake-key", 1, "Mon Mar 30 2026")

    assert result == []
