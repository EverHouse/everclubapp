-- ============================================================================
-- USAGE LEDGER: FIX ORPHAN MEMBER_ID + ADD FOREIGN KEY
-- ============================================================================
-- The Drizzle schema defines usage_ledger.member_id as a FK to users.id with
-- ON DELETE SET NULL, but orphaned rows exist in production where member_id
-- references users that have been deleted. This migration NULLs out those
-- orphaned references first, then safely adds the FK constraint.
-- ============================================================================

-- Step 1: NULL out orphaned member_id values (users that no longer exist)
UPDATE usage_ledger SET member_id = NULL
WHERE member_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = usage_ledger.member_id);--> statement-breakpoint

-- Step 2: Add foreign key constraint with SET NULL on delete
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'usage_ledger_member_id_users_id_fk'
      AND table_name = 'usage_ledger'
  ) THEN
    ALTER TABLE usage_ledger
    ADD CONSTRAINT usage_ledger_member_id_users_id_fk
    FOREIGN KEY (member_id) REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
