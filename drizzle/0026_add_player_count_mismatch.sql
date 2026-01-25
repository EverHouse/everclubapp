-- Add player_count_mismatch column to booking_requests
-- This flag indicates when Trackman reports more players than the app request declared
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS player_count_mismatch BOOLEAN DEFAULT FALSE;
