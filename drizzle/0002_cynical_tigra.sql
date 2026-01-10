CREATE TYPE "public"."booking_source" AS ENUM('member_request', 'staff_manual', 'trackman_import');--> statement-breakpoint
CREATE TYPE "public"."participant_payment_status" AS ENUM('pending', 'paid', 'waived');--> statement-breakpoint
CREATE TYPE "public"."participant_type" AS ENUM('owner', 'member', 'guest');--> statement-breakpoint
CREATE TYPE "public"."payment_audit_action" AS ENUM('payment_confirmed', 'payment_waived', 'tier_override', 'staff_direct_add', 'checkin_guard_triggered', 'reconciliation_adjusted');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('guest_pass', 'credit_card', 'unpaid', 'waived');--> statement-breakpoint
CREATE TABLE "booking_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"user_id" varchar,
	"guest_id" integer,
	"participant_type" "participant_type" NOT NULL,
	"display_name" varchar NOT NULL,
	"slot_duration" integer,
	"payment_status" "participant_payment_status" DEFAULT 'pending',
	"trackman_player_row_id" varchar,
	"invite_status" varchar DEFAULT 'pending',
	"invited_at" timestamp,
	"responded_at" timestamp,
	"invite_expires_at" timestamp,
	"expired_reason" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "booking_payment_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"session_id" integer,
	"participant_id" integer,
	"action" "payment_audit_action" NOT NULL,
	"staff_email" varchar NOT NULL,
	"staff_name" varchar,
	"reason" text,
	"amount_affected" numeric(10, 2),
	"previous_status" varchar,
	"new_status" varchar,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "booking_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"trackman_booking_id" varchar,
	"resource_id" integer NOT NULL,
	"session_date" date NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"source" "booking_source" DEFAULT 'member_request',
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "booking_sessions_trackman_booking_id_unique" UNIQUE("trackman_booking_id")
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"email" varchar,
	"phone" varchar,
	"created_by_member_id" varchar,
	"last_visit_date" date,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"member_id" varchar,
	"minutes_charged" integer DEFAULT 0 NOT NULL,
	"overage_fee" numeric(10, 2) DEFAULT '0.00',
	"guest_fee" numeric(10, 2) DEFAULT '0.00',
	"tier_at_booking" varchar,
	"payment_method" "payment_method" DEFAULT 'unpaid',
	"source" "booking_source" DEFAULT 'member_request',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "welcome_email_sent" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "welcome_email_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trackman_email" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_opt_in" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_opt_in" boolean;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "trackman_player_count" integer;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "session_id" integer;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "declared_player_count" integer;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "final_player_count" integer;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "original_start_time" time;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "original_end_time" time;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "original_resource_id" integer;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "member_notes" varchar(280);--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "reconciliation_status" varchar;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "reconciliation_notes" text;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "reconciled_by" varchar;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN "reconciled_at" timestamp;--> statement-breakpoint
CREATE INDEX "booking_participants_session_idx" ON "booking_participants" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "booking_participants_user_idx" ON "booking_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "booking_participants_guest_idx" ON "booking_participants" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "booking_payment_audit_booking_idx" ON "booking_payment_audit" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "booking_payment_audit_session_idx" ON "booking_payment_audit" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "booking_payment_audit_staff_idx" ON "booking_payment_audit" USING btree ("staff_email");--> statement-breakpoint
CREATE INDEX "booking_sessions_resource_date_idx" ON "booking_sessions" USING btree ("resource_id","session_date");--> statement-breakpoint
CREATE INDEX "booking_sessions_trackman_idx" ON "booking_sessions" USING btree ("trackman_booking_id");--> statement-breakpoint
CREATE INDEX "guests_email_idx" ON "guests" USING btree ("email");--> statement-breakpoint
CREATE INDEX "guests_created_by_idx" ON "guests" USING btree ("created_by_member_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_session_idx" ON "usage_ledger" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_member_idx" ON "usage_ledger" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "booking_requests_session_idx" ON "booking_requests" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "booking_requests_date_resource_idx" ON "booking_requests" USING btree ("request_date","resource_id");