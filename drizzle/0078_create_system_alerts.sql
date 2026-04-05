CREATE TABLE IF NOT EXISTS "system_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"severity" varchar(20) NOT NULL,
	"category" varchar(100) NOT NULL,
	"message" text NOT NULL,
	"details" text,
	"user_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "system_alerts_category_idx" ON "system_alerts" USING btree ("category");
CREATE INDEX IF NOT EXISTS "system_alerts_created_at_idx" ON "system_alerts" USING btree ("created_at");
