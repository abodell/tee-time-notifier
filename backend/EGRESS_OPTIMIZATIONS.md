# Egress Optimizations

Context: pg_stat_statements showed ~8.6M DB calls over 75 days despite tables
totaling a few hundred KB — egress was coming from per-call overhead (fixed
HTTP/JSON cost per round trip), not row payload size. Three causes were
identified; only the first has been fixed so far.

## Done (2026-10-15)

**Server-side prune instead of select-then-diff.** Every provider scan
(ForeUp, ChronoGolf, Quick18, EagleClub, WebTrac, CPS, TeeItUp, Whoosh) used
to SELECT existing availability rows back from Supabase before diffing
against the fresh scrape in Python and deleting by id — this was the
single largest source of calls (~4.3M of 8.6M). Replaced with a
`prune_stale_availability()` Postgres RPC that computes the same diff and
deletes server-side in one round trip. Gated behind `SERVER_SIDE_PRUNE`
(app/config.py, default on).

**Status: deployed to production, verified against live data, waiting to
see the egress number move before touching anything else.**

## Not done yet — hold until egress impact of the above is clear

### 1. Dedupe the per-provider "active alert targets" query

Each of the 8 provider scan jobs independently queries
`alerts JOIN courses` every 45s to build its own scan target list (e.g.
`get_active_foreup_targets()` in `foreup_service.py`, and the equivalent
`get_active_*_targets()` in each sibling service), filtered to that
provider via `.eq("courses.provider", "X")`. Since all 8 jobs are scheduled
on the same 45s cadence, this is effectively the same underlying query run
8 times every cycle.

**Fix:** fetch the full `alerts + courses` join once per cycle (short TTL
cache, ~30s, shared module) and have each provider filter by `provider` in
Python instead of at the query level. Same targets, same 45s cadence per
provider — just one DB round trip instead of eight.

### 2. Collapse the 3x duplicate tier fetch in the alert engine

`run_alert_engine_for_tier()` runs once per membership tier
(Free/Plus/Pro — currently all on the same 60s interval, see
`membership_tiers.scan_interval_seconds`). Each run fetches the *entire*
active-alerts list (joined with courses + user_profiles) from
`alert_service.run_alert_engine()`, then filters down to just that tier's
alerts in Python — meaning the same full join runs 3 times every 60
seconds, with each run using only ~1/3 of what it fetched.
`rollover_recurring_alerts()` is also called once per tier run inside that
same function, so it's similarly tripled.

**Fix:** fetch once per cycle and process all three tiers from that single
result, rather than scheduling three independent full fetches. No change
to per-tier notification latency — same 60s cadence for everyone, just one
fetch instead of three.

## Where to check impact

Supabase dashboard → Project → Reports → Database (egress graph), or:

```sql
select sum(calls) as total_calls, sum(rows) as total_rows
from pg_stat_statements
where query ilike '%availability%' or query ilike '%alerts%'
   or query ilike '%provider_configs%' or query ilike '%alert_notifications%';
```

Compare against the baseline from this investigation: **8,627,517 calls**
since `pg_stat_statements` was last reset (2026-07-31) through 2026-10-15.
