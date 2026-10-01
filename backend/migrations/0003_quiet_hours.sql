-- Run in Supabase SQL editor (or via the Supabase MCP once reconnected)
-- before deploying feature/quiet-hours.
alter table user_profiles
  add column if not exists quiet_hours_enabled boolean not null default false,
  add column if not exists quiet_hours_start time,
  add column if not exists quiet_hours_end time;
