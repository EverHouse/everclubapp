ALTER TABLE "form_submissions" ADD COLUMN IF NOT EXISTS "hubspot_submission_id" varchar;
CREATE INDEX IF NOT EXISTS "idx_form_submissions_hubspot_id" ON "form_submissions" ("hubspot_submission_id");
