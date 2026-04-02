-- Migration: Unify "Empty Slot" and "Guest N" participants as "Guest (info pending)" placeholders
-- Task #385: Remove the separate Empty Slot code path and unify naming

-- Convert legacy "Empty Slot" rows
UPDATE booking_participants
SET display_name = 'Guest (info pending)',
    payment_status = CASE WHEN payment_status NOT IN ('paid', 'refunded') THEN 'pending' ELSE payment_status END
WHERE display_name = 'Empty Slot'
  AND user_id IS NULL
  AND guest_id IS NULL;

-- Convert legacy "Guest N" placeholder rows (e.g., "Guest 1", "Guest 2")
UPDATE booking_participants
SET display_name = 'Guest (info pending)',
    payment_status = CASE WHEN payment_status NOT IN ('paid', 'refunded') THEN 'pending' ELSE payment_status END
WHERE display_name ~ '^Guest \d+$'
  AND user_id IS NULL
  AND guest_id IS NULL;

-- Normalize any other null-linked guest placeholders with non-standard status
UPDATE booking_participants
SET payment_status = 'pending'
WHERE participant_type = 'guest'
  AND user_id IS NULL
  AND guest_id IS NULL
  AND display_name = 'Guest (info pending)'
  AND payment_status NOT IN ('pending', 'paid', 'refunded');
