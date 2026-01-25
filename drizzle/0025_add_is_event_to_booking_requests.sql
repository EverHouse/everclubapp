-- Add is_event column to booking_requests for marking private/event bookings
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS is_event BOOLEAN DEFAULT FALSE;

-- Create index for filtering event bookings
CREATE INDEX IF NOT EXISTS booking_requests_is_event_idx ON booking_requests(is_event) WHERE is_event = true;
