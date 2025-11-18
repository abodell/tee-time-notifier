from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI

from app.scheduler.jobs import (
    scan_foreup_job,
    run_alert_engine_for_tier
)
from app.db import supabase
from app.config import settings

def start_scheduler(app: FastAPI):
    """
    Starts the APScheduler if ENABLE_SCHEDULER=true in environment.
    Should be called inside FastAPI startup event
    """
    if not settings.ENABLE_SCHEDULER:
        print("[Scheduler] Disabled (ENABLE_SCHEDULER != true)")
        return
    
    print("[Scheduler] ENABLED - starting AsyncIOScheduler")

    scheduler = AsyncIOScheduler()

    tiers = supabase.table("membership_tiers").select("*").execute().data or []

    scheduler.add_job(
        scan_foreup_job,
        trigger=IntervalTrigger(seconds=settings.SCAN_INTERVAL_SECONDS),
        name="ForeUp_GLOBAL_scan",
    )

    for tier in tiers:
        tier_id = tier["id"]
        interval = tier["scan_interval_seconds"]

        scheduler.add_job(
            run_alert_engine_for_tier,
            trigger=IntervalTrigger(seconds=interval),
            args=[tier_id],
            name=f"AlertEngine_Tier_{tier_id}"
        )

        print(
            f"[Scheduler] Registered alert job for tier {tier['name']} "
            f"every {interval} seconds"
        )
    
    scheduler.start()
    print("[Scheduler] All jobs scheduled successfully.")