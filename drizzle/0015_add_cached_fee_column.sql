-- Add cached fee column to booking_participants for authoritative fee storage
ALTER TABLE booking_participants ADD COLUMN IF NOT EXISTS cached_fee_cents INTEGER DEFAULT 0;

-- Create index for efficient fee lookups
CREATE INDEX IF NOT EXISTS idx_booking_participants_cached_fee ON booking_participants(session_id, cached_fee_cents) WHERE cached_fee_cents > 0;
