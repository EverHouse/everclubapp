CREATE TABLE IF NOT EXISTS conference_prepayments (
  id SERIAL PRIMARY KEY,
  member_email VARCHAR(255) NOT NULL,
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  payment_type VARCHAR(20) NOT NULL DEFAULT 'stripe',
  payment_intent_id VARCHAR(255),
  credit_reference_id VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  booking_id INTEGER
);

CREATE INDEX idx_conference_prepayments_member_email ON conference_prepayments(LOWER(member_email));
CREATE INDEX idx_conference_prepayments_status ON conference_prepayments(status);
CREATE INDEX idx_conference_prepayments_payment_intent ON conference_prepayments(payment_intent_id);
CREATE INDEX idx_conference_prepayments_booking_date ON conference_prepayments(booking_date);
