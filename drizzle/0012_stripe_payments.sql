-- Add stripe_customer_id to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR;

-- Create stripe_payment_intents table for tracking one-off charges
CREATE TABLE IF NOT EXISTS stripe_payment_intents (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  stripe_payment_intent_id VARCHAR NOT NULL UNIQUE,
  stripe_customer_id VARCHAR,
  amount_cents INTEGER NOT NULL,
  purpose VARCHAR NOT NULL, -- 'guest_fee', 'overage_fee', 'one_time_purchase'
  booking_id INTEGER, -- nullable, for linking to bookings
  session_id INTEGER, -- nullable, for linking to booking_sessions
  description TEXT,
  status VARCHAR NOT NULL DEFAULT 'pending', -- 'pending', 'succeeded', 'failed', 'canceled'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for stripe_payment_intents
CREATE INDEX IF NOT EXISTS stripe_payment_intents_user_id_idx ON stripe_payment_intents(user_id);
CREATE INDEX IF NOT EXISTS stripe_payment_intents_booking_id_idx ON stripe_payment_intents(booking_id);
CREATE INDEX IF NOT EXISTS stripe_payment_intents_status_idx ON stripe_payment_intents(status);

-- Add stripe_payment_intent_id to booking_participants for tracking payments
ALTER TABLE booking_participants ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR;
ALTER TABLE booking_participants ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;
