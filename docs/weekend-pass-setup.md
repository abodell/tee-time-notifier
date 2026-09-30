# Weekend Pass — App Store Connect & RevenueCat Setup

Manual, one-time setup required before `feature/weekend-pass` can go live. Nothing
here can be automated from the repo — both are dashboard-side configuration on
Apple's and RevenueCat's platforms.

## 1. App Store Connect

**Features → In-App Purchases → New**

| Field | Value |
|---|---|
| Type | **Non-Renewing Subscription** |
| Reference name | `Weekend Pass (7-Day Pro Access)` |
| Product ID | `teesignal_weekend_pass` — must match `WEEKEND_PASS_PRODUCT_ID` in `backend/app/config.py` exactly |
| Price | Your call — the growth memo suggested ~$5.99–$6.99 |
| Duration | Non-renewing subscriptions don't have a built-in expiry — say "7 days" in the description, since the backend enforces the actual expiry (`grant_temporary_tier(..., days=7)` in the RevenueCat webhook handler) |
| Description | e.g. "Full Pro access — 10 alerts, fastest scans, recurring alerts — for 7 days. One-time purchase, no auto-renewal." |

Submit for review along with your next app version (in-app purchases can be
submitted independently of a build, but Apple still reviews them before
they go live).

## 2. RevenueCat dashboard

**Products → add `teesignal_weekend_pass`**

- Import/select the same product ID from App Store Connect.
- No entitlement or Offering/Package attachment is required — this is a
  one-off grant, not a subscription tier. The backend webhook handler
  matches on `product_id` directly (see `app/routes/revenuecat.py`,
  the `NON_RENEWING_PURCHASE` branch), not on an entitlement.
- Confirm your existing webhook endpoint (already receiving
  `INITIAL_PURCHASE`/`RENEWAL`/`EXPIRATION`/`CANCELLATION` for Plus/Pro) is
  also subscribed to **`NON_RENEWING_PURCHASE`** events — RevenueCat webhooks
  default to "all event types," but it's worth checking under
  **Project Settings → Webhooks**.

## 3. Frontend env var

`frontend/tee-time-notify` needs `EXPO_PUBLIC_WEEKEND_PASS_PRODUCT_ID` set if
you ever change the product ID away from the default
(`teesignal_weekend_pass`) baked into `app/upgrade.tsx`. No action needed if
you use the default.

## 4. Testing before the App Store review lands

The backend side (webhook → `grant_temporary_tier` → bonus columns) can be
verified today, independent of the App Store Connect / RevenueCat setup
above, by POSTing a synthetic webhook payload with your own
`REVENUECAT_WEBHOOK_SECRET`:

```bash
curl -X POST "$API_URL/revenuecat/webhook" \
  -H "Authorization: $REVENUECAT_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "type": "NON_RENEWING_PURCHASE",
      "app_user_id": "<a real user_id from user_profiles>",
      "product_id": "teesignal_weekend_pass"
    }
  }'
```

Then `GET /membership/profile/<user_id>` and confirm `is_bonus_active: true`,
`bonus_expires_at` ~7 days out, and `membership_tiers.name == "Pro"` even
though the user's real tier is untouched.

Once the App Store Connect IAP and RevenueCat product are both live, the
end-to-end purchase flow (`upgrade.tsx` → `Purchases.purchaseStoreProduct` →
RevenueCat → webhook) can be tested in the App Store sandbox the same way
existing Plus/Pro purchases are.
