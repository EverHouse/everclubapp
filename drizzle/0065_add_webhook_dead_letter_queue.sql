CREATE TABLE IF NOT EXISTS "webhook_dead_letter_queue" (
  "id" serial PRIMARY KEY,
  "event_id" varchar(255) NOT NULL UNIQUE,
  "event_type" varchar(100) NOT NULL,
  "resource_id" varchar(255),
  "reason" text NOT NULL,
  "event_payload" jsonb,
  "created_at" timestamp DEFAULT NOW() NOT NULL,
  "resolved_at" timestamp,
  "resolved_by" varchar(255)
);

CREATE INDEX IF NOT EXISTS "idx_webhook_dlq_resource_id" ON "webhook_dead_letter_queue" ("resource_id");
CREATE INDEX IF NOT EXISTS "idx_webhook_dlq_created_at" ON "webhook_dead_letter_queue" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_webhook_dlq_unresolved" ON "webhook_dead_letter_queue" ("resolved_at") WHERE "resolved_at" IS NULL;
