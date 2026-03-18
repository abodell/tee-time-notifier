"""
Tests for Quick18 normalize_quick18 pure function.

normalize_quick18 is synchronous and takes raw HTML as input — no DB mock needed.

Covers:
  - Extracts time and price from matrixTable rows
  - Applies course timezone when converting to UTC
  - Deduplicates rows (same time+holes → keep lowest price)
  - Returns empty list when no matrixTable found
  - Skips rows missing time or price
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime
from dateutil import tz

from app.services.quick18_service import normalize_quick18


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_matrix_html(rows: list[str]) -> str:
    """Wrap rows in a minimal Quick18-style matrixTable."""
    row_html = "\n".join(f"<tr>{r}</tr>" for r in rows)
    return f"""
    <html><body>
    <table class="matrixTable">
    {row_html}
    </table>
    </body></html>
    """


def make_row(time_str="7:00 AM", price="55.00"):
    """Build a minimal matrixTable row with time and price."""
    return f"<td>{time_str}</td><td>${price}</td>"


DATE_STR = "20260324"
COURSE_ID = 1


# ---------------------------------------------------------------------------
# Basic parsing
# ---------------------------------------------------------------------------

def test_extracts_time_and_price_from_matrix():
    """A row with time + price should produce one tee-time entry."""
    html = make_matrix_html([make_row("7:00 AM", "55.00")])
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/Chicago")
    assert len(result) == 1
    assert result[0]["price"] == 55.0


def test_multiple_rows_produce_multiple_entries():
    """Multiple rows produce multiple tee-time entries."""
    html = make_matrix_html([
        make_row("7:00 AM", "55.00"),
        make_row("7:10 AM", "55.00"),
        make_row("7:20 AM", "60.00"),
    ])
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/Chicago")
    assert len(result) == 3


def test_no_matrix_table_returns_empty():
    """HTML without matrixTable → empty list."""
    html = "<html><body><p>No tee times today.</p></body></html>"
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/Chicago")
    assert result == []


def test_row_without_price_skipped():
    """Rows with no price match are skipped."""
    html = make_matrix_html(["<td>7:00 AM</td><td>Contact club for pricing</td>"])
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/Chicago")
    assert result == []


def test_row_without_time_skipped():
    """Rows with no time match are skipped."""
    html = make_matrix_html(["<td>$55.00</td>"])
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/Chicago")
    assert result == []


# ---------------------------------------------------------------------------
# Timezone conversion
# ---------------------------------------------------------------------------

def test_central_7am_stored_as_12pm_utc():
    """7:00 AM in CDT (America/Chicago) → 12:00 UTC."""
    html = make_matrix_html([make_row("7:00 AM", "55.00")])
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/Chicago")
    assert len(result) == 1
    stored_dt = datetime.fromisoformat(result[0]["tee_time"])
    utc_hour = stored_dt.astimezone(tz.tzutc()).hour
    assert utc_hour == 12, f"Expected 12 UTC, got {utc_hour}"


def test_eastern_7am_stored_as_11am_utc():
    """7:00 AM in EDT (America/New_York) → 11:00 UTC."""
    html = make_matrix_html([make_row("7:00 AM", "45.00")])
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/New_York")
    stored_dt = datetime.fromisoformat(result[0]["tee_time"])
    utc_hour = stored_dt.astimezone(tz.tzutc()).hour
    assert utc_hour == 11, f"Expected 11 UTC, got {utc_hour}"


def test_pacific_7am_stored_as_2pm_utc():
    """7:00 AM in PDT (America/Los_Angeles) → 14:00 UTC."""
    html = make_matrix_html([make_row("7:00 AM", "65.00")])
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/Los_Angeles")
    stored_dt = datetime.fromisoformat(result[0]["tee_time"])
    utc_hour = stored_dt.astimezone(tz.tzutc()).hour
    assert utc_hour == 14, f"Expected 14 UTC, got {utc_hour}"


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def test_duplicate_time_keeps_lowest_price():
    """Two rows with the same time: lowest price is kept."""
    html = make_matrix_html([
        make_row("7:00 AM", "55.00"),
        make_row("7:00 AM", "45.00"),  # cheaper
    ])
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/Chicago")
    assert len(result) == 1
    assert result[0]["price"] == 45.0


def test_different_times_not_deduplicated():
    """Two rows with different times are kept as separate entries."""
    html = make_matrix_html([
        make_row("7:00 AM", "55.00"),
        make_row("7:30 AM", "55.00"),
    ])
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/Chicago")
    assert len(result) == 2


# ---------------------------------------------------------------------------
# Fields
# ---------------------------------------------------------------------------

def test_holes_always_18():
    """Quick18 always produces 18-hole entries."""
    html = make_matrix_html([make_row("8:00 AM", "60.00")])
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/Chicago")
    assert result[0]["holes"] == 18


def test_course_id_stored():
    """course_id is passed through correctly."""
    html = make_matrix_html([make_row("8:00 AM", "60.00")])
    result = normalize_quick18(html, 42, DATE_STR, "America/Chicago")
    assert result[0]["course_id"] == 42


def test_available_true():
    """All parsed rows are marked available=True."""
    html = make_matrix_html([make_row("8:00 AM", "60.00")])
    result = normalize_quick18(html, COURSE_ID, DATE_STR, "America/Chicago")
    assert result[0]["available"] is True
