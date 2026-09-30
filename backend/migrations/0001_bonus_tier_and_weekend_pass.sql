-- Run this in the Supabase SQL editor BEFORE deploying feature/weekend-pass.
-- Adds a "bonus tier" layer to user_profiles: a temporary tier grant (Weekend
-- Pass, referral rewards, etc.) that sits on top of the user's real
-- subscription tier without ever overwriting it. RevenueCat webhooks keep
-- writing to membership_tier_id exactly as they do today — bonus_tier_id and
-- bonus_expires_at are additive and only ever read/written by the new
-- membership_service helpers.

alter table user_profiles
  add column if not exists bonus_tier_id integer references membership_tiers(id),
  add column if not exists bonus_expires_at timestamptz;

-- Speeds up the periodic "find expired bonus grants" sweep.
create index if not exists idx_user_profiles_bonus_expires_at
  on user_profiles (bonus_expires_at)
  where bonus_expires_at is not null;
