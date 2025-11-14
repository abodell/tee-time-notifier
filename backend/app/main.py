from fastapi import FastAPI, Query
from datetime import date
from typing import Union

from app.services.foreup_service import run_foreup_scan
from app.services.alert_service import run_alert_engine
from app.routes import alerts as alert_routes

app = FastAPI(title = "Tee Time Notify API", version = "0.1.0")
app.include_router(alert_routes.router)

@app.get("/")
def root():
    return {"message": "Tee Time Notify API is live"}

@app.post("/availability/scan")
def availability_scan(target_date: str = Query(None), holes: Union[str, int] = Query("all", description="'all', 9, or 18")):
    """ Trigger a ForeUp scan for a given date (default: today) """
    if not target_date:
        target_date = date.today().strftime("%m-%d-%Y")
    try:
        run_foreup_scan(target_date, holes)
        print("Running alert engine...")
        run_alert_engine()
        return {
            "status": "success",
            "message": f"Scan + alert check complete for {target_date}"
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}