-- Run in Supabase SQL editor (or via the Supabase MCP once reconnected)
-- before deploying feature/free-tier-lifetime-cap.
--
-- Tracks how many alerts a user has EVER created, independent of the
-- `alerts` table (rows there are hard-deleted, so they can't answer "how
-- many total" once someone deletes and recreates). Never decremented.
alter table user_profiles
  add column if not exists lifetime_alerts_created integer not null default 0;
