import asyncio
from datetime import datetime, timezone, timedelta
from app.db import create_supabase
from collections import defaultdict
from app.services.push_service import send_push_notification

ALERT_COOLDOWN_MINUTES = 30


def notify_user(user_id, course_id, tee_time, method="push"):
    """ Placeholder for notifications. """
    print(
        f"ALERT: Notify user {user_id} for course {course_id} "
        f"tee time {tee_time} via {method}"
    )

import zoneinfo

async def rollover_recurring_alerts(supabase, now: datetime):
    """
    Find active recurring alerts that have expired, and roll them forward 7 days.
    """
    try:
        res = await (
            supabase.table("alerts")
            .select("id, date_from, date_to, start_time, end_time, courses!alerts_course_id_fkey(time_zone)")
            .eq("active", True)
            .eq("is_recurring", True)
            .lt("end_time", now.isoformat())
            .execute()
        )
        
        expired_alerts = res.data or []
        for alert in expired_alerts:
            tz_str = alert.get("courses", {}).get("time_zone", "UTC")
            tz = zoneinfo.ZoneInfo(tz_str)
            
            def add_7_days_local(iso_str):
                # Clean off 'Z' replacing it with +00:00 to use standard fromisoformat if needed,
                # but standard tee-time backend saves it as normal isoformat.
                # Just parse it and attach UTC:
                dt_utc = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
                if dt_utc.tzinfo is None:
                    dt_utc = dt_utc.replace(tzinfo=timezone.utc)
                # Convert to local timezone, add 7 days (preserves local wall time), convert back to UTC
                dt_local = dt_utc.astimezone(tz)
                dt_next_week = dt_local + timedelta(days=7)
                return dt_next_week.astimezone(timezone.utc).isoformat()
                
            def add_168_hours_utc(iso_str):
                dt_utc = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
                if dt_utc.tzinfo is None:
                    dt_utc = dt_utc.replace(tzinfo=timezone.utc)
                dt_next_utc = dt_utc + timedelta(days=7)
                return dt_next_utc.isoformat()

            new_date_from = add_168_hours_utc(alert["date_from"])
            new_date_to = add_168_hours_utc(alert["date_to"])
            new_start = add_7_days_local(alert["start_time"])
            new_end = add_7_days_local(alert["end_time"])
            
            await (
                supabase.table("alerts")
                .update({
                    "date_from": new_date_from,
                    "date_to": new_date_to,
                    "start_time": new_start,
                    "end_time": new_end
                })
                .eq("id", alert["id"])
                .execute()
            )
            print(f"[AlertRollover] Rolled over recurring alert {alert['id']} to next week.")
    except Exception as e:
        print(f"[AlertRollover] Error during recurring alert rollover: {e}")

def _matches_alert(row, start_dt, end_dt, players):
    """ In-memory filter so multiple alerts can share one fetched row set. """
    tee_dt = datetime.fromisoformat(row["tee_time"])
    if tee_dt.tzinfo is None:
        tee_dt = tee_dt.replace(tzinfo=timezone.utc)
    if tee_dt < start_dt or tee_dt > end_dt:
        return False
    if players is not None:
        # Pass through slots where spots_available is unknown (NULL) so providers
        # without player count data don't silently block notifications.
        spots = row.get("spots_available")
        if spots is not None and spots < players:
            return False
    return True


async def _fetch_availability_for_group(supabase, course_id, holes, min_start, max_end):
    """ One availability fetch shared by every alert on the same (course_id, holes). """
    res = await (
        supabase.table("availability")
        .select("id, course_id, tee_time, holes, spots_available")
        .eq("course_id", course_id)
        .eq("holes", holes)
        .eq("available", True)
        .gte("tee_time", min_start.isoformat())
        .lte("tee_time", max_end.isoformat())
        .execute()
    )
    return (course_id, holes), res.data or []


async def process_single_alert(supabase, alert, now, summaries, rows=None):
    """
    Check one alert against already-fetched availability rows (or fetch them
    itself if `rows` isn't supplied) and queue any new notifications.

    `rows` lets run_alert_engine share a single availability fetch across every
    alert on the same (course_id, holes) instead of querying per alert.
    """
    course_id = alert["course_id"]
    holes = alert.get("holes")
    players = alert.get("players")  # None = Any
    alert_id = alert["id"]
    user_id = alert["user_id"]

    # User selected day in UTC
    start_dt = datetime.fromisoformat(alert['start_time']).astimezone(timezone.utc)
    end_dt = datetime.fromisoformat(alert['end_time']).astimezone(timezone.utc)

    if rows is None:
        _, rows = await _fetch_availability_for_group(supabase, course_id, holes, start_dt, end_dt)

    tee_times = [r for r in rows if _matches_alert(r, start_dt, end_dt, players)]
    if not tee_times:
        return

    # One query to fetch every existing notification for this alert's candidate
    # tee times, instead of one query per tee time.
    availability_ids = [t["id"] for t in tee_times]
    existing_res = await (
        supabase.table("alert_notifications")
        .select("availability_id, spots_available, sent_at")
        .eq("alert_id", alert_id)
        .in_("availability_id", availability_ids)
        .order("sent_at", desc=True)
        .execute()
    )
    latest_by_availability_id = {}
    for row in existing_res.data or []:
        aid = row["availability_id"]
        if aid not in latest_by_availability_id:  # first hit is latest (desc order)
            latest_by_availability_id[aid] = row.get("spots_available")

    inserts = []
    new_ids = []
    for tee in tee_times:
        current_spots = tee.get("spots_available")

        if tee["id"] in latest_by_availability_id:
            last_spots = latest_by_availability_id[tee["id"]]
            # Only re-notify if both values are known and spots increased
            # (e.g. a cancellation freed up more spots than before).
            if not (current_spots is not None and last_spots is not None and current_spots > last_spots):
                continue

        inserts.append({
            "alert_id": alert_id,
            "availability_id": tee["id"],
            "spots_available": current_spots,
            "via": "push",
            "status": "sent",
            "sent_at": now.isoformat()
        })
        new_ids.append(tee["id"])

    if inserts:
        # One bulk insert instead of one insert per tee time.
        await supabase.table("alert_notifications").insert(inserts).execute()

    if new_ids:
        summaries[alert_id] = {
            "course_id": course_id,
            "count": len(new_ids),
            "user_id": user_id
        }

