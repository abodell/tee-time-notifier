"""
Google Places Text Search service with in-memory caching.
Used for searching golf courses.
"""
import time
import httpx
import re
from app.config import settings

# Simple in-memory cache: {query: {"data": [...], "timestamp": float}}
_cache: dict = {}
CACHE_TTL_SECONDS = 3600  # 1 hour

# US state abbreviations for parsing
US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"
}


def _get_cache_key(query: str) -> str:
    """Normalize query for cache key."""
    return query.strip().lower()


def _is_cache_valid(cache_entry: dict) -> bool:
    """Check if cache entry is still valid."""
    return (time.time() - cache_entry["timestamp"]) < CACHE_TTL_SECONDS


def _parse_address_components(formatted_address: str) -> tuple[str, str, str]:
    """
    Parse formatted_address to extract street address, city, and state.
    
    Google Places formatted_address is typically:
    "Street Address, City, State ZIP, Country" or
    "Street Address, City, State ZIP, USA"
    
    Returns: (street_address, city, state)
    """
    parts = [p.strip() for p in formatted_address.split(",")]
    
    street_address = ""
    city = ""
    state = ""
    
    if len(parts) >= 4:
        # Format: "Street, City, State ZIP, Country"
        street_address = parts[0]
        city = parts[1]
        state_zip = parts[2]
    elif len(parts) == 3:
        # Format: "City, State ZIP, Country" (no street) or "Street, City, State ZIP"
        # Check if last part looks like a country
        if parts[-1].upper() in ["USA", "US", "UNITED STATES"]:
            city = parts[0]
            state_zip = parts[1]
        else:
            street_address = parts[0]
            city = parts[1]
            state_zip = parts[2]
    elif len(parts) == 2:
        city = parts[0]
        state_zip = parts[1]
    else:
        return street_address, city, state
    
    # Extract state from "State ZIP" or just "State"
    # Pattern: one or more words followed by optional 5-digit ZIP
    state_zip_match = re.match(r'^([A-Za-z\s]+?)(?:\s+\d{5}(?:-\d{4})?)?$', state_zip.strip())
    if state_zip_match:
        potential_state = state_zip_match.group(1).strip()
        # Check if it's a state abbreviation or full name
        if potential_state.upper() in US_STATES:
            state = potential_state.upper()
        elif len(potential_state) <= 20:  # Reasonable length for a state name
            state = potential_state
    
    return street_address, city, state


async def search_golf_courses(query: str) -> list[dict]:
    """
    Search for golf courses using Google Places Text Search API.
    Results are cached for CACHE_TTL_SECONDS.
    
    Returns list of dicts with: place_id, name, address, city, state
    """
    if not settings.GOOGLE_MAPS_API_KEY:
        raise ValueError("GOOGLE_MAPS_API_KEY is not set")
    
    cache_key = _get_cache_key(query)
    
    # Check cache first
    if cache_key in _cache and _is_cache_valid(_cache[cache_key]):
        return _cache[cache_key]["data"]
    
    # Make API request - use type filter only, don't append "golf course" to query
    # This allows more flexible matching (e.g., "The Lido" will match)
    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    params = {
        "query": f"{query} golf course",
        "type": "golf_course",
        "region": "us",
        "key": settings.GOOGLE_MAPS_API_KEY,
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        data = response.json()
    
    results = []
    for place in data.get("results", [])[:15]:  # Increased limit to 15 results
        formatted_address = place.get("formatted_address", "")
        street_address, city, state = _parse_address_components(formatted_address)
        
        results.append({
            "place_id": place.get("place_id", ""),
            "name": place.get("name", ""),
            "address": formatted_address,
            "street_address": street_address,
            "city": city,
            "state": state,
        })
    
    # Cache the results
    _cache[cache_key] = {
        "data": results,
        "timestamp": time.time()
    }
    
    return results


def clear_cache():
    """Clear the entire cache. Useful for testing."""
    global _cache
    _cache = {}
