from datetime import datetime, timezone, timedelta
from app.db import supabase

def within_time_window(tee_time_str: str, start_str: str, end_str: str):
    """ Return True if tee_time.time() within user window. """
    tee_dt = datetime.fromisoformat(tee_time_str)
    start_t = datetime.fromisoformat(start_str).time()
    end_t = datetime.fromisoformat(end_str).time()

    return start_t <= tee_dt.time() <= end_t

def notify_user(user_id, course_id, tee_time, method="push"):
    """ Placeholder for notifications. """
    print(
        f"ALERT: Notify user {user_id} for course {course_id} "
        f"tee time {tee_time} via {method}"
    )

def run_alert_engine():
    """ Check all alerts vs. availability and queue new notifications. """
    now = datetime.now(timezone.utc).isoformat()
    alerts = supabase.table("alerts").select("*").eq("active", True).execute().data

    for alert in alerts or []:
        course_id = alert["course_id"]
        holes = alert.get("holes")
        date_from = datetime.fromisoformat(alert["date_from"])
        date_to = datetime.fromisoformat(alert["date_to"]) + timedelta(days = 1)

        tee_times = (
            supabase.table("availability")
            .select("id, course_id, tee_time, holes")
            .eq("course_id", course_id)
            .eq("holes", holes)
            .gte("tee_time", date_from.isoformat())
            .lte("tee_time", date_to.isoformat())
            .execute()
            .data
        )

        for tee in tee_times or []:
            tee_time_str = tee["tee_time"]
            if not within_time_window(
                tee_time_str, alert["start_time"], alert["end_time"]
            ):
                continue

            existing = (
                supabase.table("alert_notifications")
                .select("id")
                .eq("alert_id", alert["id"])
                .eq("availability_id", tee["id"])
                .execute()
                .data
            )

            if not existing:
                notify_user(alert["user_id"], course_id, tee_time_str)

                supabase.table("alert_notifications").insert(
                    {
                        "alert_id": alert["id"],
                        "availability_id": tee["id"],
                        "via": "push",
                        "status": "sent",
                        "sent_at": now
                    }
                ).execute()