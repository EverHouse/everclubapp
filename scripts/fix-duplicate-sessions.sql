-- Fix duplicate booking_sessions before migration
-- Run this in production database admin before deploying

-- Step 1: For session pair 2737/2755 (resource 2, 2026-01-09, 10:30-11:30)
-- Keep 2737 (older), merge 2755 into it

-- Move participants from 2755 to 2737
UPDATE booking_participants 
SET session_id = 2737 
WHERE session_id = 2755 
  AND NOT EXISTS (
    SELECT 1 FROM booking_participants bp2 
    WHERE bp2.session_id = 2737 
      AND bp2.user_id = booking_participants.user_id
      AND booking_participants.user_id IS NOT NULL
  );

-- Move booking_requests from 2755 to 2737
UPDATE booking_requests SET session_id = 2737 WHERE session_id = 2755;

-- Move usage_ledger from 2755 to 2737
UPDATE usage_ledger SET session_id = 2737 WHERE session_id = 2755;

-- Delete remaining orphan participants on 2755
DELETE FROM booking_participants WHERE session_id = 2755;

-- Delete the duplicate session 2755
DELETE FROM booking_sessions WHERE id = 2755;


-- Step 2: For session pair 2807/2845 (resource 1, 2026-01-14, 13:00-14:00)
-- Keep 2807 (older), merge 2845 into it

-- Move participants from 2845 to 2807
UPDATE booking_participants 
SET session_id = 2807 
WHERE session_id = 2845 
  AND NOT EXISTS (
    SELECT 1 FROM booking_participants bp2 
    WHERE bp2.session_id = 2807 
      AND bp2.user_id = booking_participants.user_id
      AND booking_participants.user_id IS NOT NULL
  );

-- Move booking_requests from 2845 to 2807
UPDATE booking_requests SET session_id = 2807 WHERE session_id = 2845;

-- Move usage_ledger from 2845 to 2807
UPDATE usage_ledger SET session_id = 2807 WHERE session_id = 2845;

-- Delete remaining orphan participants on 2845
DELETE FROM booking_participants WHERE session_id = 2845;

-- Delete the duplicate session 2845
DELETE FROM booking_sessions WHERE id = 2845;


-- Verify no more duplicates
SELECT resource_id, session_date, start_time, end_time, COUNT(*) as count
FROM booking_sessions
GROUP BY resource_id, session_date, start_time, end_time
HAVING COUNT(*) > 1;
