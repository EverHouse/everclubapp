-- Add resource_id column to webhook_processed_events for proper event ordering
ALTER TABLE webhook_processed_events ADD COLUMN IF NOT EXISTS resource_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_webhook_events_resource ON webhook_processed_events(resource_id);
