from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI
from .jobs import (
    scan_foreup_job,
    scan_chronogolf_job,
    run_alert_engine_for_tier
)
from app.db import create_supabase
from app.config import settings

async def start_scheduler(app: FastAPI):
    """
    Starts the APScheduler if ENABLE_SCHEDULER=true in environment.
    Should be called inside FastAPI startup event
    """
    if not settings.ENABLE_SCHEDULER:
        print("[Scheduler] Disabled (ENABLE_SCHEDULER != true)")
        return
    
    supabase = await create_supabase()
    
    print("[Scheduler] ENABLED - starting AsyncIOScheduler")

    scheduler = AsyncIOScheduler()

    query = await supabase.table("membership_tiers").select("*").execute() or []
    tiers = query.data

    from datetime import datetime, timedelta

    # Align to the next clean minute boundary
    next_minute = (datetime.now() + timedelta(minutes=1)).replace(second=0, microsecond=0)
    print(f"[Scheduler] Aligning all jobs to start at: {next_minute.isoformat()}")

    scheduler.add_job(
        scan_foreup_job,
        trigger=IntervalTrigger(seconds=45, start_date=next_minute),
        name="ForeUp_GLOBAL_scan",
    )

    scheduler.add_job(
        scan_chronogolf_job,
        trigger=IntervalTrigger(seconds=45, start_date=next_minute),
        name="ChronoGolf_GLOBAL_scan",
    )

    for tier in tiers:
        tier_id = tier["id"]
        interval = tier["scan_interval_seconds"]

        scheduler.add_job(
            run_alert_engine_for_tier,
            trigger=IntervalTrigger(seconds=interval, start_date=next_minute),
            args=[tier_id],
            misfire_grace_time=10,
            name=f"AlertEngine_Tier_{tier_id}"
        )

        print(
            f"[Scheduler] Registered alert job for tier {tier['name']} "
            f"every {interval} seconds (aligned to clock)"
        )
    
    scheduler.start()
    print("[Scheduler] All jobs scheduled successfully.")