from contextlib import asynccontextmanager
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from datetime import date
from typing import Union

from app.services.foreup_service import run_foreup_scan
from app.services.alert_service import run_alert_engine
from app.routes import alerts as alert_routes
from app.routes import membership as membership_routes
from app.routes import revenuecat
from app.routes import push
from app.routes import auth
from app.routes import courses
from app.scheduler.scheduler import start_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    await start_scheduler(app)
    yield

app = FastAPI(title = "Tee Time Notify API", version = "0.1.0", lifespan=lifespan)
app.include_router(alert_routes.router)
app.include_router(membership_routes.router)
app.include_router(revenuecat.router)
app.include_router(push.router)
app.include_router(auth.router)
app.include_router(courses.router, prefix="/courses", tags=["Courses"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # you can restrict later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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