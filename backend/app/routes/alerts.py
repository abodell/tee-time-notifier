from fastapi import APIRouter, HTTPException
from typing import List
from app.db import create_supabase

router = APIRouter(prefix="/alerts", tags=["alerts"])

@router.post("/create")
async def create_alert(alert: dict):
    """ Create a new alert (enforcing membership tier restrictions) """
    try:
        supabase = await create_supabase()
        user_id = alert.get("user_id")
        if not user_id:
            raise HTTPException(status_code = 400, detail = "Missing user_id")
        
        # Fetch the profile
        profile = await (
            supabase.table("user_profiles")
            .select("id, membership_tier_id")
            .eq("id", user_id)
            .single()
            .execute()
        )

        if not profile.data:
            raise HTTPException(status_code=404, detail="User profile not found.")
        
        tier_id = profile.data.get("membership_tier_id")
        if not tier_id:
            raise HTTPException(status_code=400, detail="Membership tier not found.")
        
        # Fetch tier info
        tier = await (
            supabase.table("membership_tiers")
            .select("id, name, max_alerts")
            .eq("id", tier_id)
            .single()
            .execute()
        )

        if not tier.data:
            raise HTTPException(status_code=404, detail="Tier not found.")
        
        max_alerts = tier.data.get("max_alerts")
        tier_name = tier.data.get("name")

        # get the current existing alerts for this user
        current_alerts = await (
            supabase.table("alerts")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        )
        alert_count = current_alerts.count if hasattr(current_alerts, "count") else len(current_alerts.data or [])

        if max_alerts is not None and alert_count >= max_alerts:
            raise HTTPException(
                status_code=403,
                detail=f"Your {tier_name} plan allows up to {max_alerts} active alert(s). Please upgrade your plan to add more"
            )
            
        # Optional: ensure is_recurring is only accepted for PRO tier members
        # In this implementation, the frontend will gate it, but we can also sanitize it.
        is_recurring = alert.get("is_recurring", False)
        
        # Build strict payload
        insert_payload = {
            "user_id": user_id,
            "course_id": alert.get("course_id"),
            "holes": alert.get("holes"),
            "date_from": alert.get("date_from"),
            "date_to": alert.get("date_to"),
            "start_time": alert.get("start_time"),
            "end_time": alert.get("end_time"),
            "is_recurring": is_recurring
        }
            
        result = await supabase.table("alerts").insert(insert_payload).execute()
        return {"status": "success", "alert": result.data[0]}
    
    except HTTPException:
        raise
    except Exception as e:
        print("Alert creation error: ", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/user/{user_id}")
async def get_user_alerts(user_id: str):
    """ Return all active alerts for a user. """
    supabase = await create_supabase()
    alerts = await(
        supabase.table("alerts")
        .select(
            "*, "
            "courses!alerts_course_id_fkey(name, city, state, provider_url, time_zone), "
            "alert_notifications(id, sent_at, availability(tee_time, price))"
        )
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return alerts.data or []

@router.delete("/{alert_id}")
async def delete_alert(alert_id: int):
    """ Delete an alert. """
    supabase = await create_supabase()
    await supabase.table("alerts").delete().eq("id", alert_id).execute()
    return {"status": "deleted", "alert_id": alert_id}