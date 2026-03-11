CREATE INDEX IF NOT EXISTS "users_hubspot_id_idx" ON "users" ("hubspot_id");
CREATE INDEX IF NOT EXISTS "users_tier_id_idx" ON "users" ("tier_id");
CREATE INDEX IF NOT EXISTS "idx_users_lower_trackman_email" ON "users" (LOWER("trackman_email"));
CREATE INDEX IF NOT EXISTS "member_notes_member_email_idx" ON "member_notes" ("member_email");
CREATE INDEX IF NOT EXISTS "communication_logs_member_email_idx" ON "communication_logs" ("member_email");
CREATE INDEX IF NOT EXISTS "magic_links_token_idx" ON "magic_links" ("token");
DROP INDEX IF EXISTS "idx_booking_participants_lower_email";
