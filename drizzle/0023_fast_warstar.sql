CREATE TABLE "tier_feature_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"feature_id" integer NOT NULL,
	"tier_id" integer NOT NULL,
	"value_boolean" boolean,
	"value_number" numeric,
	"value_text" varchar,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tier_features" (
	"id" serial PRIMARY KEY NOT NULL,
	"feature_key" varchar NOT NULL,
	"display_label" varchar NOT NULL,
	"value_type" varchar DEFAULT 'boolean' NOT NULL,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "tier_features_feature_key_unique" UNIQUE("feature_key")
);
--> statement-breakpoint
CREATE TABLE "trackman_webhook_dedup" (
	"id" serial PRIMARY KEY NOT NULL,
	"trackman_booking_id" varchar NOT NULL,
	"received_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "trackman_webhook_dedup_trackman_booking_id_unique" UNIQUE("trackman_booking_id")
);
--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"locked_at" timestamp,
	"locked_by" varchar(255),
	"scheduled_for" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"webhook_event_id" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(500) NOT NULL,
	"limit_type" varchar(50) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp NOT NULL,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "conference_prepayments" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_email" varchar(255) NOT NULL,
	"booking_date" varchar(10) NOT NULL,
	"start_time" varchar(8) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"payment_type" varchar(20) DEFAULT 'stripe' NOT NULL,
	"payment_intent_id" varchar(255),
	"credit_reference_id" varchar(255),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"booking_id" integer
);
--> statement-breakpoint
CREATE TABLE "guest_pass_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_email" varchar(255) NOT NULL,
	"booking_id" integer NOT NULL,
	"passes_held" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "terminal_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"user_email" varchar(255) NOT NULL,
	"stripe_payment_intent_id" varchar(255) NOT NULL,
	"stripe_subscription_id" varchar(255) NOT NULL,
	"stripe_invoice_id" varchar(255),
	"stripe_customer_id" varchar(255),
	"amount_cents" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'usd',
	"reader_id" varchar(255),
	"reader_label" varchar(255),
	"status" varchar(50) DEFAULT 'succeeded' NOT NULL,
	"refunded_at" timestamp with time zone,
	"refund_amount_cents" integer,
	"disputed_at" timestamp with time zone,
	"dispute_id" varchar(255),
	"dispute_status" varchar(50),
	"processed_by" varchar(255),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DROP INDEX "idx_booking_requests_trackman_booking_id";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_current_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_promo_opt_in" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_transactional_opt_in" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_reminders_opt_in" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_delinquent" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "contract_start_date" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cancellation_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cancellation_effective_date" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_id" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_email" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_linked_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "id_image_url" text;--> statement-breakpoint
ALTER TABLE "membership_tiers" ADD COLUMN "show_on_membership_page" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "request_participants" jsonb;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "is_event" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "player_count_mismatch" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "roster_version" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "closure_id" integer;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "cancellation_pending_at" timestamp;--> statement-breakpoint
ALTER TABLE "booking_sessions" ADD COLUMN "needs_review" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "booking_sessions" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "facility_closures" ADD COLUMN "member_notice" text;--> statement-breakpoint
ALTER TABLE "facility_closures" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "google_sheet_row_id" integer;--> statement-breakpoint
ALTER TABLE "cafe_items" ADD COLUMN "stripe_product_id" varchar;--> statement-breakpoint
ALTER TABLE "cafe_items" ADD COLUMN "stripe_price_id" varchar;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "block_simulators" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "block_conference_room" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "wellness_classes" ADD COLUMN "block_simulators" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "wellness_classes" ADD COLUMN "block_conference_room" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD COLUMN "actor_type" varchar(50) DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD COLUMN "actor_email" varchar(255);--> statement-breakpoint
ALTER TABLE "billing_groups" ADD COLUMN "max_seats" integer;--> statement-breakpoint
ALTER TABLE "day_pass_purchases" ADD COLUMN "redeemed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "day_pass_purchases" ADD COLUMN "booking_id" integer;--> statement-breakpoint
ALTER TABLE "tier_feature_values" ADD CONSTRAINT "tier_feature_values_feature_id_tier_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."tier_features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_feature_values" ADD CONSTRAINT "tier_feature_values_tier_id_membership_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."membership_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tier_feature_values_feature_tier_idx" ON "tier_feature_values" USING btree ("feature_id","tier_id");--> statement-breakpoint
CREATE INDEX "tier_features_sort_order_idx" ON "tier_features" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "trackman_webhook_dedup_booking_idx" ON "trackman_webhook_dedup" USING btree ("trackman_booking_id");--> statement-breakpoint
CREATE INDEX "trackman_webhook_dedup_received_idx" ON "trackman_webhook_dedup" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "job_queue_status_idx" ON "job_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_queue_job_type_idx" ON "job_queue" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "job_queue_scheduled_for_idx" ON "job_queue" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "job_queue_webhook_event_idx" ON "job_queue" USING btree ("webhook_event_id");--> statement-breakpoint
CREATE INDEX "job_queue_pending_jobs_idx" ON "job_queue" USING btree ("status","scheduled_for","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_key_idx" ON "rate_limits" USING btree ("key");--> statement-breakpoint
CREATE INDEX "rate_limits_reset_at_idx" ON "rate_limits" USING btree ("reset_at");--> statement-breakpoint
CREATE INDEX "idx_conference_prepayments_member_email" ON "conference_prepayments" USING btree ("member_email");--> statement-breakpoint
CREATE INDEX "idx_conference_prepayments_status" ON "conference_prepayments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_conference_prepayments_payment_intent" ON "conference_prepayments" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "idx_conference_prepayments_booking_date" ON "conference_prepayments" USING btree ("booking_date");--> statement-breakpoint
CREATE INDEX "idx_guest_pass_holds_member_email" ON "guest_pass_holds" USING btree ("member_email");--> statement-breakpoint
CREATE INDEX "idx_guest_pass_holds_booking_id" ON "guest_pass_holds" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "idx_terminal_payments_user_id" ON "terminal_payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_terminal_payments_payment_intent_id" ON "terminal_payments" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "idx_terminal_payments_subscription_id" ON "terminal_payments" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "idx_terminal_payments_status" ON "terminal_payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_members_booking_slot_idx" ON "booking_members" USING btree ("booking_id","slot_number");--> statement-breakpoint
CREATE INDEX "admin_audit_log_actor_type_idx" ON "admin_audit_log" USING btree ("actor_type");--> statement-breakpoint
CREATE INDEX "admin_audit_log_actor_email_idx" ON "admin_audit_log" USING btree ("actor_email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_booking_requests_trackman_booking_id" ON "booking_requests" USING btree ("trackman_booking_id");