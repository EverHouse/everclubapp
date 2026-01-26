-- Enable btree_gist extension (required for combining equality and range operators)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Add exclusion constraint to prevent overlapping bookings on the same resource/date
-- This creates a timestamp range from date + times and uses the overlap operator (&&)
-- Only applies to active bookings (pending, approved, confirmed)
-- Cancelled/rejected bookings are allowed to overlap

-- Add the exclusion constraint for overlapping time ranges
-- Combines request_date + start_time and request_date + end_time into tsrange
ALTER TABLE booking_requests 
ADD CONSTRAINT booking_requests_no_overlap 
EXCLUDE USING gist (
  resource_id WITH =,
  tsrange(
    (request_date + start_time)::timestamp,
    (request_date + end_time)::timestamp
  ) WITH &&
)
WHERE (status IN ('pending', 'approved', 'confirmed') AND resource_id IS NOT NULL);

-- Add a comment explaining the constraint
COMMENT ON CONSTRAINT booking_requests_no_overlap ON booking_requests IS 
'Prevents overlapping bookings on the same resource. Only applies to active bookings (pending/approved/confirmed).';
