-- Run via the Supabase MCP plugin before deploying feature/mute-alert-date.
--
-- Lets a user manually mute a single alert until a chosen time (e.g. "I
-- already booked a tee time Saturday, stop notifying me about this course
-- until Monday"). Distinct from alert_notifications.booked_at, which mutes
-- one specific matched tee time rather than the whole alert.
alter table alerts
  add column if not exists muted_until timestamptz;

create index if not exists idx_alerts_muted_until
  on alerts (muted_until)
  where muted_until is not null;
