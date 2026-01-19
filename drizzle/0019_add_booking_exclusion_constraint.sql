-- ============================================================================
-- BOOKING OVERLAP PREVENTION - DATABASE-LEVEL PROTECTION
-- ============================================================================
-- This migration provides database-level protection against race conditions
-- where two simultaneous requests could both pass application-level conflict
-- checks and create overlapping bookings on the same resource.
-- ============================================================================

-- Enable btree_gist extension (required for exclusion constraints with ranges)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Create an immutable function to generate a timestamp range from date and time columns
-- Required because PostgreSQL needs immutable functions for index expressions
CREATE OR REPLACE FUNCTION booking_tsrange(d date, st time, et time)
RETURNS tsrange
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT tsrange((d + st), (d + et), '[)')
$$;

-- ============================================================================
-- STATUS: CONSTRAINT DEFERRED - REQUIRES DATA CLEANUP
-- ============================================================================
-- The exclusion constraint below cannot be enabled because existing data
-- contains overlapping bookings on the same resource. This may be due to:
-- 1. Historical data imported before conflict detection was implemented
-- 2. Legitimate shared bookings (multiple members on same resource/time)
-- 3. Race conditions that occurred before database-level protection
--
-- IDENTIFIED CONFLICTS (as of migration creation):
-- Query found 12+ overlapping booking pairs that need resolution.
--
-- TO IDENTIFY CURRENT CONFLICTS, run:
-- 
-- SELECT 
--   b1.id as booking1_id, b1.user_email as email1, b1.status as status1,
--   b2.id as booking2_id, b2.user_email as email2, b2.status as status2,
--   b1.resource_id, b1.request_date,
--   b1.start_time as start1, b1.end_time as end1,
--   b2.start_time as start2, b2.end_time as end2
-- FROM booking_requests b1
-- JOIN booking_requests b2 ON b1.id < b2.id
--   AND b1.resource_id = b2.resource_id
--   AND b1.request_date = b2.request_date
--   AND b1.resource_id IS NOT NULL
--   AND b1.status NOT IN ('cancelled', 'declined')
--   AND b2.status NOT IN ('cancelled', 'declined')
--   AND booking_tsrange(b1.request_date, b1.start_time, b1.end_time) && 
--       booking_tsrange(b2.request_date, b2.start_time, b2.end_time)
-- ORDER BY b1.request_date, b1.resource_id, b1.start_time;
--
-- RESOLUTION OPTIONS:
-- 1. Cancel overlapping booking: UPDATE booking_requests SET status = 'cancelled' WHERE id = ?;
-- 2. Adjust times to remove overlap
-- 3. Merge into session-based booking with multiple participants
-- ============================================================================

-- ============================================================================
-- CONSTRAINT DEFINITION (Commented out - enable after resolving conflicts)
-- ============================================================================
-- Prevents overlapping bookings for the same resource on the same date
-- Conditions:
--   - Same resource_id (constraint requires non-null resource_id)
--   - Same request_date
--   - Overlapping time ranges [start, end) - allows back-to-back bookings
--   - Only active bookings (excludes cancelled, declined)
--
-- To enable after data cleanup:
--
-- ALTER TABLE booking_requests 
-- ADD CONSTRAINT booking_no_overlap 
-- EXCLUDE USING GIST (
--   resource_id WITH =,
--   request_date WITH =,
--   booking_tsrange(request_date, start_time, end_time) WITH &&
-- ) WHERE (resource_id IS NOT NULL AND status NOT IN ('cancelled', 'declined'));
--
-- ============================================================================
-- IMPORTANT: Application code in server/core/bookingService/conflictDetection.ts
-- still provides the primary conflict check. This constraint is a safety net
-- for race conditions only.
-- ============================================================================
