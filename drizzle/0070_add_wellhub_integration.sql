ALTER TABLE users ADD COLUMN IF NOT EXISTS wellhub_id varchar;
CREATE INDEX IF NOT EXISTS users_wellhub_id_idx ON users(wellhub_id);

CREATE TABLE IF NOT EXISTS wellhub_checkins (
  id serial PRIMARY KEY,
  wellhub_user_id varchar(255) NOT NULL,
  user_id varchar(255),
  gym_id varchar(100) NOT NULL,
  event_type varchar(100) NOT NULL,
  booking_number varchar(255),
  event_timestamp timestamp,
  expires_at timestamp,
  validation_status varchar(50) NOT NULL DEFAULT 'pending',
  validated_at timestamp,
  error_detail text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wellhub_checkins_wellhub_user_id_idx ON wellhub_checkins(wellhub_user_id);
CREATE INDEX IF NOT EXISTS wellhub_checkins_user_id_idx ON wellhub_checkins(user_id);
CREATE INDEX IF NOT EXISTS wellhub_checkins_validation_status_idx ON wellhub_checkins(validation_status);
CREATE INDEX IF NOT EXISTS wellhub_checkins_created_at_idx ON wellhub_checkins(created_at);
