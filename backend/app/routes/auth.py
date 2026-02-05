from fastapi import APIRouter, HTTPException, Header
from app.db import create_supabase
import os

router = APIRouter(prefix="/auth", tags=["auth"])

@router.delete("/delete")
async def delete_account(authorization: str = Header(None)):
    """
    Permanently delete the authenticated user's account.
    Requires 'Authorization: Bearer <access_token>' header.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    
    token = authorization.replace("Bearer ", "")
    
    # 1. Verify the token using Supabase GoTrue client (client-side context)
    #    We create a client just to verify the specific user token
    supabase = await create_supabase()
    
    try:
        # Get the user object from the token
        user_response = await supabase.auth.get_user(token)
        user = user_response.user
        
        if not user or not user.id:
            raise HTTPException(status_code=401, detail="Invalid token")
            
        user_id = user.id
        print(f"Requesting deletion for user: {user_id}")

        # 2. Delete the user using Admin privileges (service_role key in db.py)
        #    The 'supabase' client from create_supabase() already has the service_role key
        
        # Check if user exists in public.user_profiles and delete manually if needed
        # (Assuming cascade delete might be handled by DB, but safe to try)
        try:
             await supabase.table("user_profiles").delete().eq("id", user_id).execute()
        except Exception as e:
            print(f"Warning: Failed to delete profile (might be cascaded): {e}")

        # Delete from auth.users
        delete_response = await supabase.auth.admin.delete_user(user_id)
        
        return {"status": "success", "message": "Account deleted"}
        
    except Exception as e:
        print(f"Delete Account Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete account")
