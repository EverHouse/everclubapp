-- ============================================================================
-- FIX SUPABASE DATABASE ADVISORIES
-- ============================================================================
-- Resolves ~100+ Supabase linter advisories:
-- 1. Enable RLS on all public tables (deny-all, no policies needed)
-- 2. Drop duplicate indexes
-- 3. Drop unused indexes
-- 4. Add missing FK index on conference_prepayments.booking_id
-- 5. Fix function search paths to prevent search path injection
--
-- SAFETY: The app uses service role key (bypasses RLS) and direct PostgreSQL
-- connections (bypasses PostgREST), so enabling RLS with deny-all is safe.
-- ============================================================================

-- ============================================================================
-- 1. ENABLE ROW LEVEL SECURITY ON ALL PUBLIC TABLES
-- ============================================================================
-- Default deny-all policy blocks unauthorized PostgREST access.
-- Service role key and direct PostgreSQL connections bypass RLS.

ALTER TABLE IF EXISTS "account_deletion_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "admin_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "announcements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "availability_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "background_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "billing_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "billing_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "booking_fee_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "booking_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "booking_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "booking_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "booking_wallet_passes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "bug_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "cafe_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "closure_reasons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "communication_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "conference_prepayments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "data_export_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "day_pass_purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "discount_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "dismissed_hubspot_meetings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "email_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "event_rsvps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "facility_closures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "failed_side_effects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "family_add_on_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "faqs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "fee_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "form_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "gallery_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "group_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "guest_check_ins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "guest_pass_holds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "guest_passes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "guests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "hubspot_deals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "hubspot_form_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "hubspot_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "hubspot_processed_webhooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "hubspot_product_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "hubspot_sync_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "integrity_check_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "integrity_ignores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "integrity_issues_tracking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "job_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "legacy_import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "legacy_purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "magic_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "member_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "membership_tiers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "merch_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "notice_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "pass_redemption_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "passkeys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "rate_limit_hits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "resources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "staff_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "stripe_payment_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "stripe_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "stripe_transaction_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "subscription_locks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "sync_exclusions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "system_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "terminal_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "tier_feature_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "tier_features" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "tours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "trackman_bay_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "trackman_import_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "trackman_unmatched_bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "trackman_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "training_sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "usage_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "user_dismissed_notices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "user_linked_emails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "walk_in_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "wallet_pass_auth_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "wallet_pass_device_registrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "webhook_dead_letter_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "webhook_processed_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "wellhub_checkins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "wellhub_status_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "wellness_classes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "wellness_enrollments" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. DROP DUPLICATE INDEXES
-- ============================================================================
-- For each pair, keep the schema-defined or more descriptive one.

-- availability_blocks: idx_availability_blocks_bay_date = idx_availability_blocks_resource_date
DROP INDEX IF EXISTS "idx_availability_blocks_bay_date";

-- booking_requests: booking_requests_session_idx = idx_booking_requests_session_id
DROP INDEX IF EXISTS "idx_booking_requests_session_id";

-- booking_requests: booking_requests_status_idx = idx_booking_requests_status (both in schema, removing idx_booking_requests_status)
DROP INDEX IF EXISTS "idx_booking_requests_status";

-- communication_logs: communication_logs_member_email_idx = idx_communication_logs_email (both in schema)
DROP INDEX IF EXISTS "idx_communication_logs_email";

-- day_pass_purchases: three indexes on stripe_payment_intent_id, keep the unique constraint
DROP INDEX IF EXISTS "idx_day_pass_purchases_payment_intent_unique";
DROP INDEX IF EXISTS "idx_day_pass_purchases_stripe_payment_intent_id";

-- events: idx_events_date = idx_events_event_date
DROP INDEX IF EXISTS "idx_events_date";

-- event_rsvps: idx_event_rsvps_lower_email = idx_event_rsvps_user_email_lower (both in schema)
DROP INDEX IF EXISTS "idx_event_rsvps_user_email_lower";

-- form_submissions: idx_form_submissions_type = form_submissions_form_type_idx
DROP INDEX IF EXISTS "idx_form_submissions_type";

-- users: users_membership_status_idx = idx_users_membership_status (both in schema)
DROP INDEX IF EXISTS "idx_users_membership_status";

-- users: users_hubspot_id_idx = idx_users_hubspot_id (both unused, keep schema-defined users_hubspot_id_idx)
DROP INDEX IF EXISTS "idx_users_hubspot_id";

-- users: users_stripe_customer_id_idx = idx_users_stripe_customer_id (keep schema-defined)
DROP INDEX IF EXISTS "idx_users_stripe_customer_id";

