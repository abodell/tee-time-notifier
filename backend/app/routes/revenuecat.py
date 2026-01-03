from fastapi import APIRouter, Request, HTTPException, Header
from app.db import create_supabase
import os
from datetime import datetime, timezone

router = APIRouter(prefix="/revenuecat", tags=["revenuecat"])

REVENUECAT_WEBHOOK_SECRET = os.getenv("REVENUECAT_WEBHOOK_SECRET")

@router.post("/webhook")
async def revenuecat_webhook(request: Request, authorization: str = Header(None)):
    """
    Handles webhooks from RevenueCat to sync subscription status.
    Events: INITIAL_PURCHASE, RENEWAL, EXPIRATION, CANCELLATION, UNCANCELLATION
    """
    # 1. Verify Secret
    print(f"Received Webhook. Auth Header: {authorization[:5]}***" if authorization else "No Auth Header")
    
    if not REVENUECAT_WEBHOOK_SECRET:
        print("Error: REVENUECAT_WEBHOOK_SECRET not set")
        raise HTTPException(status_code=500, detail="Server misconfiguration")

    # RevenueCat sends "Bearer <secret>" or just the secret depending on config. 
    # Usually it's a header check.
    if authorization != REVENUECAT_WEBHOOK_SECRET and authorization != f"Bearer {REVENUECAT_WEBHOOK_SECRET}":
        print(f"Auth failed. Expected: {REVENUECAT_WEBHOOK_SECRET[:5]}***, Got: {authorization}")
        raise HTTPException(status_code=401, detail="Invalid Authorization")

    payload = await request.json()
    print(f"Webhook Payload: {payload}")

    event = payload.get("event", {})
    event_type = event.get("type")
    app_user_id = event.get("app_user_id") # This should be our Supabase User ID
    entitlement_ids = event.get("entitlement_ids", [])
    product_id = event.get("product_id")
    
    print(f"RevenueCat Webhook: {event_type} for {app_user_id}")

    if not app_user_id:
        return {"status": "ignored", "reason": "no_user_id"}

    supabase = await create_supabase()

    try:
        if event_type in ["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"]:
            # User has an active subscription. Find the tier matching the entitlement OR product.
            target_id = None
            
            if entitlement_ids:
                target_id = entitlement_ids[0]
            elif product_id:
                print(f"No entitlements found, falling back to product_id: {product_id}")
                target_id = product_id
            
            if not target_id:
                print("No entitlement or product ID found in event")
                return {"status": "ignored", "reason": "no_id_found"}
            
            # Find tier by entitlement_id (which we are using to store product_ids too)
            tier_response = await (
                supabase.table("membership_tiers")
                .select("id")
                .eq("revenuecat_entitlement_id", target_id)
                .single()
                .execute()
            )

            if tier_response.data:
                new_tier_id = tier_response.data["id"]
                
                # Update user profile
                await supabase.table("user_profiles").update({
                    "membership_tier_id": new_tier_id,
                    "pending_downgrade": False, # Reset downgrade flag on renewal/purchase
                    "cancel_at": None
                }).eq("id", app_user_id).execute()
                
                print(f"Updated user {app_user_id} to tier {new_tier_id} ({target_id})")
            else:
                print(f"No tier found for entitlement/product: {target_id}")

        elif event_type in ["EXPIRATION"]:
            # Subscription expired. Downgrade to Free (Tier 1).
            # We should verify they don't have OTHER active entitlements, but for MVP we assume 1 sub.
            await supabase.table("user_profiles").update({
                "membership_tier_id": 1, # Free
                "pending_downgrade": False,
                "cancel_at": None
            }).eq("id", app_user_id).execute()
            
            print(f"Downgraded user {app_user_id} to Free (Expiration)")

        elif event_type in ["CANCELLATION"]:
            # Auto-renew turned off. 
            # We don't downgrade yet, but we mark it.
            # RevenueCat sends 'expiration_at_ms' in the event usually.
            expiration_at_ms = event.get("expiration_at_ms")
            cancel_at = None
            if expiration_at_ms:
                cancel_at = datetime.fromtimestamp(expiration_at_ms / 1000, tz=timezone.utc).isoformat()

            await supabase.table("user_profiles").update({
                "pending_downgrade": True,
                "cancel_at": cancel_at
            }).eq("id", app_user_id).execute()
            
            print(f"Marked user {app_user_id} for cancellation at {cancel_at}")

        return {"status": "success"}

    except Exception as e:
        print(f"Error processing RevenueCat webhook: {e}")
        raise HTTPException(status_code=500, detail=str(e))
