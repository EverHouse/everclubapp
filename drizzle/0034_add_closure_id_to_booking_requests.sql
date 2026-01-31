-- Add closure_id column to booking_requests table
-- Links booking requests to facility closures when marked as private events
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS closure_id INTEGER REFERENCES facility_closures(id);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_booking_requests_closure_id ON booking_requests(closure_id) WHERE closure_id IS NOT NULL;
