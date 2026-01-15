-- Create booking_fee_snapshots table for authoritative fee storage
CREATE TABLE IF NOT EXISTS booking_fee_snapshots (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES booking_requests(id),
  session_id INTEGER REFERENCES booking_sessions(id),
  participant_fees JSONB NOT NULL,
  total_cents INTEGER NOT NULL,
  stripe_payment_intent_id VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_fee_snapshots_booking ON booking_fee_snapshots(booking_id);
CREATE INDEX IF NOT EXISTS idx_fee_snapshots_intent ON booking_fee_snapshots(stripe_payment_intent_id);
