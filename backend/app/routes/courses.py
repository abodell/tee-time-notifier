from fastapi import APIRouter, HTTPException, Depends, Header, Query
from pydantic import BaseModel
from typing import Optional
from app.db import create_supabase
from app.services.places_service import search_golf_courses

router = APIRouter()

class CourseRequest(BaseModel):
    name: str
    address: str
    city: str
    state: str
    place_id: str


@router.get("/search")
async def search_courses(
    query: str = Query(..., min_length=2, description="Search query for golf courses"),
    authorization: Optional[str] = Header(None)
):
    """
    Search for golf courses using Google Places Text Search API.
    Results are cached for cost efficiency.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization Header")

    token = authorization.replace("Bearer ", "")
    supabase = await create_supabase()

    # Verify user
    user = await supabase.auth.get_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid Token")

    try:
        results = await search_golf_courses(query)
        return {"results": results}
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        print(f"Error searching courses: {e}")
        raise HTTPException(status_code=500, detail="Failed to search courses")

@router.post("/request")
async def request_course(
    request: CourseRequest,
    authorization: Optional[str] = Header(None)
):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization Header")

    token = authorization.replace("Bearer ", "")
    supabase = await create_supabase()

    # Verify user
    user = await supabase.auth.get_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid Token")
    
    user_id = user.user.id

    try:
        # Check if this course has been requested before (by place_id)
        existing = await supabase.table("course_requests") \
            .select("id") \
            .eq("google_place_id", request.place_id) \
            .execute()
        
        was_previously_requested = len(existing.data) > 0
        previous_request_count = len(existing.data)

        # Insert the new request (allow duplicates for demand tracking)
        data = {
            "user_id": user_id,
            "course_name": request.name,
            "address": request.address,
            "city": request.city,
            "state": request.state,
            "google_place_id": request.place_id,
            "status": "pending"
        }
        
        res = await supabase.table("course_requests").insert(data).execute()
        
        return {
            "status": "success",
            "data": res.data,
            "was_previously_requested": was_previously_requested,
            "request_count": previous_request_count + 1  # Including this new request
        }
    except Exception as e:
        print(f"Error requesting course: {e}")
        raise HTTPException(status_code=500, detail=str(e))
