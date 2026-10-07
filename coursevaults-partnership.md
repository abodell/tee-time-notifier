# CourseVaults x Tee Signal — Partnership & Monetization Options

## Context

CourseVaults is a golf course logging and discovery app ("Yelp for golf") with 78,000+ logged playing experiences, available internationally on iOS. Their founder proposed integrating Tee Signal's tee time alert feature into CourseVaults and crediting it with "Powered by TeeSignal" branding as a marketing play.

**The problem with the branding-only deal:** A user who discovers the alert feature inside CourseVaults has zero reason to leave that app and download a separate one. The branding creates impressions, not conversions. It's essentially free infrastructure work for them and near-zero upside for you.

---

## Option 1: Flat Monthly API License (Recommended Starting Point)

**How it works:** You expose Tee Signal's alert engine as an API. CourseVaults integrates against your API instead of running their own infrastructure. You charge a flat monthly fee for access.

**Why this is the right frame:** What you're actually selling isn't "code" — it's the infrastructure: the course polling engine, the alert matching logic, the notification delivery pipeline. That takes real ongoing cost to run. If they copy the code, they still have to run all of that themselves. An API means you run it, they don't have to.

**Pricing ballpark:**
- $150–$300/month for up to 500 active alerts
- $400–$700/month for up to 2,000 active alerts
- Custom above that

**Pros:**
- Predictable revenue for you, predictable cost for them
- Easiest to negotiate and invoice
- Forces them to commit before getting free access

**Cons:**
- You're taking on SLA responsibility
- Doesn't scale directly with their user growth

---

## Option 2: Usage-Based API (Scales With Their Growth)

**How it works:** Charge per alert created, or per notification delivered.

**Pricing ballpark:**
- $0.25–$0.50 per alert created
- OR $0.10–$0.15 per push notification successfully sent

**Why per-notification is better than per-alert:** Per-alert could be abused (create one alert, get notified 50 times). Per-notification aligns your cost with your actual compute/delivery cost and their value received.

**Pros:**
- Revenue scales automatically as their user base grows
- Low barrier to entry for them — they only pay for what they use
- Fair to both sides

**Cons:**
- Unpredictable revenue month to month
- Requires usage tracking and invoicing infrastructure
- Could create friction if their costs spike unexpectedly

---

## Option 3: Hybrid — Small Flat Base + Usage Overage

**How it works:** Monthly minimum covers a reasonable baseline, anything above that is billed at per-unit rates.

**Example structure:**
- $99/month base fee → includes 300 alerts/month
- $0.30/alert above that

**Pros:**
- You get a revenue floor even in slow months
- They have cost predictability up to a point
- Straightforward to pitch and understand

**Cons:**
- Slightly more complex to administer than flat rate

---

## Option 4: Revenue Share on Their Pro+ Tier

**How it works:** CourseVaults gates the alert feature behind their Pro+ membership. You take a cut of the incremental Pro+ revenue generated.

**Estimated structure:**
- If Pro+ is ~$X/year and they attribute the alert feature as a key driver, negotiate 15–25% of Pro+ revenue tied to that feature cohort
- Alternatively: $Y per paid user per month who has alerts enabled

**Pros:**
- Aligns incentives — both of you want alerts to be valuable and sticky
- Potentially largest upside if their user base is large
- No upfront cost for them, which makes the deal easier to close

**Cons:**
- Hard to audit and verify without access to their billing data
- You're betting on their monetization execution, not just your own product
- Complex to negotiate and structure legally

---

## What to Insist On Regardless of Which Structure You Choose

**1. Non-exclusive by default.** Unless they're paying a significant premium for exclusivity, you should retain the right to sell the same API to other golf apps. Don't let a "Powered by TeeSignal" deal lock you out of other integrations.

**2. "Powered by TeeSignal" should be a requirement, not a concession.** It can be small and tasteful, but it's table stakes for you providing this service. If they want to white-label it fully (no branding), that should cost more.

**3. Minimum commitment term.** Push for a 6-month minimum, ideally 12. You don't want to build an integration, help them ship the feature, and have them cancel after month 2.

**4. Data ownership stays with you.** The alert data, course availability data, and any patterns you observe across all users belong to Tee Signal. This is potentially valuable at scale.

**5. "Powered by TeeSignal" attribution on the feature, not buried in a footer.** If it's going to do anything for awareness, it needs to be visible at the moment the user interacts with alerts.

---

## How to Approach the Negotiation

Their opening offer (free licensing, just branding) is a low anchor. Don't accept it as the frame for negotiation — it will make anything you propose feel expensive by comparison. Instead, reframe the conversation:

> "I love the idea of integrating, and I want to make this easy to say yes to. The way I'd want to do it is as an API integration — you connect to our backend and I handle all the infrastructure on my end. That way you don't have to maintain any of it. Here's what that looks like..."

Then present Option 1 or Option 3 as your starting point. If they push back on cost, have Option 2 ready as a lower-risk entry point.

Start with a 3-month pilot at a discounted rate (e.g., 50% off) to get the integration live and prove the value. That makes it much harder for them to walk away once users are using it.

---

## My Take

**Go with Option 3 (hybrid) as your opening proposal.** It's fair, easy to understand, and positions you as someone who's done this before. The flat base gives you something even if usage is slow at first, and the per-unit component means you benefit as they grow.

If they balk entirely on cost, offer a 90-day free pilot with a signed commitment to move to paid after. Get the integration live first — once it's live and users are using it, renegotiating is their problem.

The "Powered by TeeSignal" play isn't worthless, but treat it as a floor, not a ceiling.
