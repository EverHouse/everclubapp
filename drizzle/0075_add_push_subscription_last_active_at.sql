-- Add last_active_at column to push_subscriptions for stale subscription cleanup.
-- Backfill from created_at so existing subscriptions have a baseline.

ALTER TABLE "push_subscriptions"
  ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMP DEFAULT NOW();

UPDATE "push_subscriptions"
  SET "last_active_at" = "created_at"
  WHERE "last_active_at" IS NULL OR "last_active_at" > "created_at";

CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_last_active_at"
  ON "push_subscriptions" ("last_active_at");
