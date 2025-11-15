from fastapi import APIRouter, HTTPException, Request
from app.db import supabase
from app.services.push_service import send_push_notification

router = APIRouter(prefix = "/push", tags=["push"])

@router.post("/register")
async def register_push_token(request: Request):
    """
    Saves Expo Push Token to user_profiles (called on app start).
    Body: { "user_id": str, "token": str }
    """
    data = await request.json()
    user_id = data.get("user_id")
    token = data.get("token")

    if not user_id or not token:
        raise HTTPException(status_code=400, detail="Missing fields")
    
    supabase.table("user_profiles").update(
        {"expo_push_token": token}
    ).eq("id", user_id).execute()

    return {"status": "registered"}

@router.post("/test")
async def send_test_push(request: Request):
    """
    Developer tool to trigger a manual push
    """
    data = await request.json()
    user_id = data.get("user_id")
    title = data.get("title", "Tee Time Alert!")
    body = data.get("body", "This is a push test.")

    profile = (
        supabase.table("user_profiles")
        .select("expo_push_token")
        .eq("id", user_id)
        .single()
        .execute()
    )

    token = profile.data.get("expo_push_token")
    if not token:
        raise HTTPException(status_code=404, detail="Push token not found")

    await send_push_notification(token, title, body)
    return {"status": "sent"}