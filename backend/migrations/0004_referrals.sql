-- Run in Supabase SQL editor (or via the Supabase MCP once reconnected)
-- before deploying feature/referral-engine.
--
-- bonus_tier_id / bonus_expires_at are the same "temporary tier grant"
-- columns feature/weekend-pass introduces. If that branch's migration
-- (0001) already ran, these two are no-ops (IF NOT EXISTS); if this branch
-- lands first, weekend-pass's migration becomes the no-op instead. Either
-- order is safe.
alter table user_profiles
  add column if not exists referral_code text unique,
  add column if not exists referred_by uuid references user_profiles(id),
  add column if not exists bonus_tier_id integer references membership_tiers(id),
  add column if not exists bonus_expires_at timestamptz;

create index if not exists idx_user_profiles_referral_code
  on user_profiles (referral_code);

create index if not exists idx_user_profiles_bonus_expires_at
  on user_profiles (bonus_expires_at)
  where bonus_expires_at is not null;
