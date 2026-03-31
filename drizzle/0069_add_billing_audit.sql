CREATE TABLE IF NOT EXISTS "billing_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_email" varchar NOT NULL,
	"member_id" varchar,
	"action" varchar NOT NULL,
	"amount_cents" integer,
	"description" text,
	"booking_id" integer,
	"session_id" integer,
	"payment_intent_id" varchar,
	"invoice_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_audit_member_email" ON "billing_audit" USING btree ("member_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_audit_created_at" ON "billing_audit" USING btree ("created_at" DESC);