async def run_alert_engine(tier_id: int | None = None):
    """ Check all alerts vs. availability and queue new notifications. """
    start_time = datetime.now(timezone.utc)
    supabase = await create_supabase()
    summaries = {} # alert_id -> info

    print(f"[AlertEngine] Starting scan for tier={tier_id} at {start_time.isoformat()}...")

    # Step 0: Roll over expired recurring alerts before selecting what's active
    await rollover_recurring_alerts(supabase, start_time)

    cutoff = (start_time - timedelta(days=1)).isoformat()
    query = supabase.table("alerts").select(
        "id, user_id, course_id, holes, players, start_time, end_time, date_from, date_to, "
        "user_profiles!alerts_user_id_fkey(membership_tier_id)"
    ).eq("active", True).gte("date_to", cutoff)

    query_execute = await query.execute()
    alerts = query_execute.data or []

    if tier_id is not None:
        alerts = [
            a for a in alerts
            if a.get("user_profiles", {}).get("membership_tier_id") == tier_id
        ]
        print(f"[AlertEngine] Processing tier {tier_id}: {len(alerts)} alerts")

    if not alerts:
        return

    # Group alerts sharing a (course_id, holes) pair so they share a single
    # availability fetch instead of one query per alert.
    windows = {}  # alert_id -> (start_dt, end_dt)
    groups = defaultdict(list)  # (course_id, holes) -> [alert_id, ...]
    for alert in alerts:
        start_dt = datetime.fromisoformat(alert["start_time"]).astimezone(timezone.utc)
        end_dt = datetime.fromisoformat(alert["end_time"]).astimezone(timezone.utc)
        windows[alert["id"]] = (start_dt, end_dt)
        groups[(alert["course_id"], alert.get("holes"))].append(alert["id"])

    by_id = {a["id"]: a for a in alerts}
    fetches = [
        _fetch_availability_for_group(
            supabase,
            course_id,
            holes,
            min(windows[aid][0] for aid in alert_ids),
            max(windows[aid][1] for aid in alert_ids),
        )
        for (course_id, holes), alert_ids in groups.items()
    ]
    group_rows = dict(await asyncio.gather(*fetches))

    # Parallelize alert checks, each reusing its group's already-fetched rows.
    tasks = [
        process_single_alert(
            supabase,
            by_id[aid],
            start_time,
            summaries,
            rows=group_rows[(by_id[aid]["course_id"], by_id[aid].get("holes"))],
        )
        for aid in by_id
    ]
    await asyncio.gather(*tasks)

    # Parallelize notification sending
    notif_tasks = []
    for alert_id, info in summaries.items():
        notif_tasks.append(send_summary_notification(alert_id, info, start_time))

    await asyncio.gather(*notif_tasks)

async def send_summary_notification(alert_id, info, engine_start_time):
    """ Helper to fetch data and send push """
    course_name = await get_course_name(info["course_id"])
    user_id = info["user_id"]
    title = f"{course_name}: {info['count']} opening(s)!"
    body = f"We found {info['count']} new tee time(s) matching your alert."

    token = await get_user_push_token(user_id)
    if token:
        try:
            # We must pass the alert_id explicitly in the 'data' structure
            extra_data = {"alertId": str(alert_id)}
            await send_push_notification(token, title, body, data=extra_data)
            now = datetime.now(timezone.utc)
            latency = (now - engine_start_time).total_seconds()
            print(f"[AlertEngine] Latency: {latency:.2f}s | Notified alert {alert_id} for user {user_id}")
        except Exception as e:
            print(f"[AlertEngine] Error sending for alert {alert_id}: {e}")
    else:
        print(f"[AlertEngine] No token for user {user_id}")

async def get_user_push_token(user_id: str) -> str | None:
    """ Fetch saved Expo push token for a user. """
    supabase = await create_supabase()
    res = await (
        supabase.table("user_profiles")
        .select("expo_push_token")
        .eq("id", user_id)
        .single()
        .execute()
    )

    return (res.data or {}).get("expo_push_token")

async def get_course_name(course_id: int) -> str:
    """ Fetch course name for push noti """
    supabase = await create_supabase()
    res = await (
        supabase.table("courses")
        .select("name")
        .eq("id", course_id)
        .single()
        .execute()
    )

    return (res.data or {}).get("name", "Course")