ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "apple_id" varchar;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "apple_email" varchar;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "apple_linked_at" timestamp;
