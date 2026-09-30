-- Run in Supabase SQL editor (or via the Supabase MCP once reconnected)
-- before deploying feature/booked-mute.
alter table alert_notifications
  add column if not exists booked_at timestamptz;
