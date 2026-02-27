-- ============================================================================
-- USAGE LEDGER: ADD FOREIGN KEY WITH CASCADE DELETE
-- ============================================================================
-- Prevents orphaned usage_ledger entries by adding a proper foreign key
-- constraint to booking_sessions with ON DELETE CASCADE. When a booking
-- session is deleted, its associated ledger entries are automatically removed.
-- ============================================================================

-- Step 1: Delete existing orphaned entries (ledger entries pointing to
-- non-existent sessions)
DELETE FROM usage_ledger
WHERE session_id NOT IN (SELECT id FROM booking_sessions);

-- Step 2: Add foreign key constraint with CASCADE delete
ALTER TABLE usage_ledger
ADD CONSTRAINT usage_ledger_session_id_fk
FOREIGN KEY (session_id) REFERENCES booking_sessions(id) ON DELETE CASCADE;
