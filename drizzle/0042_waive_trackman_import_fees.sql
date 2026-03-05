-- ============================================================================
-- WAIVE TRACKMAN IMPORT BILLING
-- ============================================================================
-- Trackman CSV imports are for usage tracking, not billing. Sessions imported
-- from Trackman should never generate outstanding fees for members.
--
-- This migration sets payment_status = 'waived' for all booking_participants
-- on trackman_import/trackman_webhook sessions that were left as 'pending'.
-- Also clears any cached_fee_cents that may have been computed on-the-fly
-- by the balance endpoint before this fix.
-- ============================================================================

UPDATE booking_participants bp
SET payment_status = 'waived', cached_fee_cents = 0
FROM booking_sessions bs
WHERE bs.id = bp.session_id
  AND bs.source IN ('trackman_import', 'trackman_webhook')
  AND (bp.payment_status = 'pending' OR bp.payment_status IS NULL);
