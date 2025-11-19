from datetime import datetime, timezone, timedelta
from app.db import supabase
from collections import defaultdict
from app.services.push_service import send_push_notification

ALERT_COOLDOWN_MINUTES = 30
_last_push_times = {}

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

async def run_alert_engine(tier_id: int | None = None):
    """ Check all alerts vs. availability and queue new notifications. """
    now = datetime.now(timezone.utc).isoformat()
    summaries = defaultdict(lambda: {"course_id": None, "count": 0, "user_id": None})

    query = supabase.table("alerts").select(
        "*, user_profiles!alerts_user_id_fkey(membership_tier_id)"
    ).eq("active", True)

    alerts = query.execute().data or []

    if tier_id is not None:
        alerts = [
            a for a in alerts
            if a.get("user_profiles", {}).get("membership_tier_id") == tier_id
        ]
        print(f"[AlertEngine] Processing tier {tier_id}: {len(alerts)} alerts")

    for alert in alerts or []:
        course_id = alert["course_id"]
        holes = alert.get("holes")
        alert_id = alert["id"]
        user_id = alert["user_id"]

        # cooldown check
        last_push_time = _last_push_times.get(alert_id)
        if last_push_time and (now - last_push_time) < timedelta(minutes=ALERT_COOLDOWN_MINUTES):
            continue
        # User selected day in UTC
        base_date = datetime.fromisoformat(alert['date_from']).astimezone(timezone.utc)
        
        start_t = datetime.fromisoformat(alert['start_time']).time()
        end_t = datetime.fromisoformat(alert['end_time']).time()

        start_dt = datetime.combine(base_date.date(), start_t, tzinfo=timezone.utc)
        end_dt = datetime.combine(base_date.date(), end_t, tzinfo=timezone.utc)

        tee_times = (
            supabase.table("availability")
            .select("id, course_id, tee_time, holes")
            .eq("course_id", course_id)
            .eq("holes", holes)
            .gte("tee_time", start_dt.isoformat())
            .lte("tee_time", end_dt.isoformat())
            .execute()
            .data
        )

        new_ids = []
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
                supabase.table("alert_notifications").insert(
                    {
                        "alert_id": alert["id"],
                        "availability_id": tee["id"],
                        "via": "push",
                        "status": "sent",
                        "sent_at": now
                    }
                ).execute()
                new_ids.append(tee["id"])
        
        if new_ids:
            summaries[alert_id]["course_id"] = course_id
            summaries[alert_id]["count"] += len(new_ids)
            summaries[alert_id]["user_id"] = user_id
            _last_push_times[alert_id] = now
    

    for alert_id, info in summaries.items():
        course_name = get_course_name(info["course_id"])
        title = f"{course_name}: {info['count']} opening(s)!"
        body = f"We found {info["count"]} new tee time(s) that match your alert"
        user_id = info["user_id"]

        token = get_user_push_token(user_id)
        if token:
            try:
                await send_push_notification(token, title, body)
                print(f"[Push] Sent summary for alert {alert_id} to user {user_id}")
            except Exception as e:
                print(f"[Push] Error sending for alert {alert_id}: {e}")
        else:
            print(f"[Push] No token found for user {user_id}")

def get_user_push_token(user_id: str) -> str | None:
    """ Fetch saved Expo push token for a user. """
    res = (
        supabase.table("user_profiles")
        .select("expo_push_token")
        .eq("id", user_id)
        .single()
        .execute()
    )

    return (res.data or {}).get("expo_push_token")

def get_course_name(course_id: int) -> str:
    """ Fetch course name for push noti """
    res = (
        supabase.table("courses")
        .select("name")
        .eq("id", course_id)
        .single()
        .execute()
    )

    return (res.data or {}).get("name", "Course")