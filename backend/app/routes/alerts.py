from fastapi import APIRouter, HTTPException
from typing import List
from app.db import supabase

router = APIRouter(prefix="/alerts", tags=["alerts"])

@router.post("/create")
def create_alert(alert: dict):
    """ Create a new alert (expects JSON body). """
    try:
        result = supabase.table("alerts").insert(alert).execute()
        return {"status": "success", "alert": result.data[0]}
    except Exception as e:
        print(e)
        raise HTTPException(status_code = 400, detail = str(e))

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