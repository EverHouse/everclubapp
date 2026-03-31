ALTER TABLE wellhub_checkins ADD COLUMN IF NOT EXISTS event_reported_at timestamp;
CREATE INDEX IF NOT EXISTS wellhub_checkins_event_reported_idx ON wellhub_checkins(event_reported_at) WHERE event_reported_at IS NULL AND validation_status = 'validated';
