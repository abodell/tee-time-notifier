import httpx
import os

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

async def send_push_notification(token: str, title: str, body: str):
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
        "data": {"extra": "tee-time"}
    }

    async with httpx.AsyncClient(timeout = 10) as client:
        res = await client.post(EXPO_PUSH_URL, json=payload)
        res.raise_for_status()
        print("Expo push response:", res.json())
    