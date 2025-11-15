from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from app.db import supabase
import stripe
import os
from datetime import datetime, timezone

router = APIRouter(prefix="/membership", tags=["membership"])

stripe.api_key = os.getenv("STRIPE_SANDBOX_SECRET_KEY")
WEBHOOK_SECRET = os.getenv("STRIPE_SANDBOX_WEBHOOK_SECRET")

@router.post("/upgrade")
async def create_checkout_session(request: Request):
    """
    Creates a Stripe Checkout Session for a user selecting a new membership plan.
    Expects JSON body: { "user_id": str, "tier_id": int }
    """
    try:
        payload = await request.json()
        user_id = payload.get("user_id")
        tier_id = payload.get("tier_id")

        if not user_id or not tier_id:
            raise HTTPException(status_code = 400, detail = "Missing required fields")
        
        tier = (
            supabase.table("membership_tiers")
            .select("id, name, price_id, price_cents")
            .eq("id", tier_id)
            .single()
            .execute()
        )

        if not tier.data:
            raise HTTPException(status_code = 404, detail = "Tier not found")
        
        price_id = tier.data.get("price_id")
        if not price_id:
            raise HTTPException(status_code=400, detail = "Tier missing Stripe price ID")
        
        profile = (
            supabase.table("user_profiles")
            .select("stripe_customer_id")
            .eq("id", user_id)
            .single()
            .execute()
        )

        stripe_customer_id = profile.data.get("stripe_customer_id")
        auth_user = supabase.auth.admin.get_user_by_id(user_id)

        if not stripe_customer_id:
            # Create a new customer
            customer = stripe.Customer.create(email = auth_user.user.email, metadata = {"user_id": user_id,})
            stripe_customer_id = customer.id

            supabase.table("user_profiles").update(
                {"stripe_customer_id": stripe_customer_id}
            ).eq("id", user_id).execute()

        session = stripe.checkout.Session.create(
            mode = "subscription",
            customer = stripe_customer_id,
            line_items = [{"price": price_id, "quantity": 1}],
            success_url=f"{os.getenv('APP_PUBLIC_URL', 'https://google.com')}/profile?success=true",
            cancel_url=f"{os.getenv('APP_PUBLIC_URL', 'https://stripe.com')}/upgrade?canceled=true",
            allow_promotion_codes=True,
        )

        return {"checkout_url": session.url}
    
    except Exception as e:
        print("Strip checkout creation error: ", e)
        raise HTTPException(status_code=500, detail=str(e))
    
@router.post("/webhook")
async def stripe_webhook(request: Request):
    """
    Receives a Stripe webhook events and updates user membership
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload = payload, sig_header = sig_header, secret = WEBHOOK_SECRET
        )
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code = 400, detail = "Invalid Signature")
    except Exception as e:
        print("Webhook error: ", e)
        raise HTTPException(status_code = 400, detail = "Webhook validation failed")
    
    event_type = event["type"]
    data = event["data"]["object"]

    print(f"Stripe webhook received: {event_type}")

    try:
        if event_type == "checkout.session.completed":
            session = data
            customer_id = session.get("customer")
            customer = stripe.Customer.retrieve(customer_id)
            user_id = customer.metadata.get("user_id")

            subscription_id = session.get("subscription")
            sub = stripe.Subscription.retrieve(subscription_id)
            items = sub['items']['data']
            price_id = items[0]['price']['id']

            tier = (
                supabase.table("membership_tiers")
                .select("id")
                .eq("price_id", price_id)
                .single()
                .execute()
            )

            tier_id = tier.data['id'] if tier.data else None

            if user_id and tier_id:
                supabase.table("user_profiles").update(
                    {"membership_tier_id": tier_id}
                ).eq("id", user_id).execute()

                print(f"Updated user {user_id} to {tier_id}")
        
        if event_type == "customer.subscription.deleted":
            sub = data
            customer_id = sub.get("customer")
            customer = stripe.Customer.retrieve(customer_id)
            user_id = customer.metadata.get("user_id")

            # downgrade to Free (id=1)
            if user_id:
                supabase.table("user_profiles").update(
                    {
                        "membership_tier_id": 1,
                        "pending_downgrade": False,
                        "cancel_at": None,  
                    }
                ).eq("id", user_id).execute()
                print(f"Downgraded {user_id} to Free tier")
    
    except Exception as e:
        print("Webhook processing error: ", e)
        return JSONResponse(status_code = 400, content={"error": str(e)})
    
    return JSONResponse(status_code = 200, content = {"status": "success"})

@router.post("/downgrade")
async def schedule_downgrade(request: Request):
    """
    Marks a user's Stripe subscription to cancel at period end
    Expect JSON: {"user_id": str}
    """
    try:
        data = await request.json()
        user_id = data.get("user_id")
        if not user_id:
            raise HTTPException(status_code=400, detail="Missing user_id")
        
        profile = (
            supabase.table("user_profiles")
            .select("stripe_customer_id")
            .eq("id", user_id)
            .single()
            .execute()
        )
        stripe_customer_id = profile.data.get("stripe_customer_id")
        if not stripe_customer_id:
            raise HTTPException(status_code=404, detail="Stripe customer not found")
        
        subs = stripe.Subscription.list(customer=stripe_customer_id, status="active", limit=1)
        if not subs.data:
            raise HTTPException(status_code=404, detail = "No active subscription found")
        
        subscription = subs.data[0]
        updated = stripe.Subscription.modify(
            subscription.id, cancel_at_period_end=True
        )

        cancel_date = updated["cancel_at"]

        supabase.table("user_profiles").update(
            {"pending_downgrade": True, "cancel_at": datetime.fromtimestamp(cancel_date, tz=timezone.utc).isoformat()}
        ).eq("id", user_id).execute()


        return {"status": "scheduled", "cancel_at": cancel_date}

    except Exception as e:
        print("Downgrade scheduling error: ", e)
        raise HTTPException(status_code=500, detail=str(e))
    