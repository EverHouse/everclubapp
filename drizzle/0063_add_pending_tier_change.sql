ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_tier_change JSONB;
