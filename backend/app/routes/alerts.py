from fastapi import APIRouter, HTTPException
from typing import List
from app.db import supabase

router = APIRouter(prefix="/alerts", tags=["alerts"])

@router.post("/create")
def create_alert(alert: dict):
    """ Create a new alert (enforcing membership tier restrictions) """
    try:
        user_id = alert.get("user_id")
        if not user_id:
            raise HTTPException(status_code = 400, detail = "Missing user_id")
        
        # Fetch the profile
        profile = (
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
        tier = (
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
        current_alerts = (
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
        result = supabase.table("alerts").insert(alert).execute()
        return {"status": "success", "alert": result.data[0]}
    
    except HTTPException:
        raise
    except Exception as e:
        print("Alert creation error: ", e)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/user/{user_id}")
def get_user_alerts(user_id: str):
    """ Return all active alerts for a user. """
    alerts = (
        supabase.table("alerts")
        .select("*, courses!alerts_course_id_fkey(name, city, state)")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return alerts.data or []

@router.delete("/{alert_id}")
def delete_alert(alert_id: int):
    """ Delete an alert. """
    supabase.table("alerts").delete().eq("id", alert_id).execute()
    return {"status": "deleted", "alert_id": alert_id}