ALTER TABLE users ADD COLUMN IF NOT EXISTS wellhub_status varchar(50);
CREATE INDEX IF NOT EXISTS users_wellhub_status_idx ON users(wellhub_status) WHERE wellhub_status IS NOT NULL;

CREATE TABLE IF NOT EXISTS wellhub_status_events (
  id serial PRIMARY KEY,
  wellhub_user_id varchar(255) NOT NULL,
  user_id varchar(255),
  event_type varchar(100) NOT NULL,
  previous_status varchar(50),
  new_status varchar(50) NOT NULL,
  tier_info jsonb,
  raw_payload jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wellhub_status_events_wellhub_user_id_idx ON wellhub_status_events(wellhub_user_id);
CREATE INDEX IF NOT EXISTS wellhub_status_events_user_id_idx ON wellhub_status_events(user_id);
CREATE INDEX IF NOT EXISTS wellhub_status_events_created_at_idx ON wellhub_status_events(created_at);
