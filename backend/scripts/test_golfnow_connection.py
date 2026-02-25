import httpx
import asyncio
import json

async def test_golfnow():
    url = "https://www.golfnow.com/api/tee-times/tee-time-results"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Referer": "https://www.golfnow.com/",
        "Origin": "https://www.golfnow.com"
    }
    # Morris Williams Golf Course (Facility 620) - Using a valid common facility
    payload = {
        "PageSize": 1,
        "SearchType": 1,
        "Date": "Feb 28 2026",
        "FacilityId": 620
    }

    print(f"Testing connectivity to {url}...")
    
    async with httpx.AsyncClient() as client:
        try:
            # Check outbound IP first
            ip_resp = await client.get("https://api.ipify.org?format=json")
            print(f"Outbound IP: {ip_resp.json()['ip']}")
            
            resp = await client.post(url, headers=headers, json=payload, timeout=10.0)
            print(f"Status Code: {resp.status_code}")
            
            if resp.status_code == 200:
                print("SUCCESS: Connection established and 200 OK received.")
                # print(resp.text[:500]) # Print first 500 chars of response
            elif resp.status_code == 403:
                print("FAILURE: 403 Forbidden. GitHub IP is likely blocked.")
            else:
                print(f"UNEXPECTED: Received status code {resp.status_code}")
                print(resp.text)
                
        except Exception as e:
            print(f"ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(test_golfnow())
