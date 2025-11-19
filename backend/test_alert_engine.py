from datetime import datetime, timezone
from app.services.foreup_service import run_foreup_scan
from app.services.alert_service import run_alert_engine
import asyncio

if __name__ == "__main__":
    date_str = "11-20-2025"
    run_foreup_scan(date_str)
    asyncio.run(run_alert_engine(tier_id=1))