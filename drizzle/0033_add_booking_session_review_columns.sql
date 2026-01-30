-- Add review columns to booking_sessions for flagging payment mismatches
ALTER TABLE booking_sessions ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE;
ALTER TABLE booking_sessions ADD COLUMN IF NOT EXISTS review_reason TEXT;
