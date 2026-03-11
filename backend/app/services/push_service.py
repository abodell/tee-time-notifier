import httpx
import os

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

async def send_push_notification(token: str, title: str, body: str, data: dict = None):
    """
    Sends a push notification using Expo Push API
    """
    if not token.startswith("ExponentPushToken"):
        print(f"Invalid Expo token: {token}")
        return
    
    payload = {
        "to": token,
        "sound": "default",
        "title": title,
        "body": body,
        "data": data or {"extra": "tee-time"}
    }

    async with httpx.AsyncClient(timeout = 10) as client:
        res = await client.post(EXPO_PUSH_URL, json=payload)
        res.raise_for_status()
        print("Expo push response:", res.json())
    
async def send_summary_push(token: str, course_name: str, count: int):
    """ Send a summarized 'x opening available' notification. """
    title = f"{course_name}: {count} openings!"
    body = f"We found {count} new tee time(s) matching your alert"
    await send_push_notification(token, title, body)