-- walk_in_visits: two LOWER(member_email) indexes
DROP INDEX IF EXISTS "idx_walk_in_visits_member_email_lower";

-- webhook_processed_events: idx_webhook_events_type = idx_webhook_processed_events_type
DROP INDEX IF EXISTS "idx_webhook_events_type";

-- stripe_payment_intents: duplicate booking_id indexes (both in schema)
DROP INDEX IF EXISTS "idx_stripe_payment_intents_booking_id";

-- billing_groups: plain index duplicated by unique constraint
DROP INDEX IF EXISTS "billing_groups_primary_email_idx";

-- booking_wallet_passes: plain serial_number index duplicated by unique constraint
DROP INDEX IF EXISTS "booking_wallet_passes_serial_idx";

-- stripe_products: plain indexes duplicated by unique constraints
DROP INDEX IF EXISTS "stripe_products_hubspot_product_id_idx";
DROP INDEX IF EXISTS "stripe_products_stripe_product_id_idx";

-- family_add_on_products: plain tier_name index duplicated by unique constraint
DROP INDEX IF EXISTS "family_add_on_products_tier_name_idx";

-- terminal_payments: plain payment_intent index duplicated by unique constraint
DROP INDEX IF EXISTS "idx_terminal_payments_payment_intent_id";

-- guest_passes: plain member_email index duplicated by unique constraint
DROP INDEX IF EXISTS "guest_passes_member_email_idx";

-- magic_links: plain token index duplicated by unique constraint
DROP INDEX IF EXISTS "magic_links_token_idx";

-- rate_limits: Drizzle schema defines uniqueIndex("rate_limits_key_idx"), keep it;
-- Ensure the unique index exists before dropping the duplicate constraint
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limits_key_idx" ON "rate_limits" ("key");
ALTER TABLE "rate_limits" DROP CONSTRAINT IF EXISTS "rate_limits_key_key";

-- integrity_ignores: Drizzle schema defines uniqueIndex("integrity_ignores_issue_key_idx");
-- Ensure the unique index exists (may have been dropped by migration 0060), then drop the duplicate constraint
CREATE UNIQUE INDEX IF NOT EXISTS "integrity_ignores_issue_key_idx" ON "integrity_ignores" ("issue_key");
ALTER TABLE "integrity_ignores" DROP CONSTRAINT IF EXISTS "integrity_ignores_issue_key_unique";

-- ============================================================================
-- 3. DROP UNUSED INDEXES (never scanned, not needed)
-- ============================================================================
-- These indexes have 0 scans since last stats reset. DB-only indexes (not in schema).

-- booking_requests: various unused DB-only indexes
DROP INDEX IF EXISTS "idx_booking_requests_user";
DROP INDEX IF EXISTS "idx_booking_requests_date";
DROP INDEX IF EXISTS "idx_booking_requests_date_status";
DROP INDEX IF EXISTS "idx_booking_requests_resource_id";
DROP INDEX IF EXISTS "idx_booking_requests_resource_date_status";
DROP INDEX IF EXISTS "idx_booking_requests_closure_id";

-- booking_sessions: unused DB-only indexes
DROP INDEX IF EXISTS "idx_booking_sessions_resource_id";
DROP INDEX IF EXISTS "idx_booking_sessions_session_date";

-- booking_participants: unused DB-only indexes
DROP INDEX IF EXISTS "idx_booking_participants_user_id";
DROP INDEX IF EXISTS "idx_booking_participants_payment_status";
DROP INDEX IF EXISTS "idx_booking_participants_cached_fee";
DROP INDEX IF EXISTS "idx_bp_used_guest_pass";
DROP INDEX IF EXISTS "idx_bp_waiver_reviewed";

-- booking_fee_snapshots: unused session plain index (unique conditional index covers completed lookups)
DROP INDEX IF EXISTS "idx_fee_snapshots_session";

-- usage_ledger: unused DB-only indexes (schema-defined ones remain)
DROP INDEX IF EXISTS "idx_usage_ledger_member";

-- admin_audit_log: unused DB-only indexes
DROP INDEX IF EXISTS "idx_admin_audit_log_action_date";
DROP INDEX IF EXISTS "idx_admin_audit_log_created";

-- announcements: unused DB-only indexes
DROP INDEX IF EXISTS "idx_announcements_is_active";
DROP INDEX IF EXISTS "idx_announcements_starts_at";

-- communication_logs: unused DB-only indexes
DROP INDEX IF EXISTS "idx_communication_logs_type";

