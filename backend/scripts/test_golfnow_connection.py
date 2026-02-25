import httpx
import asyncio
import json

async def test_golfnow():
    url = "https://www.golfnow.com/api/tee-times/tee-time-results"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Referer": "https://www.golfnow.com/",
        "Origin": "https://www.golfnow.com",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    }
    # Morris Williams Golf Course (Facility 620) - Using a valid common facility
    payload = {
        "PageSize": 1000,
        "PageNumber": 0,
        "SearchType": 1,
        "SortBy": "Date",
        "SortDirection": 0,
        "Date": "Feb 28 2026",
        "Players": "0",
        "TimePeriod": "3",
        "FacilityType": "0",
        "RateType": "all",
        "TimeMin": "0",
        "TimeMax": "48",
        "FacilityId": 620,
        "SortByRollup": "Date.MinDate",
        "View": "Grouping",
        "TeeTimeCount": 1000,
    }

    print(f"Testing connectivity to {url}...")
    print(f"Request Payload: {json.dumps(payload, indent=2)}")
    
    async with httpx.AsyncClient() as client:
        try:
            # Check outbound IP first
            ip_resp = await client.get("https://api.ipify.org?format=json")
            print(f"Outbound IP: {ip_resp.json()['ip']}")
            
            resp = await client.post(url, headers=headers, json=payload, timeout=10.0)
            print(f"Status Code: {resp.status_code}")
            
            if resp.status_code == 200:
                print("SUCCESS: Connection established and 200 OK received.")
                body = resp.json()
                print(f"Response Body: {json.dumps(body, indent=2)}")
                tee_times = (body.get("ttResults") or {}).get("teeTimes") or []
                print(f"Found {len(tee_times)} tee times.")
                for tt in tee_times[:3]:
                    print(f" - {tt.get('time')} | ${tt.get('minPretaxPrice')} | {tt.get('maxPlayerCount')} players")
            elif resp.status_code == 403:
                print("FAILURE: 403 Forbidden. GitHub IP is likely blocked.")
            else:
                print(f"UNEXPECTED: Received status code {resp.status_code}")
                print(resp.text)
                
        except Exception as e:
            print(f"ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(test_golfnow())
