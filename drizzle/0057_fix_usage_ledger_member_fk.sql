-- ============================================================================
-- USAGE LEDGER: CLEAN UP ORPHAN MEMBER_ID REFERENCES
-- ============================================================================
-- Orphaned rows exist in production where member_id references users that
-- have been deleted. This migration NULLs out those orphaned references.
-- The FK constraint is managed by db-init.ts at server startup (which cleans
-- orphaned data first, then adds the constraint safely).
-- ============================================================================

-- NULL out orphaned member_id values (users that no longer exist)
UPDATE usage_ledger SET member_id = NULL
WHERE member_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = usage_ledger.member_id);
