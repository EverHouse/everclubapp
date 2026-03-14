-- Add missing LOWER(email) functional indexes for case-insensitive email lookups
-- Priority: staff_users and user_linked_emails have highest query frequency

-- staff_users.email — 17 LOWER() queries, every auth check
CREATE INDEX IF NOT EXISTS "idx_staff_users_lower_email" ON "staff_users" (LOWER("email"));

-- user_linked_emails — 42 LOWER() queries, critical for multi-email member lookups
CREATE INDEX IF NOT EXISTS "idx_user_linked_emails_lower_linked_email" ON "user_linked_emails" (LOWER("linked_email"));
CREATE INDEX IF NOT EXISTS "idx_user_linked_emails_lower_primary_email" ON "user_linked_emails" (LOWER("primary_email"));

-- notifications.user_email — 9 queries
CREATE INDEX IF NOT EXISTS "idx_notifications_lower_user_email" ON "notifications" (LOWER("user_email"));

-- group_members.member_email — 5 queries
CREATE INDEX IF NOT EXISTS "idx_group_members_lower_member_email" ON "group_members" (LOWER("member_email"));

-- hubspot_deals.member_email — 5 queries
CREATE INDEX IF NOT EXISTS "idx_hubspot_deals_lower_member_email" ON "hubspot_deals" (LOWER("member_email"));

-- push_subscriptions.user_email — 6 queries
CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_lower_user_email" ON "push_subscriptions" (LOWER("user_email"));

-- communication_logs.member_email — queried in member profile views
CREATE INDEX IF NOT EXISTS "idx_communication_logs_lower_member_email" ON "communication_logs" (LOWER("member_email"));

-- guest_check_ins — queried during check-in flow
CREATE INDEX IF NOT EXISTS "idx_guest_check_ins_lower_member_email" ON "guest_check_ins" (LOWER("member_email"));
CREATE INDEX IF NOT EXISTS "idx_guest_check_ins_lower_guest_email" ON "guest_check_ins" (LOWER("guest_email"));

-- member_notes.member_email — queried in member profile views
CREATE INDEX IF NOT EXISTS "idx_member_notes_lower_member_email" ON "member_notes" (LOWER("member_email"));

-- user_dismissed_notices.user_email — 5 queries
CREATE INDEX IF NOT EXISTS "idx_user_dismissed_notices_lower_user_email" ON "user_dismissed_notices" (LOWER("user_email"));

-- billing_groups.primary_email — 3 queries
CREATE INDEX IF NOT EXISTS "idx_billing_groups_lower_primary_email" ON "billing_groups" (LOWER("primary_email"));

-- form_submissions.email — queried during onboarding
CREATE INDEX IF NOT EXISTS "idx_form_submissions_lower_email" ON "form_submissions" (LOWER("email"));
