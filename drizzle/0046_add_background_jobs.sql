CREATE TABLE IF NOT EXISTS "background_jobs" (
  "id" varchar(100) PRIMARY KEY NOT NULL,
  "job_type" varchar(100) NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'running',
  "dry_run" boolean DEFAULT false,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "progress" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result" jsonb,
  "error" text,
  "started_by" varchar(255)
);

CREATE INDEX IF NOT EXISTS "background_jobs_job_type_idx" ON "background_jobs" ("job_type");
CREATE INDEX IF NOT EXISTS "background_jobs_status_idx" ON "background_jobs" ("status");
