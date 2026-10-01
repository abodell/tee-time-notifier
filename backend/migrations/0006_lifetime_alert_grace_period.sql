-- Run via the Supabase MCP plugin before deploying this revision of
-- feature/free-tier-lifetime-cap.
--
-- Free-tier alerts now only count toward the lifetime cap once they've
-- survived FREE_LIFETIME_ALERT_GRACE_HOURS (see app/config.py), so an
-- alert created by mistake and deleted shortly after doesn't cost a free
-- user one of their 3 lifetime slots. A background job flips this to true
-- once an alert clears the grace period, at which point it also increments
-- user_profiles.lifetime_alerts_created.
--
-- Default TRUE is intentional: every alert that exists before this
-- migration runs was already counted under the old creation-time-increment
-- logic, so it must be treated as already-counted (a no-op for the job).
-- The create_alert endpoint explicitly inserts `counted_toward_lifetime:
-- false` for every new alert going forward.
alter table alerts
  add column if not exists counted_toward_lifetime boolean not null default true;

create index if not exists idx_alerts_uncounted_lifetime
  on alerts (created_at)
  where counted_toward_lifetime = false;
