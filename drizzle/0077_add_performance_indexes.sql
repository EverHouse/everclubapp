-- Migration: Add missing indexes for slow queries causing pool exhaustion
-- Addresses: failed_side_effects scheduler (3.5s), approved-bookings enrichment (1.4-4.7s)

-- Composite index for the failed_side_effects scheduler query
-- The scheduler filters on (resolved = false, retry_count < N) and orders by (retry_count, created_at)
CREATE INDEX IF NOT EXISTS idx_failed_side_effects_retry_queue
  ON failed_side_effects (resolved, retry_count, created_at)
  WHERE resolved = false;

-- Index on booking_fee_snapshots.session_id for the approved-bookings enrichment query
-- The enrichment query does EXISTS subqueries on session_id with status filters
CREATE INDEX IF NOT EXISTS idx_fee_snapshots_session_id
  ON booking_fee_snapshots (session_id)
  WHERE session_id IS NOT NULL;