-- events: unused DB-only indexes
DROP INDEX IF EXISTS "idx_events_visibility";

-- form_submissions: unused DB-only indexes
DROP INDEX IF EXISTS "form_submissions_form_type_idx";
DROP INDEX IF EXISTS "form_submissions_created_at_idx";
DROP INDEX IF EXISTS "idx_form_submissions_hubspot_id";
DROP INDEX IF EXISTS "idx_form_submissions_status";

-- gallery_images: unused DB-only indexes
DROP INDEX IF EXISTS "idx_gallery_active";

-- staff_users: unused DB-only indexes
DROP INDEX IF EXISTS "idx_staff_users_is_active";

-- hubspot_sync_queue: unused DB-only indexes
DROP INDEX IF EXISTS "idx_hubspot_sync_queue_status";

-- stripe_payment_intents: unused DB-only indexes
DROP INDEX IF EXISTS "idx_stripe_payment_intents_booking_status";
DROP INDEX IF EXISTS "stripe_payment_intents_product_id_idx";

-- day_pass_purchases: unused DB-only indexes
DROP INDEX IF EXISTS "idx_day_pass_purchases_booking_id";
DROP INDEX IF EXISTS "idx_day_pass_purchases_redeemed_at";

-- wellness_enrollments: unused DB-only indexes
DROP INDEX IF EXISTS "idx_wellness_enrollments_user_email";
DROP INDEX IF EXISTS "idx_wellness_enrollments_status";

-- users: unused DB-only indexes
DROP INDEX IF EXISTS "idx_users_status_role";

-- email_events: unused DB-only indexes
DROP INDEX IF EXISTS "idx_email_events_created";
DROP INDEX IF EXISTS "idx_email_events_recipient";
DROP INDEX IF EXISTS "idx_email_events_type";

-- facility_closures: unused DB-only indexes
DROP INDEX IF EXISTS "idx_facility_closures_start_date";
DROP INDEX IF EXISTS "idx_facility_closures_date_range";
DROP INDEX IF EXISTS "idx_facility_closures_is_active";

-- rate_limit_hits: unused DB-only index
DROP INDEX IF EXISTS "idx_rate_limit_hits_window";

-- webhook_processed_events: unused DB-only indexes
DROP INDEX IF EXISTS "idx_webhook_events_resource";

-- webhook_dead_letter_queue: unused DB-only indexes
DROP INDEX IF EXISTS "idx_webhook_dlq_created_at";
DROP INDEX IF EXISTS "idx_webhook_dlq_unresolved";
DROP INDEX IF EXISTS "idx_webhook_dlq_resource_id";

-- wellhub_checkins: unused DB-only indexes
DROP INDEX IF EXISTS "wellhub_checkins_event_reported_idx";

-- trackman_unmatched_bookings: unused renamed index
DROP INDEX IF EXISTS "idx_trackman_unmatched_bookings_resolved";

-- ============================================================================
-- 4. ADD MISSING FOREIGN KEY INDEX
-- ============================================================================

CREATE INDEX IF NOT EXISTS "idx_conference_prepayments_booking_id"
  ON "conference_prepayments" ("booking_id");

-- ============================================================================
-- 5. FIX FUNCTION SEARCH PATHS
-- ============================================================================
-- Prevents search path injection by setting search_path explicitly.

CREATE OR REPLACE FUNCTION booking_tsrange(d date, st time, et time)
RETURNS tsrange
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = public
AS $$
  SELECT tsrange((d + st), (d + et), '[)')
$$;

CREATE OR REPLACE FUNCTION booking_time_range(req_date date, s_time time, e_time time)
RETURNS tsrange
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $function$
BEGIN
  IF e_time <= s_time THEN
    RETURN tsrange((req_date + s_time)::timestamp, (req_date + INTERVAL '1 day' + e_time)::timestamp);
  ELSE
    RETURN tsrange((req_date + s_time)::timestamp, (req_date + e_time)::timestamp);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION generate_trackman_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.trackman_email IS NULL THEN
    NEW.trackman_email := LOWER(
      REGEXP_REPLACE(
        CONCAT(
          TRIM(BOTH '.' FROM REGEXP_REPLACE(
            CONCAT(
              COALESCE(TRIM(NEW.first_name), ''),
              '.',
              COALESCE(TRIM(NEW.last_name), '')
            ),
            '[^a-zA-Z0-9.]', '', 'g'
          )),
          '@evenhouse.club'
        ),
        '\.+@', '@', 'g'
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;
